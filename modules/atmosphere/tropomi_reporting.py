"""Diagnostics and presentation artifacts for TROPOMI weather experiments."""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
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


matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


BAND_LABELS = ("background", "elevated", "high")


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    """Compute unweighted held-out NO2 errors; bias is predicted minus actual."""

    return {
        "mae_umol_m2": float(mean_absolute_error(actual, predicted)),
        "median_ae_umol_m2": float(median_absolute_error(actual, predicted)),
        "rmse_umol_m2": float(math.sqrt(mean_squared_error(actual, predicted))),
        "r2": float(r2_score(actual, predicted)) if len(actual) > 1 and np.var(actual) > 0 else float("nan"),
        "bias_umol_m2": float(np.mean(predicted - actual)),
    }


def count_band(counts: pd.Series) -> pd.Categorical:
    """Group cell-month valid-orbit counts for sparse-observation diagnostics."""

    return pd.cut(
        counts,
        bins=[0, 9, 14, 19, 24, np.inf],
        labels=["5-9", "10-14", "15-19", "20-24", "25+"],
        include_lowest=True,
    )


def diagnostic_table(frame: pd.DataFrame, predictions: np.ndarray) -> pd.DataFrame:
    """Build row-level error data without filling any missing NO2 target."""

    diagnostics = frame[
        ["month", "year", "cell_id", "latitude", "longitude", "valid_orbit_count", "target_no2_umol_m2"]
    ].copy()
    diagnostics["predicted_no2_umol_m2"] = predictions
    diagnostics["error_umol_m2"] = predictions - diagnostics["target_no2_umol_m2"].to_numpy()
    diagnostics["absolute_error_umol_m2"] = diagnostics["error_umol_m2"].abs()
    diagnostics["valid_count_band"] = count_band(diagnostics["valid_orbit_count"])
    return diagnostics


def grouped_error(diagnostics: pd.DataFrame, group: str) -> pd.DataFrame:
    """Summarize MAE, bias, coverage count, and observed mean by a grouping."""

    summary = diagnostics.groupby(group, observed=True).agg(
        mae_umol_m2=("absolute_error_umol_m2", "mean"),
        bias_umol_m2=("error_umol_m2", "mean"),
        mean_observed_no2_umol_m2=("target_no2_umol_m2", "mean"),
        mean_valid_orbit_count=("valid_orbit_count", "mean"),
        rows=("cell_id", "size"),
    )
    return summary.reset_index()


def save_baseline_diagnosis(frame: pd.DataFrame, evaluation_dir: Path) -> dict[str, object]:
    """Run experiment A before fitting candidates and write baseline findings."""

    yearly_means = frame.groupby("year", observed=True).agg(
        mean_no2_umol_m2=("target_no2_umol_m2", "mean"),
        median_no2_umol_m2=("target_no2_umol_m2", "median"),
        mean_valid_orbit_count=("valid_orbit_count", "mean"),
        rows=("cell_id", "size"),
    ).reset_index()
    yearly_means.to_csv(evaluation_dir / "mean_no2_by_year.csv", index=False)

    heldout = frame.loc[frame["year"].isin([2024, 2025])]
    baseline = diagnostic_table(heldout, heldout["baseline_no2_umol_m2"].to_numpy())
    by_month = grouped_error(baseline, "month")
    by_month["month"] = by_month["month"].dt.strftime("%Y-%m")
    by_month.to_csv(evaluation_dir / "baseline_error_by_month.csv", index=False)
    by_year = grouped_error(baseline, "year")
    by_year.to_csv(evaluation_dir / "baseline_error_by_year.csv", index=False)
    by_count = grouped_error(baseline, "valid_count_band")
    by_count.to_csv(evaluation_dir / "baseline_error_by_valid_count.csv", index=False)
    by_cell = grouped_error(baseline.loc[baseline["year"].eq(2025)], "cell_id")
    by_cell.sort_values("mae_umol_m2", ascending=False).to_csv(
        evaluation_dir / "baseline_error_by_cell.csv", index=False
    )
    train_mean = float(yearly_means.loc[yearly_means["year"].between(2019, 2023), "mean_no2_umol_m2"].mean())
    test_mean = float(yearly_means.loc[yearly_means["year"].eq(2025), "mean_no2_umol_m2"].iloc[0])
    return {
        "train_annual_mean_of_means_umol_m2": train_mean,
        "test_2025_mean_umol_m2": test_mean,
        "test_minus_train_mean_umol_m2": test_mean - train_mean,
        "test_baseline_bias_umol_m2": float(by_year.loc[by_year["year"].eq(2025), "bias_umol_m2"].iloc[0]),
        "note": "Yearly means are descriptive; varying cell-month coverage limits trend interpretation.",
    }


