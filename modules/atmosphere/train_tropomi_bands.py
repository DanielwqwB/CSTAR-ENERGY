"""Evaluate low/medium/high NO2 band prediction from TROPOMI.

The experiment uses the same 2019-2023 training-derived band cutoffs as the
original TROPOMI evaluation. It never reads MERRA files. Candidate selection
uses 2024, while 2025 is a locked test and never supplies a target feature.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

import joblib
import matplotlib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from modules.atmosphere.tropomi_band_features import load_tropomi_band_frame
from modules.atmosphere.tropomi_features import RANDOM_STATE


matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
BASELINE = "spatial_seasonal_climatology"
LABELS = ("background", "elevated", "high")
CORE = [
    "latitude", "longitude", "latitude_sq", "longitude_sq", "latitude_longitude",
    "month_sin", "month_cos", "year_index", "training_baseline_no2_umol_m2",
    "neighbor_prior_no2_umol_m2", "qa_mean", "coverage_fraction", "valid_orbit_count",
]
ANNUAL = ["no2_lag12m", "no2_lag24m", "no2_lag36m", "no2_prior_annual_mean", "no2_prior_annual_count", "no2_annual_change"]
SHORT = ["no2_lag1m", "no2_lag3m", "no2_prior3m_mean", "no2_prior3m_count"]


def band_codes(values: np.ndarray, thresholds: tuple[float, float]) -> np.ndarray:
    """Assign all three bands using only the fixed training quantiles."""

    return np.digitize(np.asarray(values), thresholds, right=True).astype("int8")


def score(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    """Calculate full-coverage accuracy and class-balanced diagnostics."""

    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, predicted)),
        "macro_f1": float(f1_score(actual, predicted, average="macro", zero_division=0)),
    }


def choose_by_validation(comparison: pd.DataFrame) -> tuple[str, str]:
    """Select a candidate using 2024 only, retaining climatology if stronger."""

    validation = comparison.loc[comparison["split"].eq("validation_2024")].set_index("model")
    candidates = validation.drop(index=BASELINE)
    ranked = candidates.sort_values(
        ["accuracy", "balanced_accuracy"], ascending=False
    )
    best_candidate = str(ranked.index[0])
    baseline = validation.loc[BASELINE]
    eligible = ranked.loc[
        ranked["accuracy"].gt(baseline["accuracy"])
        & ranked["balanced_accuracy"].ge(baseline["balanced_accuracy"])
    ]
    selected = str(eligible.index[0]) if not eligible.empty else BASELINE
    return best_candidate, selected


def _model_specs() -> list[dict[str, object]]:
    """Small fixed candidates; each uses TROPOMI metadata and earlier NO2 only."""

    return [
        {"name": "logistic_annual", "kind": "logistic", "features": CORE + ANNUAL},
        {"name": "hgb_annual", "kind": "hgb_classifier", "features": CORE + ANNUAL},
        {"name": "xgb_annual", "kind": "xgb_classifier", "features": CORE + ANNUAL},
        {"name": "hgb_all_history", "kind": "hgb_classifier", "features": CORE + ANNUAL + SHORT},
        {"name": "xgb_all_history", "kind": "xgb_classifier", "features": CORE + ANNUAL + SHORT},
        {"name": "hgb_ordinal_regression", "kind": "hgb_regressor", "features": CORE + ANNUAL},
    ]


def _make_model(kind: str, random_state: int):
    """Construct a fixed regularized model without test-set hyperparameter tuning."""

    if kind == "logistic":
        return Pipeline([
            ("impute", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=0.3, max_iter=300, random_state=random_state)),
        ])
    if kind == "hgb_classifier":
        return HistGradientBoostingClassifier(
            learning_rate=0.05, max_iter=180, max_leaf_nodes=21,
            min_samples_leaf=120, l2_regularization=5.0,
            early_stopping=False, random_state=random_state,
        )
    if kind == "xgb_classifier":
        return XGBClassifier(
            objective="multi:softprob", num_class=3, n_estimators=180,
            max_depth=4, learning_rate=0.05, min_child_weight=45,
            subsample=0.8, colsample_bytree=0.8, reg_lambda=10.0,
            tree_method="hist", n_jobs=4, random_state=random_state,
        )
    if kind == "hgb_regressor":
        return HistGradientBoostingRegressor(
            loss="absolute_error", learning_rate=0.05, max_iter=180,
            max_leaf_nodes=21, min_samples_leaf=120,
            l2_regularization=5.0, early_stopping=False,
            random_state=random_state,
        )
    raise ValueError(f"Unknown TROPOMI band model: {kind}")


def _save_confusion(actual: np.ndarray, predicted: np.ndarray, path: Path, title: str) -> None:
    """Save numeric and visual class-confusion matrices."""

    matrix = confusion_matrix(actual, predicted, labels=[0, 1, 2])
    pd.DataFrame(
        matrix,
        index=[f"actual_{name}" for name in LABELS],
        columns=[f"predicted_{name}" for name in LABELS],
    ).to_csv(path.with_suffix(".csv"))
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    axis.set_xticks(range(3), LABELS)
    axis.set_yticks(range(3), LABELS)
    axis.set_xlabel("Predicted NO₂ band")
    axis.set_ylabel("Observed NO₂ band")
    axis.set_title(title)
    for row in range(3):
        for column in range(3):
            axis.text(column, row, f"{matrix[row, column]:,}", ha="center", va="center")
    figure.colorbar(image, ax=axis)
    figure.tight_layout()
    figure.savefig(path.with_suffix(".png"), dpi=150)
    plt.close(figure)


def _append_scores(
    rows: list[dict[str, object]], name: str, feature_set: str,
    validation_actual: np.ndarray, test_actual: np.ndarray,
    validation_predicted: np.ndarray, test_predicted: np.ndarray,
    fit_seconds: float | None,
) -> None:
    """Record fixed-year validation and test metrics for a candidate."""

    for split, actual, predicted in (
        ("validation_2024", validation_actual, validation_predicted),
        ("test_2025", test_actual, test_predicted),
    ):
        rows.append({
            "model": name, "feature_set": feature_set, "split": split,
            "rows": int(len(actual)), **score(actual, predicted),
            "fit_seconds": fit_seconds if split == "validation_2024" else None,
        })


def run(args: argparse.Namespace) -> dict[str, object]:
    """Fit TROPOMI band candidates and test the fixed 90% target."""

    started = perf_counter()
    evaluation = Path(args.evaluation_dir)
    checkpoint = Path(args.checkpoint_path)
    evaluation.mkdir(parents=True, exist_ok=True)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    print("[1/5] Loading Philippines TROPOMI only and constructing past-observation features", flush=True)
    frame, counts, quality = load_tropomi_band_frame(args.tropomi_path, args.boundary_path)
    counts.to_csv(evaluation / "band_observation_counts.csv.gz", index=False)
    (evaluation / "band_data_quality_report.json").write_text(
        json.dumps(quality, indent=2, allow_nan=False), encoding="utf-8"
    )
    baseline_train = frame.loc[frame["year"].between(2019, 2023)]
    train = frame.loc[frame["year"].between(2020, 2023)]
    validation = frame.loc[frame["year"].eq(2024)]
    test = frame.loc[frame["year"].eq(2025)]
    if min(len(train), len(validation), len(test)) == 0:
        raise ValueError("Fixed chronological splits must all contain observations")
    thresholds = tuple(float(value) for value in np.quantile(
        baseline_train["target_no2_umol_m2"].to_numpy(), [1 / 3, 2 / 3]
    ))
    y_train = band_codes(train["target_no2_umol_m2"], thresholds)
    y_validation = band_codes(validation["target_no2_umol_m2"], thresholds)
    y_test = band_codes(test["target_no2_umol_m2"], thresholds)
    baseline_predictions = {
        "validation": band_codes(validation["baseline_no2_umol_m2"], thresholds),
        "test": band_codes(test["baseline_no2_umol_m2"], thresholds),
    }
    predictions: dict[str, dict[str, np.ndarray]] = {BASELINE: baseline_predictions}
    comparison_rows: list[dict[str, object]] = []
    _append_scores(
        comparison_rows, BASELINE, "training-only cell-month climatology",
        y_validation, y_test, baseline_predictions["validation"], baseline_predictions["test"], None,
    )
    print(
        f"    Model train={len(train):,}; validation={len(validation):,}; test={len(test):,}; "
        f"baseline test accuracy={score(y_test, baseline_predictions['test'])['accuracy']:.2%}",
        flush=True,
    )

    print("[2/5] Comparing annual TROPOMI persistence and fixed climatology blends", flush=True)
    lag_validation = validation["no2_lag12m"].to_numpy()
    lag_test = test["no2_lag12m"].to_numpy()
    for name, weight in (("annual_persistence", 1.0), ("annual_blend_25", 0.25), ("annual_blend_50", 0.5), ("annual_blend_75", 0.75)):
        predicted = {}
        for split, partition, lag in (("validation", validation, lag_validation), ("test", test, lag_test)):
            climate = partition["baseline_no2_umol_m2"].to_numpy()
            annual = np.where(np.isfinite(lag), lag, climate)
            predicted[split] = band_codes((1 - weight) * climate + weight * annual, thresholds)
        predictions[name] = predicted
        _append_scores(
            comparison_rows, name, f"climatology + prior-year NO2; annual weight {weight:.2f}",
            y_validation, y_test, predicted["validation"], predicted["test"], 0.0,
        )

    print("[3/5] Training TROPOMI classifiers and an ordinal regression candidate", flush=True)
    fitted: dict[str, object] = {}
    features_by_model: dict[str, list[str]] = {}
    for spec in _model_specs():
        name, kind, features = str(spec["name"]), str(spec["kind"]), list(spec["features"])
        model = _make_model(kind, args.random_state)
        model_started = perf_counter()
        target = train["target_no2_umol_m2"] if kind == "hgb_regressor" else y_train
        if kind == "logistic":
            model.fit(train[features], target, model__sample_weight=train["sample_weight"])
        else:
            model.fit(train[features], target, sample_weight=train["sample_weight"])
        elapsed = perf_counter() - model_started
        fitted[name] = model
        features_by_model[name] = features
        predicted = {}
        for split, partition in (("validation", validation), ("test", test)):
            raw_prediction = model.predict(partition[features])
            predicted[split] = (
                band_codes(raw_prediction, thresholds)
                if kind == "hgb_regressor" else raw_prediction.astype("int8")
            )
        predictions[name] = predicted
        _append_scores(
            comparison_rows, name, f"TROPOMI metadata + {len(features)} past-only features",
            y_validation, y_test, predicted["validation"], predicted["test"], elapsed,
        )
        print(f"    {name}: validation={score(y_validation, predicted['validation'])['accuracy']:.2%}; fit={elapsed:.1f}s", flush=True)

    comparison = pd.DataFrame(comparison_rows)
    baseline_by_split = comparison.loc[comparison["model"].eq(BASELINE)].set_index("split")["accuracy"]
    comparison["accuracy_change_vs_climatology_points"] = [
        100 * (float(row.accuracy) - float(baseline_by_split.loc[row.split]))
        for row in comparison.itertuples(index=False)
    ]
    comparison.to_csv(evaluation / "band_model_comparison.csv", index=False)
    best_candidate, selected = choose_by_validation(comparison)
    print(f"    Best 2024 candidate={best_candidate}; selected={selected}", flush=True)

    print("[4/5] Writing held-out predictions, confusion matrices, and diagnostics", flush=True)
    _save_confusion(y_test, baseline_predictions["test"], evaluation / "band_confusion_baseline", "2025 TROPOMI climatology")
    _save_confusion(y_test, predictions[best_candidate]["test"], evaluation / "band_confusion_best_candidate", "2025 TROPOMI candidate")
    prediction_table = pd.DataFrame({
        "month": test["month"].dt.strftime("%Y-%m").to_numpy(),
        "cell_id": test["cell_id"].to_numpy(),
        "actual_no2_umol_m2": test["target_no2_umol_m2"].to_numpy(),
        "valid_orbit_count": test["valid_orbit_count"].to_numpy(),
        "actual_band": np.asarray(LABELS)[y_test],
        "climatology_band": np.asarray(LABELS)[baseline_predictions["test"]],
        "best_candidate_band": np.asarray(LABELS)[predictions[best_candidate]["test"]],
        "selected_band": np.asarray(LABELS)[predictions[selected]["test"]],
    })
    prediction_table.to_csv(evaluation / "band_predictions.csv.gz", index=False)
    by_month = prediction_table.groupby("month", observed=True).apply(
        lambda group: pd.Series({
            "rows": len(group),
            "baseline_accuracy": float((group["actual_band"] == group["climatology_band"]).mean()),
            "candidate_accuracy": float((group["actual_band"] == group["best_candidate_band"]).mean()),
        }), include_groups=False,
    ).reset_index()
    by_month.to_csv(evaluation / "band_accuracy_by_month.csv", index=False)
    figure, axis = plt.subplots(figsize=(10, 4.5))
    axis.plot(by_month["month"], by_month["baseline_accuracy"], marker="o", label="Climatology")
    axis.plot(by_month["month"], by_month["candidate_accuracy"], marker="o", label=best_candidate)
    axis.set_ylim(0, 1)
    axis.tick_params(axis="x", rotation=65)
    axis.set_ylabel("Three-band accuracy")
    axis.set_title("2025 TROPOMI band accuracy by month")
    axis.legend()
    figure.tight_layout()
    figure.savefig(evaluation / "band_accuracy_by_month.png", dpi=150)
    plt.close(figure)

    baseline_test_metrics = score(y_test, baseline_predictions["test"])
    best_test_metrics = score(y_test, predictions[best_candidate]["test"])
    selected_test_metrics = score(y_test, predictions[selected]["test"])
    target_met = bool(selected_test_metrics["accuracy"] >= 0.90)
    metrics: dict[str, object] = {
        "task": "TROPOMI three-band NO2 classification",
        "data_sources": ["TROPOMI monthly cell means"],
        "band_thresholds_umol_m2": list(thresholds),
        "best_candidate_by_2024_validation": best_candidate,
        "selected_model": selected,
        "target_90_percent_accuracy_met": target_met,
        "baseline_test": baseline_test_metrics,
        "best_candidate_test": best_test_metrics,
        "selected_test": selected_test_metrics,
        "validation_accuracy": {
            str(row.model): float(row.accuracy)
            for row in comparison.loc[comparison["split"].eq("validation_2024")].itertuples(index=False)
        },
        "train_rows": int(len(train)),
        "validation_rows": int(len(validation)),
        "test_rows": int(len(test)),
        "test_history_through_year": 2024,
        "test_labels_used_as_features": False,
        "random_state": args.random_state,
        "training_seconds": perf_counter() - started,
        "weather_adjusted_anomaly_claim": False,
    }
    (evaluation / "band_metrics.json").write_text(
        json.dumps(metrics, indent=2, allow_nan=False), encoding="utf-8"
    )

    print("[5/5] Saving TROPOMI band checkpoint and result summary", flush=True)
    prior = {
        "cell_month_mean": baseline_train.groupby(["cell_id", "month_number"], observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "cell_mean": baseline_train.groupby("cell_id", observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "seasonal_mean": baseline_train.groupby("month_number", observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "global_mean": float(baseline_train["target_no2_umol_m2"].mean()),
    }
    joblib.dump({
        "selected_model": selected,
        "best_candidate": best_candidate,
        "models": fitted,
        "feature_columns": features_by_model,
        "climatology": prior,
        "band_thresholds_umol_m2": thresholds,
        "random_state": args.random_state,
        "data_source": "TROPOMI monthly NO2",
    }, checkpoint)
    summary = f"""# TROPOMI NO₂ band training

