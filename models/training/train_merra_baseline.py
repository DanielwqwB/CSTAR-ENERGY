"""Train and evaluate a time-safe MERRA-2 next-hour T2M baseline."""

from __future__ import annotations

import argparse
import json
import math
import sys
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
    r2_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.harmonization.merra_features import (  # noqa: E402
    build_supervised_frame,
    chronological_masks,
)
from pipeline.ingestion.merra import load_merra_directory  # noqa: E402


DIRECTION_LABELS = ["cooling", "stable", "warming"]


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae_kelvin": float(mean_absolute_error(actual, predicted)),
        "rmse_kelvin": float(math.sqrt(mean_squared_error(actual, predicted))),
        "r2": float(r2_score(actual, predicted)),
    }


def change_classes(
    predicted_t2m: np.ndarray, current_t2m: np.ndarray, threshold: float = 0.1
) -> np.ndarray:
    change = predicted_t2m - current_t2m
    return np.where(change < -threshold, 0, np.where(change > threshold, 2, 1))


def evaluate_direction(
    actual_t2m: np.ndarray,
    predicted_t2m: np.ndarray,
    current_t2m: np.ndarray,
) -> tuple[dict[str, float], np.ndarray, np.ndarray, np.ndarray]:
    actual_class = change_classes(actual_t2m, current_t2m)
    predicted_class = change_classes(predicted_t2m, current_t2m)
    metrics = {
        "accuracy": float(accuracy_score(actual_class, predicted_class)),
        "balanced_accuracy": float(
            balanced_accuracy_score(actual_class, predicted_class)
        ),
        "macro_f1": float(f1_score(actual_class, predicted_class, average="macro")),
    }
    matrix = confusion_matrix(actual_class, predicted_class, labels=[0, 1, 2])
    return metrics, matrix, actual_class, predicted_class