def save_selected_diagnostics(
    frame: pd.DataFrame,
    predicted: np.ndarray,
    evaluation_dir: Path,
    random_state: int,
) -> pd.DataFrame:
    """Write selected-model error summaries and the requested evaluation plots."""

    plots_dir = evaluation_dir / "plots"
    plots_dir.mkdir(parents=True, exist_ok=True)
    diagnostics = diagnostic_table(frame, predicted)
    by_month = grouped_error(diagnostics, "month")
    by_month["month"] = by_month["month"].dt.strftime("%Y-%m")
    by_month.to_csv(evaluation_dir / "error_by_month.csv", index=False)
    by_year = grouped_error(diagnostics, "year")
    by_year.to_csv(evaluation_dir / "error_by_year.csv", index=False)
    by_count = grouped_error(diagnostics, "valid_count_band")
    by_count.to_csv(evaluation_dir / "error_by_valid_count.csv", index=False)
    test = diagnostics.loc[diagnostics["year"].eq(2025)].copy()
    by_cell = grouped_error(test, "cell_id")
    locations = test[["cell_id", "latitude", "longitude"]].drop_duplicates("cell_id")
    by_cell = by_cell.merge(locations, on="cell_id", how="left", validate="one_to_one")
    by_cell.sort_values("mae_umol_m2", ascending=False).to_csv(
        evaluation_dir / "error_by_cell.csv", index=False
    )

    figure, axis = plt.subplots(figsize=(11, 4.5))
    axis.plot(by_month["month"], by_month["mae_umol_m2"], marker="o", markersize=3)
    axis.tick_params(axis="x", rotation=75)
    axis.set_ylabel("MAE (µmol/m²)")
    axis.set_title("Held-out validation and test error by month")
    figure.tight_layout()
    figure.savefig(plots_dir / "error_by_month.png", dpi=150)
    plt.close(figure)

    figure, axis = plt.subplots(figsize=(5, 4))
    axis.bar(by_year["year"].astype(str), by_year["mae_umol_m2"])
    axis.set_ylabel("MAE (µmol/m²)")
    axis.set_title("Error by held-out year")
    figure.tight_layout()
    figure.savefig(plots_dir / "error_by_year.png", dpi=150)
    plt.close(figure)

    figure, axis = plt.subplots(figsize=(6, 4))
    axis.bar(by_count["valid_count_band"].astype(str), by_count["mae_umol_m2"])
    axis.set_xlabel("Valid-orbit count per cell-month")
    axis.set_ylabel("MAE (µmol/m²)")
    axis.set_title("Error by observation count")
    figure.tight_layout()
    figure.savefig(plots_dir / "error_by_valid_count.png", dpi=150)
    plt.close(figure)

    rng = np.random.default_rng(random_state)
    subset = test.iloc[rng.choice(len(test), min(15000, len(test)), replace=False)]
    figure, axis = plt.subplots(figsize=(6, 6))
    axis.scatter(subset["target_no2_umol_m2"], subset["predicted_no2_umol_m2"], s=5, alpha=0.25)
    limits = [
        min(subset["target_no2_umol_m2"].min(), subset["predicted_no2_umol_m2"].min()),
        max(subset["target_no2_umol_m2"].max(), subset["predicted_no2_umol_m2"].max()),
    ]
    axis.plot(limits, limits, color="black", linewidth=1)
    axis.set_xlabel("Observed NO₂ (µmol/m²)")
    axis.set_ylabel("Predicted NO₂ (µmol/m²)")
    axis.set_title("Held-out 2025: predicted vs actual")
    figure.tight_layout()
    figure.savefig(plots_dir / "predictions_vs_actual.png", dpi=150)
    plt.close(figure)

    figure, axis = plt.subplots(figsize=(7, 4))
    axis.hist(-test["error_umol_m2"], bins=60)
    axis.axvline(0, color="black", linewidth=1)
    axis.set_xlabel("Observed minus predicted NO₂ (µmol/m²)")
    axis.set_title("Held-out 2025 residual histogram")
    figure.tight_layout()
    figure.savefig(plots_dir / "residual_histogram.png", dpi=150)
    plt.close(figure)

    mean_residual = test.groupby("cell_id", observed=True)["error_umol_m2"].mean().reset_index()
    mean_residual = mean_residual.merge(locations, on="cell_id", validate="one_to_one")
    vmax = float(np.quantile(np.abs(mean_residual["error_umol_m2"]), 0.98))
    figure, axis = plt.subplots(figsize=(7, 8))
    scatter = axis.scatter(
        mean_residual["longitude"], mean_residual["latitude"],
        c=-mean_residual["error_umol_m2"], cmap="coolwarm", vmin=-vmax, vmax=vmax,
        marker="s", s=14,
    )
    axis.set_xlabel("Longitude")
    axis.set_ylabel("Latitude")
    axis.set_title("Mean held-out 2025 residual by cell")
    figure.colorbar(scatter, ax=axis, label="Observed minus predicted (µmol/m²)")
    figure.tight_layout()
    figure.savefig(plots_dir / "mean_anomaly_map.png", dpi=150)
    plt.close(figure)
    return diagnostics