This stage uses monthly Philippine TROPOMI observations. MERRA is reserved for
the later weather-adjustment stage. The three band cutoffs ({thresholds[0]:.3f} and
{thresholds[1]:.3f} µmol/m²) are fitted on 2019-2023 observations and remain
fixed. Models fit 2020-2023; 2024 selects the winner; 2025 is the locked test.

Historical features contain only earlier observations: 2024 validation uses
history through 2023, and 2025 test uses history through 2024. No 2025 target
value becomes a feature. Missing months are kept missing, and every valid
held-out cell-month contributes to accuracy.

- Climatology 2025 accuracy: {baseline_test_metrics['accuracy']:.2%}; balanced accuracy {baseline_test_metrics['balanced_accuracy']:.2%}; macro F1 {baseline_test_metrics['macro_f1']:.2%}.
- Best 2024 candidate: `{best_candidate}`. Its 2025 accuracy is {best_test_metrics['accuracy']:.2%}; balanced accuracy {best_test_metrics['balanced_accuracy']:.2%}; macro F1 {best_test_metrics['macro_f1']:.2%}.
- Selected by 2024 validation: `{selected}`; selected 2025 accuracy {selected_test_metrics['accuracy']:.2%}.
- The 90% full-coverage band target was met: `{target_met}`.
- Total run time: {perf_counter() - started:.1f} seconds.

