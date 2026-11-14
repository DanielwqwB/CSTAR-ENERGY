"""Train and evaluate the monthly Philippines TROPOMI-MERRA baseline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from time import perf_counter

import joblib
import matplotlib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    median_absolute_error,
    r2_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from pipeline.harmonization.tropomi_features import (
    aggregate_merra_monthly,
    build_tropomi_merra_frame,
    load_tropomi_table,
)
from pipeline.ingestion.merra import load_merra_directory


matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
LEGACY_PREFIX = "legacy_baseline_"
BOUNDARY_API = "https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM0/"
BOUNDARY_ID = "PHL-ADM0-24100683"
BOUNDARY_SOURCE = "OCHA Philippines; National Mapping and Resource Information Authority"
BOUNDARY_LICENSE = "CC BY 3.0 IGO"
NO2_SOURCE = "https://registry.opendata.aws/sentinel5p/"
BAND_LABELS = ["background", "elevated", "high"]


def legacy_artifact(directory: Path, filename: str) -> Path:
    """Keep the older baseline run separate from the weather evaluation."""

    return directory / f"{LEGACY_PREFIX}{filename}"


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    if len(actual) < 2 or np.allclose(actual, actual[0]):
        r2 = float("nan")
    else:
        r2 = float(r2_score(actual, predicted))
    return {
        "mae_umol_m2": float(mean_absolute_error(actual, predicted)),
        "median_ae_umol_m2": float(median_absolute_error(actual, predicted)),
        "rmse_umol_m2": float(math.sqrt(mean_squared_error(actual, predicted))),
        "r2": r2,
        "bias_umol_m2": float(np.mean(predicted - actual)),
    }


def no2_bands(values: np.ndarray, thresholds: tuple[float, float]) -> np.ndarray:
    return np.digitize(values, bins=np.asarray(thresholds), right=True)


def save_confusion_plot(matrix: np.ndarray, path: Path) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    axis.set_xticks(range(3), labels=BAND_LABELS)
    axis.set_yticks(range(3), labels=BAND_LABELS)
    axis.set_xlabel("Predicted concentration band")
    axis.set_ylabel("Observed concentration band")
    axis.set_title("Held-out 2025 NO2 band diagnostic")
    for row in range(3):
        for column in range(3):
            axis.text(column, row, f"{matrix[row, column]:,}", ha="center", va="center")
    figure.colorbar(image, ax=axis)
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def _fit_model(model_name: str, model, x, y, weights) -> None:
    if model_name == "ridge":
        model.fit(x, y, model__sample_weight=weights)
    else:
        model.fit(x, y, sample_weight=weights)


def train(args: argparse.Namespace) -> dict[str, object]:
    started = perf_counter()
    evaluation_dir = Path(args.evaluation_dir)
    plots_dir = evaluation_dir / "plots"
    checkpoint_dir = Path(args.checkpoint_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    plots_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    print("[1/8] Loading TROPOMI and MERRA-2 source tables", flush=True)
    tropomi = load_tropomi_table(args.tropomi_path)
    merra, merra_metadata = load_merra_directory(args.merra_dir)
    print(
        f"      TROPOMI rows={len(tropomi):,}; MERRA hourly rows={len(merra):,}",
        flush=True,
    )

    print("[2/8] Masking the Philippines and building leakage-safe features", flush=True)
    merra_monthly, _ = aggregate_merra_monthly(merra)
    frame, feature_columns, masks, climatology = build_tropomi_merra_frame(
        tropomi=tropomi,
        merra_monthly=merra_monthly,
        boundary_path=args.boundary_path,
        min_valid_orbits=args.min_valid_orbits,
    )
    split_sizes = {name: int(mask.sum()) for name, mask in masks.items()}
    print(
        f"      Model rows={len(frame):,}; cells={frame['cell_id'].nunique():,}; "
        + ", ".join(f"{name}={size:,}" for name, size in split_sizes.items()),
        flush=True,
    )

    boundary_hash = hashlib.sha256(Path(args.boundary_path).read_bytes()).hexdigest()
    quality_report = {
        "raw_tropomi_rows": int(len(tropomi)),
        "model_rows_after_boundary_and_coverage_filters": int(len(frame)),
        "unique_model_cells": int(frame["cell_id"].nunique()),
        "model_start_month": frame["month"].min().strftime("%Y-%m"),
        "model_end_month": frame["month"].max().strftime("%Y-%m"),
        "split_sizes": split_sizes,
        "minimum_valid_orbits": args.min_valid_orbits,
        "coverage_fraction_quantiles": {
            str(key): float(value)
            for key, value in frame["coverage_fraction"]
            .quantile([0, 0.05, 0.25, 0.5, 0.75, 0.95, 1])
            .to_dict()
            .items()
        },
        "target_umol_m2_quantiles": {
            str(key): float(value)
            for key, value in frame["target_no2_umol_m2"]
            .quantile([0, 0.01, 0.05, 0.5, 0.95, 0.99, 1])
            .to_dict()
            .items()
        },
        "missing_model_values": {
            column: int(value)
            for column, value in frame[feature_columns].isna().sum().to_dict().items()
        },
        "boundary": {
            "boundary_id": BOUNDARY_ID,
            "api": BOUNDARY_API,
            "source": BOUNDARY_SOURCE,
            "license": BOUNDARY_LICENSE,
            "sha256": boundary_hash,
        },
        "tropomi_source": NO2_SOURCE,
        "merra_sources": [metadata.to_dict() for metadata in merra_metadata],
    }
    legacy_artifact(evaluation_dir, "data_quality_report.json").write_text(
        json.dumps(quality_report, indent=2), encoding="utf-8"
    )

    models = {
        "ridge": Pipeline(
            [
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=10.0)),
            ]
        ),
        "hist_gradient_boosting_squared": HistGradientBoostingRegressor(
            loss="squared_error",
            learning_rate=0.05,
            max_iter=200,
            max_leaf_nodes=31,
            min_samples_leaf=100,
            l2_regularization=1.0,
            early_stopping=False,
            random_state=args.random_state,
        ),
        "hist_gradient_boosting_absolute": HistGradientBoostingRegressor(
            loss="absolute_error",
            learning_rate=0.05,
            max_iter=200,
            max_leaf_nodes=31,
            min_samples_leaf=100,
            l2_regularization=1.0,
            early_stopping=False,
            random_state=args.random_state,
        ),
    }

    x = frame[feature_columns]
    residual_target = frame["target_residual_umol_m2"]
    train_mask = masks["train"]
    weights = frame["sample_weight"]
    comparison_rows: list[dict[str, object]] = []
    fitted_models: dict[str, object] = {}

    for split_name in ["validation", "test"]:
        split_mask = masks[split_name]
        actual = frame.loc[split_mask, "target_no2_umol_m2"].to_numpy()
        baseline = frame.loc[split_mask, "baseline_no2_umol_m2"].to_numpy()
        comparison_rows.append(
            {
                "model": "spatial_seasonal_climatology",
                "split": split_name,
                **regression_metrics(actual, baseline),
            }
        )

    print("[3/8] Training Ridge and HistGradientBoosting candidates", flush=True)
    for model_name, model in models.items():
        model_started = perf_counter()
        print(f"      Fitting {model_name}...", flush=True)
        _fit_model(
            model_name,
            model,
            x.loc[train_mask],
            residual_target.loc[train_mask],
            weights.loc[train_mask],
        )
        fitted_models[model_name] = model
        training_seconds = perf_counter() - model_started
        for split_name in ["validation", "test"]:
            split_mask = masks[split_name]
            residual_prediction = model.predict(x.loc[split_mask])
            predicted = (
                frame.loc[split_mask, "baseline_no2_umol_m2"].to_numpy()
                + residual_prediction
            )
            actual = frame.loc[split_mask, "target_no2_umol_m2"].to_numpy()
            row = {
                "model": model_name,
                "split": split_name,
                **regression_metrics(actual, predicted),
            }
            if split_name == "validation":
                row["training_seconds"] = training_seconds
            comparison_rows.append(row)
        validation_row = comparison_rows[-2]
        print(
            f"      {model_name}: validation MAE="
            f"{validation_row['mae_umol_m2']:.4f} umol/m2, "
            f"R2={validation_row['r2']:.4f}",
            flush=True,
        )

    comparison = pd.DataFrame(comparison_rows)
    comparison.to_csv(legacy_artifact(evaluation_dir, "model_comparison.csv"), index=False)
    validation_rows = comparison[comparison["split"] == "validation"]
    selected_name = str(validation_rows.sort_values("mae_umol_m2").iloc[0]["model"])
    selected_model = fitted_models.get(selected_name)
    trained_validation_rows = validation_rows[
        validation_rows["model"] != "spatial_seasonal_climatology"
    ]
    best_trained_name = str(
        trained_validation_rows.sort_values("mae_umol_m2").iloc[0]["model"]
    )
    best_trained_model = fitted_models[best_trained_name]
    print(f"[4/8] Selected {selected_name} on 2024 validation MAE", flush=True)

    test_mask = masks["test"]
    test_frame = frame.loc[test_mask].copy()
    actual = test_frame["target_no2_umol_m2"].to_numpy()
    baseline = test_frame["baseline_no2_umol_m2"].to_numpy()
    if selected_model is None:
        residual_prediction = np.zeros(len(test_frame), dtype=np.float32)
    else:
        residual_prediction = selected_model.predict(test_frame[feature_columns])
    predicted = baseline + residual_prediction
    anomaly = actual - predicted
    anomaly_interpretation = (
        "weather-adjusted residual anomaly"
        if selected_model is not None
        else "spatial-seasonal climatology residual; not weather-adjusted"
    )
    selected_metrics = regression_metrics(actual, predicted)
    baseline_metrics = regression_metrics(actual, baseline)
    mae_improvement = 100 * (
        baseline_metrics["mae_umol_m2"] - selected_metrics["mae_umol_m2"]
    ) / baseline_metrics["mae_umol_m2"]

    train_target = frame.loc[train_mask, "target_no2_umol_m2"].to_numpy()
    band_thresholds = tuple(float(value) for value in np.quantile(train_target, [1 / 3, 2 / 3]))
    actual_band = no2_bands(actual, band_thresholds)
    predicted_band = no2_bands(predicted, band_thresholds)
    matrix = confusion_matrix(actual_band, predicted_band, labels=[0, 1, 2])
    band_metrics = {
        "accuracy": float(accuracy_score(actual_band, predicted_band)),
        "balanced_accuracy": float(balanced_accuracy_score(actual_band, predicted_band)),
        "macro_f1": float(f1_score(actual_band, predicted_band, average="macro")),
        "thresholds_umol_m2": list(band_thresholds),
        "note": (
            "Secondary concentration-band diagnostic only; these are not labeled "
            "pollution events or CCTF mechanism classes."
        ),
    }

    acceptance_gate = {
        "mae_better_than_climatology": selected_metrics["mae_umol_m2"]
        < baseline_metrics["mae_umol_m2"],
        "r2_at_least_0_70": selected_metrics["r2"] >= 0.70,
        "r2_stretch_0_90": selected_metrics["r2"] >= 0.90,
    }
    acceptance_gate["passed"] = bool(
        acceptance_gate["mae_better_than_climatology"]
        and acceptance_gate["r2_at_least_0_70"]
    )

    metrics = {
        "selected_model": selected_name,
        "best_trained_candidate": best_trained_name,
        "test": selected_metrics,
        "spatial_seasonal_climatology_test": baseline_metrics,
        "mae_improvement_over_climatology_percent": float(mae_improvement),
        "acceptance_gate": acceptance_gate,
        "anomaly_interpretation": anomaly_interpretation,
        "concentration_band_diagnostic": band_metrics,
    }
    legacy_artifact(evaluation_dir, "metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )

    print("[5/8] Writing held-out predictions and error summaries", flush=True)
    predictions = pd.DataFrame(
        {
            "month": test_frame["month"].dt.strftime("%Y-%m"),
            "cell_id": test_frame["cell_id"].astype(str),
            "longitude": test_frame["longitude"].to_numpy(),
            "latitude": test_frame["latitude"].to_numpy(),
            "actual_no2_umol_m2": actual,
            "climatology_no2_umol_m2": baseline,
            "predicted_no2_umol_m2": predicted,
            "model_residual_anomaly_umol_m2": anomaly,
            "coverage_fraction": test_frame["coverage_fraction"].to_numpy(),
            "valid_orbit_count": test_frame["valid_orbit_count"].to_numpy(),
            "actual_band": [BAND_LABELS[index] for index in actual_band],
            "predicted_band": [BAND_LABELS[index] for index in predicted_band],
        }
    )
    predictions.to_csv(legacy_artifact(evaluation_dir, "predictions.csv.gz"), index=False)

    monthly_rows = []
    for month, group in predictions.groupby("month", observed=True):
        monthly_rows.append(
            {
                "month": month,
                **regression_metrics(
                    group["actual_no2_umol_m2"].to_numpy(),
                    group["predicted_no2_umol_m2"].to_numpy(),
                ),
                "mean_model_residual_anomaly_umol_m2": float(
                    group["model_residual_anomaly_umol_m2"].mean()
                ),
                "rows": int(len(group)),
            }
        )
    pd.DataFrame(monthly_rows).to_csv(
        legacy_artifact(evaluation_dir, "error_by_month.csv"), index=False
    )

    cell_rows = []
    for cell_id, group in predictions.groupby("cell_id", observed=True):
        cell_rows.append(
            {
                "cell_id": cell_id,
                "longitude": float(group["longitude"].iloc[0]),
                "latitude": float(group["latitude"].iloc[0]),
                **regression_metrics(
                    group["actual_no2_umol_m2"].to_numpy(),
                    group["predicted_no2_umol_m2"].to_numpy(),
                ),
                "mean_model_residual_anomaly_umol_m2": float(
                    group["model_residual_anomaly_umol_m2"].mean()
                ),
                "rows": int(len(group)),
            }
        )
    cell_error = pd.DataFrame(cell_rows)
    cell_error.to_csv(legacy_artifact(evaluation_dir, "error_by_cell.csv"), index=False)
    pd.DataFrame(
        matrix,
        index=[f"actual_{label}" for label in BAND_LABELS],
        columns=[f"predicted_{label}" for label in BAND_LABELS],
    ).to_csv(legacy_artifact(evaluation_dir, "confusion_matrix.csv"))

    print("[6/8] Calculating permutation importance", flush=True)
    importance_model = selected_model if selected_model is not None else best_trained_model
    importance_model_name = (
        selected_name if selected_model is not None else best_trained_name
    )
    if importance_model is not None:
        sample_size = min(args.importance_sample, len(test_frame))
        sample = test_frame.sample(n=sample_size, random_state=args.random_state)
        importance = permutation_importance(
            importance_model,
            sample[feature_columns],
            sample["target_residual_umol_m2"],
            scoring="neg_mean_absolute_error",
            n_repeats=3,
            random_state=args.random_state,
            n_jobs=-1,
        )
        importance_frame = pd.DataFrame(
            {
                "model": importance_model_name,
                "feature": feature_columns,
                "importance_mean": importance.importances_mean,
                "importance_std": importance.importances_std,
            }
        ).sort_values("importance_mean", ascending=False)
    else:
        importance_frame = pd.DataFrame(
            columns=["model", "feature", "importance_mean", "importance_std"]
        )
    importance_frame.to_csv(legacy_artifact(evaluation_dir, "feature_importance.csv"), index=False)

    print("[7/8] Rendering evaluation plots", flush=True)
    rng = np.random.default_rng(args.random_state)
    scatter_indices = rng.choice(len(predictions), size=min(20_000, len(predictions)), replace=False)
    scatter = predictions.iloc[scatter_indices]
    figure, axis = plt.subplots(figsize=(7, 6))
    axis.scatter(
        scatter["actual_no2_umol_m2"],
        scatter["predicted_no2_umol_m2"],
        s=7,
        alpha=0.25,
    )
    limits = [
        min(scatter["actual_no2_umol_m2"].min(), scatter["predicted_no2_umol_m2"].min()),
        max(scatter["actual_no2_umol_m2"].max(), scatter["predicted_no2_umol_m2"].max()),
    ]
    axis.plot(limits, limits, color="black", linewidth=1)
    axis.set_xlabel("Observed NO2 (umol/m2)")
    axis.set_ylabel("Predicted NO2 (umol/m2)")
    axis.set_title("Held-out 2025 predictions")
    figure.tight_layout()
    figure.savefig(legacy_artifact(plots_dir, "predictions_vs_actual.png"), dpi=160)
    plt.close(figure)

    figure, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    axes[0].hist(anomaly, bins=60)
    axes[0].axvline(0, color="black", linewidth=1)
    axes[0].set_xlabel("Observed - predicted NO2 (umol/m2)")
    axes[0].set_title("Selected-model residual anomaly distribution")
    axes[1].scatter(predicted, anomaly, s=5, alpha=0.2)
    axes[1].axhline(0, color="black", linewidth=1)
    axes[1].set_xlabel("Predicted NO2 (umol/m2)")
    axes[1].set_ylabel("Observed - predicted (umol/m2)")
    axes[1].set_title("Residuals versus prediction")
    figure.tight_layout()
    figure.savefig(legacy_artifact(plots_dir, "residual_diagnostics.png"), dpi=160)
    plt.close(figure)

    monthly_series = predictions.groupby("month", observed=True)[
        [
            "actual_no2_umol_m2",
            "climatology_no2_umol_m2",
            "predicted_no2_umol_m2",
        ]
    ].mean()
    figure, axis = plt.subplots(figsize=(10, 4.5))
    axis.plot(monthly_series.index, monthly_series["actual_no2_umol_m2"], label="Observed")
    axis.plot(
        monthly_series.index,
        monthly_series["climatology_no2_umol_m2"],
        label="Climatology",
    )
    if selected_name != "spatial_seasonal_climatology":
        axis.plot(
            monthly_series.index,
            monthly_series["predicted_no2_umol_m2"],
            label="Selected TROPOMI-MERRA model",
        )
    axis.tick_params(axis="x", rotation=45)
    axis.set_ylabel("Mean NO2 (umol/m2)")
    axis.set_title("Held-out 2025 national monthly mean")
    axis.legend()
    figure.tight_layout()
    figure.savefig(legacy_artifact(plots_dir, "monthly_series.png"), dpi=160)
    plt.close(figure)

    figure, axis = plt.subplots(figsize=(7, 8))
    vmax = float(
        np.quantile(
            np.abs(cell_error["mean_model_residual_anomaly_umol_m2"]), 0.98
        )
    )
    image = axis.scatter(
        cell_error["longitude"],
        cell_error["latitude"],
        c=cell_error["mean_model_residual_anomaly_umol_m2"],
        cmap="coolwarm",
        vmin=-vmax,
        vmax=vmax,
        marker="s",
        s=14,
    )
    axis.set_xlabel("Longitude")
    axis.set_ylabel("Latitude")
    axis.set_title("Mean held-out 2025 selected-model residual anomaly")
    figure.colorbar(image, ax=axis, label="Observed - predicted (umol/m2)")
    figure.tight_layout()
    figure.savefig(legacy_artifact(plots_dir, "mean_anomaly_map.png"), dpi=160)
    plt.close(figure)
    save_confusion_plot(matrix, legacy_artifact(plots_dir, "confusion_matrix.png"))

    print("[8/8] Saving checkpoint and model card", flush=True)
    checkpoint_path = legacy_artifact(checkpoint_dir, "best_model.joblib")
    joblib.dump(
        {
            "model_name": selected_name,
            "model": selected_model,
            "best_trained_candidate_name": best_trained_name,
            "best_trained_candidate_model": best_trained_model,
            "feature_columns": feature_columns,
            "climatology": climatology,
            "target_units": "umol m-2",
            "target_scale_from_mol_m2": 1_000_000,
            "minimum_valid_orbits": args.min_valid_orbits,
            "band_thresholds_umol_m2": band_thresholds,
            "anomaly_interpretation": anomaly_interpretation,
            "boundary_id": BOUNDARY_ID,
            "boundary_sha256": boundary_hash,
            "split": {
                "train": "2019-2023",
                "validation": "2024",
                "test": "2025",
            },
        },
        checkpoint_path,
    )

    run_config = {
        "tropomi_path": str(Path(args.tropomi_path).resolve()),
        "merra_dir": str(Path(args.merra_dir).resolve()),
        "boundary_path": str(Path(args.boundary_path).resolve()),
        "evaluation_dir": str(evaluation_dir.resolve()),
        "checkpoint_path": str(checkpoint_path.resolve()),
        "minimum_valid_orbits": args.min_valid_orbits,
        "random_state": args.random_state,
        "importance_sample": args.importance_sample,
        "feature_columns": feature_columns,
        "training_seconds": perf_counter() - started,
    }
    legacy_artifact(evaluation_dir, "run_config.json").write_text(
        json.dumps(run_config, indent=2), encoding="utf-8"
    )

    model_card = f"""# TROPOMI-MERRA monthly atmospheric baseline