def save_confusion_plot(matrix: np.ndarray, path: Path) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    axis.set_xticks(range(3), DIRECTION_LABELS)
    axis.set_yticks(range(3), DIRECTION_LABELS)
    axis.set_xlabel("Predicted next-hour change")
    axis.set_ylabel("Actual next-hour change")
    axis.set_title("T2M change-direction diagnostic")
    for row in range(3):
        for column in range(3):
            text_color = "white" if matrix[row, column] > matrix.max() / 2 else "black"
            axis.text(
                column,
                row,
                str(matrix[row, column]),
                ha="center",
                va="center",
                color=text_color,
            )
    figure.colorbar(image, ax=axis)
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def train(args: argparse.Namespace) -> dict[str, object]:
    started = perf_counter()
    raw_dir = Path(args.raw_dir)
    evaluation_dir = Path(args.evaluation_dir)
    plots_dir = evaluation_dir / "plots"
    checkpoint_dir = Path(args.checkpoint_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    plots_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/7] Loading MERRA-2 CSV files from {raw_dir}", flush=True)
    raw_frame, source_metadata = load_merra_directory(raw_dir)
    print(
        f"      Loaded {len(source_metadata)} variables and {len(raw_frame):,} hourly rows.",
        flush=True,
    )
    print("[2/7] Building leakage-safe features and chronological splits", flush=True)
    supervised, feature_columns = build_supervised_frame(
        raw_frame, horizon_hours=args.horizon_hours
    )
    masks = chronological_masks(supervised)
    print(
        "      Split sizes: "
        + ", ".join(
            f"{name}={int(mask.sum()):,}" for name, mask in masks.items()
        ),
        flush=True,
    )

    quality_report = {
        "raw_rows": int(len(raw_frame)),
        "supervised_rows": int(len(supervised)),
        "start_time": raw_frame["time"].min().isoformat(),
        "end_time": raw_frame["time"].max().isoformat(),
        "duplicate_timestamps": int(raw_frame["time"].duplicated().sum()),
        "non_hourly_intervals": int(
            (raw_frame["time"].diff().dropna() != pd.Timedelta(hours=1)).sum()
        ),
        "missing_values": {
            column: int(value)
            for column, value in raw_frame.isna().sum().to_dict().items()
        },
        "sources": [metadata.to_dict() for metadata in source_metadata],
    }
    (evaluation_dir / "data_quality_report.json").write_text(
        json.dumps(quality_report, indent=2), encoding="utf-8"
    )

    x = supervised[feature_columns]
    y = supervised["target_t2m"]
    models = {
        "ridge": Pipeline(
            [
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=1.0)),
            ]
        ),
        "hist_gradient_boosting": HistGradientBoostingRegressor(
            learning_rate=0.06,
            max_iter=240,
            max_leaf_nodes=31,
            l2_regularization=1.0,
            random_state=args.random_state,
        ),
    }

    comparison_rows: list[dict[str, object]] = []
    fitted_models: dict[str, object] = {}

    print("[3/7] Training candidate models", flush=True)
    for model_name, model in models.items():
        print(f"      Fitting {model_name}...", flush=True)
        model_started = perf_counter()
        model.fit(x.loc[masks["train"]], y.loc[masks["train"]])
        fitted_models[model_name] = model
        for split_name in ["validation", "test"]:
            split_mask = masks[split_name]
            predicted = model.predict(x.loc[split_mask])
            row = {
                "model": model_name,
                "split": split_name,
                **regression_metrics(y.loc[split_mask].to_numpy(), predicted),
            }
            if split_name == "validation":
                row["training_seconds"] = perf_counter() - model_started
            comparison_rows.append(row)
        validation_row = comparison_rows[-2]
        print(
            f"      {model_name}: validation MAE="
            f"{validation_row['mae_kelvin']:.4f} K, "
            f"R2={validation_row['r2']:.4f}",
            flush=True,
        )

    for split_name in ["validation", "test"]:
        split_mask = masks[split_name]
        comparison_rows.append(
            {
                "model": "persistence",
                "split": split_name,
                **regression_metrics(
                    y.loc[split_mask].to_numpy(),
                    supervised.loc[split_mask, "t2m"].to_numpy(),
                ),
            }
        )

    comparison = pd.DataFrame(comparison_rows)
    comparison.to_csv(evaluation_dir / "model_comparison.csv", index=False)
    validation_models = comparison[
        (comparison["split"] == "validation")
        & (comparison["model"] != "persistence")
    ]
    selected_name = str(validation_models.sort_values("mae_kelvin").iloc[0]["model"])
    selected_model = fitted_models[selected_name]
    print(f"[4/7] Selected {selected_name}; evaluating held-out test period", flush=True)

    test_mask = masks["test"]
    test_frame = supervised.loc[test_mask].copy()
    actual = test_frame["target_t2m"].to_numpy()
    current = test_frame["t2m"].to_numpy()
    predicted = selected_model.predict(test_frame[feature_columns])
    persistence = current.copy()
    selected_metrics = regression_metrics(actual, predicted)
    persistence_metrics = regression_metrics(actual, persistence)
    improvement = 100 * (
        persistence_metrics["mae_kelvin"] - selected_metrics["mae_kelvin"]
    ) / persistence_metrics["mae_kelvin"]
    direction_metrics, matrix, actual_class, predicted_class = evaluate_direction(
        actual, predicted, current
    )

    gate = {
        "r2_at_least_0_80": selected_metrics["r2"] >= 0.80,
        "mae_improvement_at_least_10_percent": improvement >= 10.0,
    }
    gate["passed"] = all(gate.values())
    metrics = {
        "task": "next-hour T2M regression",
        "selected_model": selected_name,
        "test": selected_metrics,
        "persistence_test": persistence_metrics,
        "mae_improvement_over_persistence_percent": float(improvement),
        "change_direction_diagnostic": {
            **direction_metrics,
            "threshold_kelvin": 0.1,
            "labels": DIRECTION_LABELS,
            "scope_note": (
                "Derived next-hour temperature-change classes; not transition "
                "mechanism or TROPOMI accuracy."
            ),
        },
        "acceptance_gate": gate,
    }
    (evaluation_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    print(
        f"      Test MAE={selected_metrics['mae_kelvin']:.4f} K, "
        f"RMSE={selected_metrics['rmse_kelvin']:.4f} K, "
        f"R2={selected_metrics['r2']:.4f}",
        flush=True,
    )
    print(
        f"      MAE improvement over persistence={improvement:.2f}%",
        flush=True,
    )

    predictions = pd.DataFrame(
        {
            "time": test_frame["time"].astype(str),
            "target_time": test_frame["target_time"].astype(str),
            "current_t2m": current,
            "actual_t2m": actual,
            "predicted_t2m": predicted,
            "persistence_t2m": persistence,
            "residual_kelvin": actual - predicted,
            "actual_change_class": [DIRECTION_LABELS[index] for index in actual_class],
            "predicted_change_class": [
                DIRECTION_LABELS[index] for index in predicted_class
            ],
        }
    )
    predictions.to_csv(evaluation_dir / "predictions.csv", index=False)

    print("[5/7] Generating diagnostic tables and plots", flush=True)
    matrix_frame = pd.DataFrame(
        matrix,
        index=[f"actual_{label}" for label in DIRECTION_LABELS],
        columns=[f"predicted_{label}" for label in DIRECTION_LABELS],
    )
    matrix_frame.to_csv(evaluation_dir / "confusion_matrix.csv")
    save_confusion_plot(matrix, plots_dir / "confusion_matrix.png")

    monthly = predictions.assign(
        month=pd.to_datetime(predictions["target_time"], utc=True)
        .dt.tz_convert(None)
        .dt.to_period("M")
    )
    monthly_rows = []
    for month, group in monthly.groupby("month", observed=True):
        monthly_rows.append(
            {
                "month": str(month),
                "mae_kelvin": mean_absolute_error(
                    group["actual_t2m"], group["predicted_t2m"]
                ),
                "rmse_kelvin": math.sqrt(
                    mean_squared_error(
                        group["actual_t2m"], group["predicted_t2m"]
                    )
                ),
            }
        )
    monthly_error = pd.DataFrame(monthly_rows)
    monthly_error.to_csv(evaluation_dir / "error_by_month.csv", index=False)

    sample_count = min(5000, int(test_mask.sum()))
    sample = test_frame.sample(sample_count, random_state=args.random_state)
    importance = permutation_importance(
        selected_model,
        sample[feature_columns],
        sample["target_t2m"],
        scoring="neg_mean_absolute_error",
        n_repeats=3,
        random_state=args.random_state,
        n_jobs=-1,
    )
    importance_frame = pd.DataFrame(
        {
            "feature": feature_columns,
            "importance_mean": importance.importances_mean,
            "importance_std": importance.importances_std,
        }
    ).sort_values("importance_mean", ascending=False)
    importance_frame.to_csv(evaluation_dir / "feature_importance.csv", index=False)

    figure, axis = plt.subplots(figsize=(10, 4.5))
    plot_window = predictions.head(24 * 14)
    plot_times = pd.to_datetime(plot_window["target_time"], utc=True)
    axis.plot(plot_times, plot_window["actual_t2m"], label="Actual")
    axis.plot(
        plot_times,
        plot_window["predicted_t2m"],
        label="Predicted",
        alpha=0.8,
    )
    axis.set_title("Next-hour T2M: first 14 test days")
    axis.set_ylabel("Kelvin")
    date_locator = mdates.AutoDateLocator(minticks=4, maxticks=8)
    axis.xaxis.set_major_locator(date_locator)
    axis.xaxis.set_major_formatter(mdates.ConciseDateFormatter(date_locator))
    axis.legend()
    figure.tight_layout()
    figure.savefig(plots_dir / "predictions_vs_actual.png", dpi=160)
    plt.close(figure)

    figure, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].hist(predictions["residual_kelvin"], bins=50)
    axes[0].set_title("Residual distribution")
    axes[0].set_xlabel("Actual - predicted (K)")
    axes[1].scatter(
        predictions["predicted_t2m"],
        predictions["residual_kelvin"],
        s=3,
        alpha=0.25,
    )
    axes[1].axhline(0, color="black", linewidth=1)
    axes[1].set_title("Residuals versus prediction")
    axes[1].set_xlabel("Predicted T2M (K)")
    figure.tight_layout()
    figure.savefig(plots_dir / "residuals.png", dpi=160)
    plt.close(figure)

    top_features = importance_frame.head(15).sort_values("importance_mean")
    figure, axis = plt.subplots(figsize=(8, 6))
    axis.barh(top_features["feature"], top_features["importance_mean"])
    axis.set_title("Permutation importance on held-out test sample")
    axis.set_xlabel("Increase in MAE after permutation")
    figure.tight_layout()
    figure.savefig(plots_dir / "feature_importance.png", dpi=160)
    plt.close(figure)

    figure, axis = plt.subplots(figsize=(10, 4))
    axis.plot(monthly_error["month"], monthly_error["mae_kelvin"], marker="o")
    axis.set_title("Held-out MAE by month")
    axis.set_ylabel("MAE (K)")
    axis.tick_params(axis="x", labelrotation=45)
    figure.tight_layout()
    figure.savefig(plots_dir / "error_by_month.png", dpi=160)
    plt.close(figure)

    print("[6/7] Saving the selected checkpoint and reproducibility metadata", flush=True)
    checkpoint_path = checkpoint_dir / "best_model.joblib"
    joblib.dump(
        {
            "model": selected_model,
            "feature_columns": feature_columns,
            "task": "next-hour T2M regression",
            "horizon_hours": args.horizon_hours,
            "selected_model": selected_name,
        },
        checkpoint_path,
    )

    run_config = {
        "random_state": args.random_state,
        "horizon_hours": args.horizon_hours,
        "split_basis": "target_time",
        "train_period": "2016-2023",
        "validation_period": "2024",
        "test_period": "2025-2026-09-30",
        "features": feature_columns,
        "checkpoint": str(checkpoint_path),
    }
    (evaluation_dir / "run_config.json").write_text(
        json.dumps(run_config, indent=2), encoding="utf-8"
    )

    model_card = f"""# MERRA-2 next-hour T2M baseline

## Scope

This model predicts Philippines-wide area-averaged next-hour MERRA-2 `T2M`.
It is a pipeline and evaluation baseline for Developer 3; it is not a TROPOMI
NO2 model, local plume model, or transition-mechanism classifier.

## Selected model

- Model: `{selected_name}`
- Test MAE: `{selected_metrics['mae_kelvin']:.4f} K`
- Test RMSE: `{selected_metrics['rmse_kelvin']:.4f} K`
- Test R2: `{selected_metrics['r2']:.4f}`
- MAE improvement over persistence: `{improvement:.2f}%`
- Acceptance gate passed: `{gate['passed']}`

## Validation design

- Training: 2016-2023
- Validation/model selection: 2024
- Held-out test: 2025 through September 2026
- No random row split was used.
- Split periods are assigned by the next-hour target timestamp.

## Classification diagnostic

The confusion matrix converts actual and predicted next-hour temperature
changes into cooling, stable, and warming classes using a 0.1 K threshold.
Its accuracy is a secondary diagnostic only and must not be reported as
TROPOMI, CCTF, or infrastructure-transition accuracy.

## Limitations

The source CSVs are area averages for the bounding box 116E-127E, 4N-22N.
They contain no local spatial grid and cannot support local wind/plume claims.
"""
    (evaluation_dir / "model_card.md").write_text(model_card, encoding="utf-8")

    metrics["training_pipeline_seconds"] = perf_counter() - started
    (evaluation_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    print(
        f"[7/7] Complete in {metrics['training_pipeline_seconds']:.2f} seconds. "
        f"Evaluation: {evaluation_dir}",
        flush=True,
    )
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--raw-dir", default=str(ROOT / "data" / "raw" / "merra")
    )
    parser.add_argument(
        "--evaluation-dir",
        default=str(ROOT / "models" / "evaluation" / "merra"),
    )
    parser.add_argument(
        "--checkpoint-dir",
        default=str(ROOT / "models" / "checkpoints" / "merra"),
    )
    parser.add_argument("--horizon-hours", type=int, default=1)
    parser.add_argument("--random-state", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    result = train(parse_args())
    print(json.dumps(result, indent=2))