This classifies NO₂ concentration bands. It does not estimate weather-adjusted
anomalies; the existing regression evaluation remains separate. The 2025
period was inspected in earlier work, so it is a locked temporal test rather
than a never-seen blind test. See `band_model_comparison.csv` and the two confusion
matrices for the full comparison.
"""
    (evaluation / "band_results.md").write_text(summary, encoding="utf-8")
    metrics["training_seconds"] = perf_counter() - started
    (evaluation / "band_metrics.json").write_text(
        json.dumps(metrics, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        f"Done in {metrics['training_seconds']:.1f}s. Baseline={baseline_test_metrics['accuracy']:.2%}; "
        f"candidate={best_test_metrics['accuracy']:.2%}; selected={selected_test_metrics['accuracy']:.2%}; "
        f"90% target={target_met}. Results: {evaluation}", flush=True,
    )
    return metrics


def parse_args() -> argparse.Namespace:
    """Read source and output paths for TROPOMI band training."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tropomi-path", default=str(ROOT / "data" / "raw" / "tropomi" / "tropomi_no2_2019-01-01_2025-12-31.csv.gz"))
    parser.add_argument("--boundary-path", default=str(ROOT / "data" / "raw" / "tropomi" / "philippines_adm0.geojson"))
    parser.add_argument("--evaluation-dir", default=str(ROOT / "models" / "evaluation" / "tropomi"))
    parser.add_argument("--checkpoint-path", default=str(ROOT / "models" / "checkpoints" / "tropomi" / "tropomi_bands.joblib"))
    parser.add_argument("--random-state", type=int, default=RANDOM_STATE)
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