## Scope

This model predicts expected monthly TROPOMI tropospheric NO2 over Philippines
ADM0 cells. A training-only spatial-seasonal climatology provides the baseline;
MERRA-2 weather features are tested as residual corrections. Observed minus
predicted NO2 is the selected-model residual anomaly.

## Selected model

- Model: `{selected_name}`
- Best trained weather-correction candidate: `{best_trained_name}`
- Held-out period: 2025
- Test MAE: `{selected_metrics['mae_umol_m2']:.4f} umol/m2`
- Test RMSE: `{selected_metrics['rmse_umol_m2']:.4f} umol/m2`
- Test R2: `{selected_metrics['r2']:.4f}`
- Test bias: `{selected_metrics['bias_umol_m2']:.4f} umol/m2`
- MAE improvement over spatial-seasonal climatology: `{mae_improvement:.2f}%`
- Acceptance gate passed: `{acceptance_gate['passed']}`
- R2 stretch target of 0.90 reached: `{acceptance_gate['r2_stretch_0_90']}`

The climatology was retained because no trained weather-correction candidate
improved 2024 validation MAE. `feature_importance.csv` therefore describes the
best trained candidate rather than the selected climatology.

Because the selected model is climatology-only, its residual is spatially and
seasonally adjusted but must not yet be described as weather-adjusted or passed
to CCTF as weather-normalized evidence. Localized MERRA data is required for
that stronger interpretation.