def save_band_diagnostic(
    train_actual: np.ndarray,
    test_actual: np.ndarray,
    test_predicted: np.ndarray,
    evaluation_dir: Path,
) -> dict[str, object]:
    """Write the secondary low/medium/high regression diagnostic."""

    thresholds = tuple(np.quantile(train_actual, [1 / 3, 2 / 3]).tolist())
    actual_band = np.digitize(test_actual, thresholds, right=True)
    predicted_band = np.digitize(test_predicted, thresholds, right=True)
    matrix = confusion_matrix(actual_band, predicted_band, labels=[0, 1, 2])
    pd.DataFrame(
        matrix,
        index=[f"actual_{label}" for label in BAND_LABELS],
        columns=[f"predicted_{label}" for label in BAND_LABELS],
    ).to_csv(evaluation_dir / "confusion_matrix.csv")

    figure, axis = plt.subplots(figsize=(6, 5))
    heatmap = axis.imshow(matrix, cmap="Blues")
    axis.set_xticks(range(3), BAND_LABELS)
    axis.set_yticks(range(3), BAND_LABELS)
    axis.set_xlabel("Predicted concentration band")
    axis.set_ylabel("Observed concentration band")
    axis.set_title("Held-out 2025 NO₂ band diagnostic")
    for row in range(3):
        for column in range(3):
            axis.text(column, row, f"{matrix[row, column]:,}", ha="center", va="center")
    figure.colorbar(heatmap, ax=axis)
    figure.tight_layout()
    figure.savefig(evaluation_dir / "plots" / "confusion_matrix.png", dpi=150)
    plt.close(figure)
    return {
        "accuracy": float(accuracy_score(actual_band, predicted_band)),
        "balanced_accuracy": float(balanced_accuracy_score(actual_band, predicted_band)),
        "macro_f1": float(f1_score(actual_band, predicted_band, average="macro")),
        "thresholds_umol_m2": list(thresholds),
        "note": "Secondary NO2 concentration bands; not event or CCTF accuracy.",
    }