## Validation design

- Training: 2019-2023
- Validation/model selection: 2024
- Held-out test: 2025
- No random row split was used.
- Training climatology uses leave-one-observation-out values.
- Rows require at least `{args.min_valid_orbits}` valid QA-filtered orbits per month.

## Concentration-band diagnostic

The confusion matrix groups continuous NO2 predictions into training-derived
background, elevated, and high concentration bands. Its accuracy is a secondary
regression diagnostic only; it is not pollution-event, CCTF, source-attribution,
or infrastructure-transition accuracy.

## Limitations

- Current MERRA inputs are Philippines-wide monthly aggregates, not local grid
  meteorology. They cannot support local wind or plume claims.
- The TROPOMI training table is gridded to 0.1 degree and does not preserve native
  Level-2 footprint polygons.
- Satellite NO2 columns are not ground-level concentrations or emission rates.
- HLS, event labels, and independent ground monitoring are not included.
"""
    legacy_artifact(evaluation_dir, "model_card.md").write_text(model_card, encoding="utf-8")

    metrics["training_seconds"] = perf_counter() - started
    legacy_artifact(evaluation_dir, "metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    print(
        f"Done in {metrics['training_seconds']:.1f}s. Test MAE="
        f"{selected_metrics['mae_umol_m2']:.4f} umol/m2, "
        f"R2={selected_metrics['r2']:.4f}. Evaluation: {evaluation_dir}",
        flush=True,
    )
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tropomi-path",
        default=str(
            ROOT
            / "data"
            / "raw"
            / "tropomi"
            / "tropomi_no2_2019-01-01_2025-12-31.csv.gz"
        ),
    )
    parser.add_argument("--merra-dir", default=str(ROOT / "data" / "raw" / "merra"))
    parser.add_argument(
        "--boundary-path",
        default=str(ROOT / "data" / "raw" / "tropomi" / "philippines_adm0.geojson"),
    )
    parser.add_argument(
        "--evaluation-dir",
        default=str(ROOT / "models" / "evaluation" / "tropomi"),
    )
    parser.add_argument(
        "--checkpoint-dir",
        default=str(ROOT / "models" / "checkpoints" / "tropomi"),
    )
    parser.add_argument("--min-valid-orbits", type=int, default=5)
    parser.add_argument("--importance-sample", type=int, default=20_000)
    parser.add_argument("--random-state", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    train(parse_args())
