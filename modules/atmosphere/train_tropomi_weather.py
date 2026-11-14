"""Compare monthly MERRA-2 weather corrections with TROPOMI climatology.

Run with ``python -m modules.atmosphere.train_tropomi_weather``. All model
selection uses January-June 2024. July-September 2024 calibrates intervals;
October-December 2024 checks interval coverage. The locked 2025 period is
evaluated once after candidate and acceptance rules are fixed. An optional
later year can be scored as a forward holdout without affecting selection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from time import perf_counter

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from modules.atmosphere.tropomi_features import (
    RANDOM_STATE,
    climatology_prediction,
    load_experiment_data,
)
from modules.atmosphere.tropomi_reporting import (
    regression_metrics,
    save_band_diagnostic,
    save_baseline_diagnosis,
    save_selected_diagnostics,
)


ROOT = Path(__file__).resolve().parents[2]
BASELINE = "spatial_seasonal_climatology"
CORE_FEATURES = [
    "latitude", "longitude", "latitude_sq", "longitude_sq", "latitude_longitude",
    "month_sin", "month_cos", "training_baseline_no2_umol_m2", "qa_mean",
    "coverage_fraction", "valid_orbit_count",
]
SPATIAL_FEATURES = ["neighbor_prior_no2_umol_m2", "year_index"]


class ResidualEnsemble:
    """Average compatible residual regressors for permutation inspection."""

    def __init__(self, models: list[object]):
        self.models = models

    def fit(self, features: pd.DataFrame, target: np.ndarray) -> "ResidualEnsemble":
        """Expose the estimator interface; component models are already fitted."""

        return self

    def predict(self, features: pd.DataFrame) -> np.ndarray:
        """Return the mean predicted climatology residual."""

        return np.mean([model.predict(features) for model in self.models], axis=0)


def candidate_specs(weather_features: list[str]) -> list[dict[str, object]]:
    """Return fixed, small candidates and matched no-weather controls."""

    specs = [
        ("ridge_core", "ridge", "B", CORE_FEATURES, None),
        ("hgb_core", "hgb", "B", CORE_FEATURES, None),
        ("ridge_weather", "ridge", "C", CORE_FEATURES + weather_features, "ridge_core"),
        ("hgb_weather", "hgb", "C", CORE_FEATURES + weather_features, "hgb_core"),
        ("ridge_spatial_control", "ridge", "D", CORE_FEATURES + SPATIAL_FEATURES, None),
        ("ridge_spatial_weather", "ridge", "D", CORE_FEATURES + SPATIAL_FEATURES + weather_features, "ridge_spatial_control"),
        ("hgb_spatial_control", "hgb", "D", CORE_FEATURES + SPATIAL_FEATURES, None),
        ("hgb_spatial_weather", "hgb", "D", CORE_FEATURES + SPATIAL_FEATURES + weather_features, "hgb_spatial_control"),
        ("xgb_spatial_control", "xgb", "E", CORE_FEATURES + SPATIAL_FEATURES, None),
        ("xgb_spatial_weather", "xgb", "E", CORE_FEATURES + SPATIAL_FEATURES + weather_features, "xgb_spatial_control"),
    ]
    return [
        {
            "name": name,
            "kind": kind,
            "stage": stage,
            "features": features,
            "control": control,
            "weather": control is not None,
        }
        for name, kind, stage, features, control in specs
    ]


def make_model(kind: str, random_state: int):
    """Build a fixed regularized model; no hyperparameter search touches 2025."""

    if kind == "ridge":
        return Pipeline(
            [
                ("impute", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)),
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=50.0, random_state=random_state)),
            ]
        )
    if kind == "hgb":
        return HistGradientBoostingRegressor(
            loss="absolute_error",
            learning_rate=0.05,
            max_iter=150,
            max_leaf_nodes=15,
            min_samples_leaf=200,
            l2_regularization=5.0,
            early_stopping=False,
            random_state=random_state,
        )
    if kind == "xgb":
        return XGBRegressor(
            objective="reg:squarederror",
            n_estimators=140,
            max_depth=4,
            learning_rate=0.05,
            min_child_weight=50,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_lambda=10.0,
            tree_method="hist",
            n_jobs=4,
            random_state=random_state,
        )
    raise ValueError(f"Unknown model kind: {kind}")


def _fit(model, kind: str, features: pd.DataFrame, target: pd.Series, weights: pd.Series) -> None:
    """Fit one candidate using only 2019-2023 examples and training-only transforms."""

    if kind == "ridge":
        model.fit(features, target, model__sample_weight=weights)
    else:
        model.fit(features, target, sample_weight=weights)


def _conformal_quantile(errors: np.ndarray, miscoverage: float) -> float:
    """Finite-sample absolute-error quantile for a split conformal interval."""

    if not len(errors):
        raise ValueError("Conformal calibration has no observations")
    rank = min(len(errors), math.ceil((len(errors) + 1) * (1 - miscoverage)))
    return float(np.sort(errors)[rank - 1])


def _json_write(path: Path, payload: dict[str, object]) -> None:
    """Write a strictly valid, human-readable JSON artifact."""

    path.write_text(json.dumps(payload, indent=2, allow_nan=False), encoding="utf-8")


def _sha256_file(path: Path) -> str:
    """Hash a file in bounded chunks for input provenance."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _score_rows(
    name: str,
    feature_set: str,
    frame: pd.DataFrame,
    predictions: dict[str, np.ndarray],
    baseline_metrics: dict[str, dict[str, float]],
    seconds: float | None,
) -> list[dict[str, object]]:
    """Score validation and test against the identical climatology rows."""

    rows = []
    for split in ("validation", "test"):
        actual = frame.loc[frame["year"].eq(2024 if split == "validation" else 2025), "target_no2_umol_m2"].to_numpy()
        metrics = regression_metrics(actual, predictions[split])
        baseline_mae = baseline_metrics[split]["mae_umol_m2"]
        rows.append(
            {
                "model": name,
                "features": feature_set,
                "split": split,
                **metrics,
                "mae_change_vs_climatology_percent": 100 * (baseline_mae - metrics["mae_umol_m2"]) / baseline_mae,
                "training_seconds": seconds if split == "validation" else None,
            }
        )
    return rows


def _selection_mae(frame: pd.DataFrame, predicted: np.ndarray) -> float:
    """Score January-June 2024 only for model selection."""

    early = frame["month_number"].le(6).to_numpy()
    return regression_metrics(frame.loc[early, "target_no2_umol_m2"].to_numpy(), predicted[early])["mae_umol_m2"]


def _forward_holdout_metrics(
    frame: pd.DataFrame,
    year: int,
    baseline_prediction: np.ndarray,
    control_name: str,
    control_prediction: np.ndarray,
    candidate_name: str,
    candidate_prediction: np.ndarray,
) -> dict[str, object]:
    """Score a later year after candidate selection and without training on it."""

    if frame.empty or not frame["year"].eq(year).all():
        raise ValueError(f"Forward holdout must contain observations from {year} only")
    if any(
        len(prediction) != len(frame)
        for prediction in (baseline_prediction, control_prediction, candidate_prediction)
    ):
        raise ValueError("Forward-holdout predictions must align with its observations")

    actual = frame["target_no2_umol_m2"].to_numpy()
    baseline_metrics = regression_metrics(actual, baseline_prediction)
    control_metrics = regression_metrics(actual, control_prediction)
    candidate_metrics = regression_metrics(actual, candidate_prediction)
    baseline_improvement = 100 * (
        baseline_metrics["mae_umol_m2"] - candidate_metrics["mae_umol_m2"]
    ) / baseline_metrics["mae_umol_m2"]
    control_improvement = 100 * (
        control_metrics["mae_umol_m2"] - candidate_metrics["mae_umol_m2"]
    ) / control_metrics["mae_umol_m2"]
    return {
        "year": year,
        "rows": int(len(frame)),
        "months": sorted(frame["month"].dt.strftime("%Y-%m").unique().tolist()),
        "frozen_candidates_not_used_for_training_or_selection": True,
        "baseline_model": BASELINE,
        "baseline": baseline_metrics,
        "matched_no_weather_control_model": control_name,
        "matched_no_weather_control": control_metrics,
        "candidate_model_selected_on_2024_validation": candidate_name,
        "candidate": candidate_metrics,
        "candidate_mae_improvement_over_climatology_percent": float(baseline_improvement),
        "weather_mae_improvement_over_matched_control_percent": float(control_improvement),
    }


def _compare_climatology_windows(
    frame: pd.DataFrame,
    holdout: pd.DataFrame,
    year: int,
    original_baseline: np.ndarray,
) -> tuple[dict[str, object], pd.DataFrame]:
    """Compare recent-history climatologies as development candidates."""

    if holdout.empty or not holdout["year"].eq(year).all():
        raise ValueError(f"Climatology development data must contain year {year} only")
    if len(original_baseline) != len(holdout):
        raise ValueError("Original climatology predictions must align with development data")

    history_end = year - 1
    windows = {
        f"climatology_{2019}_{history_end}": 2019,
        f"climatology_{max(2019, history_end - 4)}_{history_end}": max(
            2019, history_end - 4
        ),
        f"climatology_{max(2019, history_end - 2)}_{history_end}": max(
            2019, history_end - 2
        ),
    }
    actual = holdout["target_no2_umol_m2"].to_numpy()
    original_metrics = regression_metrics(actual, original_baseline)
    prediction_columns: dict[str, np.ndarray] = {
        "original_climatology_2019_2023_no2_umol_m2": original_baseline
    }
    results: dict[str, object] = {}
    for name, start_year in windows.items():
        history = frame.loc[frame["year"].between(start_year, history_end)]
        if history.empty:
            raise ValueError(f"No historical observations available for {name}")
        predicted = climatology_prediction(holdout, history).to_numpy(dtype=np.float64)
        candidate_metrics = regression_metrics(actual, predicted)
        results[name] = {
            "training_start_year": start_year,
            "training_end_year": history_end,
            "training_rows": int(len(history)),
            "metrics": candidate_metrics,
            "mae_improvement_over_original_climatology_percent": float(
                100
                * (original_metrics["mae_umol_m2"] - candidate_metrics["mae_umol_m2"])
                / original_metrics["mae_umol_m2"]
            ),
        }
        prediction_columns[f"{name}_no2_umol_m2"] = predicted

    best_candidate = min(
        results,
        key=lambda name: results[name]["metrics"]["mae_umol_m2"],
    )
    report = {
        "purpose": "post-hoc development comparison; not an independent test",
        "year": year,
        "rows": int(len(holdout)),
        "months": sorted(holdout["month"].dt.strftime("%Y-%m").unique().tolist()),
        "training_data_through_year": history_end,
        "original_climatology_metrics": original_metrics,
        "best_development_candidate": best_candidate,
        "candidates": results,
        "note": (
            "The 2026 observations were used to compare recency windows. "
            "Do not report this comparison as an untouched test or update the "
            "production model without a later holdout."
        ),
    }
    predictions = pd.DataFrame(
        {
            "month": holdout["month"].dt.strftime("%Y-%m").to_numpy(),
            "cell_id": holdout["cell_id"].to_numpy(),
            "actual_no2_umol_m2": actual,
            **prediction_columns,
        }
    )
    return report, predictions


def _compare_expanded_training(
    frame: pd.DataFrame,
    holdout: pd.DataFrame,
    year: int,
    specs: list[dict[str, object]],
    random_state: int,
) -> tuple[dict[str, object], pd.DataFrame]:
    """Refit fixed regression candidates through the year before development."""

    if holdout.empty or not holdout["year"].eq(year).all():
        raise ValueError(f"Expanded-training development data must contain year {year} only")
    history_end = year - 1
    train = frame.loc[frame["year"].between(2020, history_end)]
    if train.empty:
        raise ValueError("Expanded training requires observations from 2020 onward")

    actual = holdout["target_no2_umol_m2"].to_numpy()
    baseline = holdout["baseline_no2_umol_m2"].to_numpy()
    baseline_metrics = regression_metrics(actual, baseline)
    predictions: dict[str, np.ndarray] = {BASELINE: baseline}
    for spec in specs:
        name, kind = str(spec["name"]), str(spec["kind"])
        features = list(spec["features"])
        model = make_model(kind, random_state)
        _fit(
            model,
            kind,
            train[features],
            train["target_residual_umol_m2"],
            train["sample_weight"],
        )
        predictions[name] = baseline + model.predict(holdout[features])

    for suffix, components in (
        ("control", ("ridge_spatial_control", "hgb_spatial_control", "xgb_spatial_control")),
        ("weather", ("ridge_spatial_weather", "hgb_spatial_weather", "xgb_spatial_weather")),
    ):
        if all(name in predictions for name in components):
            predictions[f"ensemble_spatial_{suffix}"] = np.mean(
                [predictions[name] for name in components], axis=0
            )

    candidate_results = {}
    for name, predicted in predictions.items():
        candidate_metrics = regression_metrics(actual, predicted)
        candidate_results[name] = {
            "metrics": candidate_metrics,
            "mae_improvement_over_original_climatology_percent": float(
                100
                * (baseline_metrics["mae_umol_m2"] - candidate_metrics["mae_umol_m2"])
                / baseline_metrics["mae_umol_m2"]
            ),
        }

    weather_names = [str(spec["name"]) for spec in specs if spec["weather"]]
    if "ensemble_spatial_weather" in predictions:
        weather_names.append("ensemble_spatial_weather")
    control_of = {
        str(spec["name"]): str(spec["control"])
        for spec in specs
        if spec["weather"]
    }
    control_of["ensemble_spatial_weather"] = "ensemble_spatial_control"
    best_weather = (
        min(
            weather_names,
            key=lambda name: candidate_results[name]["metrics"]["mae_umol_m2"],
        )
        if weather_names
        else None
    )
    matched_control = control_of[best_weather] if best_weather is not None else None
    weather_improvement = None
    if best_weather is not None and matched_control in candidate_results:
        control_mae = candidate_results[matched_control]["metrics"]["mae_umol_m2"]
        weather_mae = candidate_results[best_weather]["metrics"]["mae_umol_m2"]
        weather_improvement = float(100 * (control_mae - weather_mae) / control_mae)
    report = {
        "purpose": "post-hoc development comparison; not an independent test",
        "training_start_year": 2020,
        "training_end_year": history_end,
        "training_rows": int(len(train)),
        "year": year,
        "rows": int(len(holdout)),
        "months": sorted(holdout["month"].dt.strftime("%Y-%m").unique().tolist()),
        "original_climatology_model": BASELINE,
        "best_development_candidate": min(
            (name for name in predictions if name != BASELINE),
            key=lambda name: candidate_results[name]["metrics"]["mae_umol_m2"],
        ),
        "best_development_weather_candidate": best_weather,
        "matched_no_weather_control": matched_control,
        "weather_improvement_over_matched_control_percent": weather_improvement,
        "candidate_results": candidate_results,
        "note": (
            "Models use observations through the year before the development "
            "period. The development period was used to compare candidates; "
            "do not use these results as an independent test or change the "
            "production model without a later holdout."
        ),
    }
    prediction_frame = pd.DataFrame(
        {
            "month": holdout["month"].dt.strftime("%Y-%m").to_numpy(),
            "cell_id": holdout["cell_id"].to_numpy(),
            "actual_no2_umol_m2": actual,
            **{
                f"{name}_no2_umol_m2": predicted
                for name, predicted in predictions.items()
            },
        }
    )
    return report, prediction_frame


def _write_readme(
    path: Path,
    metrics: dict[str, object],
    comparison: pd.DataFrame,
    importance: pd.DataFrame,
    evaluation_dir: Path,
) -> None:
    """Summarize weather effect, important features, failure modes, and gate."""

    candidate = metrics["best_weather_candidate"]
    validation = comparison.loc[(comparison["model"] == candidate) & (comparison["split"] == "validation")].iloc[0]
    test = comparison.loc[(comparison["model"] == candidate) & (comparison["split"] == "test")].iloc[0]
    month = pd.read_csv(evaluation_dir / "error_by_month.csv")
    cells = pd.read_csv(evaluation_dir / "error_by_cell.csv")
    count = pd.read_csv(evaluation_dir / "error_by_valid_count.csv")
    top_features = ", ".join(importance.head(5)["feature"].tolist()) if not importance.empty else "not available"
    worst_months = ", ".join(month.nlargest(3, "mae_umol_m2")["month"].astype(str))
    worst_cells = ", ".join(
        f"{row.cell_id} (n={row.rows})"
        for row in cells.nlargest(3, "mae_umol_m2").itertuples(index=False)
    )
    sparse = count.loc[count["valid_count_band"].eq("5-9")]
    sparse_text = (
        f"5-9 valid-orbit cell-months have MAE {float(sparse['mae_umol_m2'].iloc[0]):.3f} µmol/m²"
        if not sparse.empty else "no 5-9 valid-orbit cell-months were available"
    )
    gate = metrics["acceptance_gate"]
    helped = gate["weather_beats_matched_control_on_selection_validation"]
    selected = metrics["selected_model"]
    diagnosis = metrics["baseline_diagnosis"]
    selection_scores = metrics["candidate_results"]
    baseline_selection_mae = selection_scores[BASELINE]["selection_validation_mae_umol_m2"]
    candidate_selection_mae = selection_scores[candidate]["selection_validation_mae_umol_m2"]
    forward = metrics.get("forward_holdout")
    forward_note = ""
    if forward:
        forward_note = f"""

## Forward holdout

- Year: {forward['year']}; evaluated months: {", ".join(forward['months'])}.
- Rows: {forward['rows']:,}; candidate selected on 2024 validation:
  `{forward['candidate_model_selected_on_2024_validation']}`.
- Climatology MAE: {forward['baseline']['mae_umol_m2']:.3f} µmol/m²;
  candidate MAE: {forward['candidate']['mae_umol_m2']:.3f} µmol/m².
- Matched no-weather control `{forward['matched_no_weather_control_model']}` MAE:
  {forward['matched_no_weather_control']['mae_umol_m2']:.3f} µmol/m².
- Candidate MAE improvement versus climatology:
  {forward['candidate_mae_improvement_over_climatology_percent']:+.2f}%.
- Weather MAE improvement versus matched control:
  {forward['weather_mae_improvement_over_matched_control_percent']:+.2f}%.

This later-year score is reported only after model selection and is not used to
change the fixed weather-model selection or acceptance gate.
"""
    development = metrics.get("development_climatology_windows")
    development_note = ""
    if development:
        best_window = development["best_development_candidate"]
        best_result = development["candidates"][best_window]
        development_note = f"""

## Recent-climatology development

- Best evaluated window: `{best_window}` ({best_result['training_start_year']}-{best_result['training_end_year']}).
- MAE: {best_result['metrics']['mae_umol_m2']:.3f} µmol/m² versus
  {development['original_climatology_metrics']['mae_umol_m2']:.3f} µmol/m² for
  the original climatology.
- This comparison uses 2026 as development data and is not an independent test.
  Production remains unchanged; reserve a later period for confirmation.
"""
    expanded = metrics.get("expanded_training_comparison")
    expanded_note = ""
    if expanded:
        best_refit = expanded["best_development_candidate"]
        best_result = expanded["candidate_results"][best_refit]
        weather_improvement = expanded[
            "weather_improvement_over_matched_control_percent"
        ]
        if weather_improvement is None:
            weather_result = "No weather candidate was available for comparison."
        else:
            weather_result = (
                f"Best weather candidate: "
                f"`{expanded['best_development_weather_candidate']}`; matched "
                f"control: `{expanded['matched_no_weather_control']}`; weather "
                f"MAE improvement over control: {weather_improvement:+.2f}%."
            )
        expanded_note = f"""

## Expanded-training development

- Training years: {expanded['training_start_year']}-{expanded['training_end_year']}.
- Best refit candidate: `{best_refit}`; MAE:
  {best_result['metrics']['mae_umol_m2']:.3f} µmol/m².
- {weather_result}
- 2026 was used for development comparison, not independent testing or
  production selection.
"""
    note = f"""# TROPOMI weather experiment

The fixed monthly Philippines experiment trained on 2019-2023, selected a
candidate on January-June 2024, calibrated a 90% interval on July-September
2024, checked interval coverage on October-December 2024, and evaluated 2025
once in this fixed run. Earlier baseline work already inspected 2025, so this
is a locked temporal test rather than a never-seen blind test. The source
TROPOMI table contains monthly cell means; MERRA weather is a
Philippines-wide area average, so 05:30 UTC summaries cannot be matched to
each cell's exact valid orbit dates.

The climatology uses 2019-2023. Residual regressors fit 2020-2023 examples:
each training-row climatology and neighbor prior uses strictly earlier years,
with 2019 supplying the first prior.

## Result

- Selected: `{selected}`; best weather candidate: `{candidate}`.
- Candidate validation MAE: {float(validation['mae_umol_m2']):.3f} µmol/m².
- January-June 2024 selection MAE: candidate {candidate_selection_mae:.3f}
  versus climatology {baseline_selection_mae:.3f} µmol/m².
- Candidate test MAE: {float(test['mae_umol_m2']):.3f} µmol/m²; test change versus climatology: {float(test['mae_change_vs_climatology_percent']):+.2f}%.
- Weather beat its matched no-weather control on the selection period: `{helped}`.
- The 5% test MAE condition was met: `{gate['mae_improvement_at_least_5_percent']}`.
- The full weather-adjustment gate passed: `{gate['passed']}`.
- Anomaly interpretation: `{metrics['anomaly_interpretation']}`.
- Empirical 90% interval coverage on October-December 2024: {metrics['uncertainty']['validation_check_coverage']:.1%}.
- Empirical interval coverage on 2025: {metrics['uncertainty']['test_coverage']:.1%}.

The weather claim requires the fixed 5% test MAE improvement, R² at least
0.70, and selection-period MAE better than both climatology and the matched
no-weather control. This candidate lost to climatology in January-June 2024,
so its 2025 gain cannot be used to select it after seeing the test result. A
year trend alone cannot establish a weather correction. Climatology remains
the predictor and significant anomalies are only climatology residuals outside
the calibrated interval.

## Diagnostics

- Largest selected-model errors by month: {worst_months}.
- Largest selected-model errors by cell ID: {worst_cells}.
- Sparse observation count: {sparse_text}.
- Top permutation features of the best weather candidate: {top_features}.
- Positive bias means overprediction; the current selected test bias is {metrics['test']['bias_umol_m2']:+.3f} µmol/m².
- The observed 2025 mean is {diagnosis['test_2025_mean_umol_m2']:.3f} µmol/m²
  versus {diagnosis['train_annual_mean_of_means_umol_m2']:.3f} µmol/m² for the
  2019-2023 annual-mean average. The test year is lower, consistent with the
  positive baseline bias. Sampling coverage changes, so this is not proof of
  a physical long-term trend.
- Observed yearly means and coverage counts are in `mean_no2_by_year.csv`;
  varying coverage makes their trend descriptive, not causal.

See `model_comparison.csv`, `feature_importance.csv`, `error_by_month.csv`,
`error_by_year.csv`, `error_by_valid_count.csv`, `error_by_cell.csv`, and `plots/`.
The per-cell monthly observation counts, including explicit zero counts, are
in `observation_counts.csv.gz`. Classification band accuracy is a secondary
diagnostic, not the accuracy of NO₂ regression or CCTF source attribution.
{forward_note}{development_note}{expanded_note}"""
    path.write_text(note, encoding="utf-8")


def run(args: argparse.Namespace) -> dict[str, object]:
    """Run diagnostic, residual, weather, spatial, model, and interval stages."""

    started = perf_counter()
    evaluation_dir = Path(args.evaluation_dir)
    checkpoint_dir = Path(args.checkpoint_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    print("[A] Loading monthly TROPOMI and hourly MERRA; diagnosing baseline", flush=True)
    frame, counts, weather_features, quality = load_experiment_data(
        args.tropomi_path, args.merra_dir, args.boundary_path, args.minimum_valid_orbits
    )
    counts.to_csv(evaluation_dir / "observation_counts.csv.gz", index=False)
    climatology_train = frame.loc[frame["year"].between(2019, 2023)]
    train = frame.loc[frame["year"].between(2020, 2023)]
    validation = frame.loc[frame["year"].eq(2024)]
    test = frame.loc[frame["year"].eq(2025)]
    if min(len(train), len(validation), len(test)) == 0:
        raise ValueError("The fixed chronological split requires 2019-2025 observations")
    forward_frame = None
    if args.forward_test_year is not None:
        if args.forward_test_year <= 2025:
            raise ValueError("--forward-test-year must be later than the fixed 2025 test")
        forward_frame = frame.loc[frame["year"].eq(args.forward_test_year)].copy()
        if forward_frame.empty:
            raise ValueError(
                f"No eligible TROPOMI observations for forward holdout year "
                f"{args.forward_test_year}"
            )
    if args.compare_climatology_windows and forward_frame is None:
        raise ValueError("--compare-climatology-windows requires --forward-test-year")
    if args.compare_expanded_training and forward_frame is None:
        raise ValueError("--compare-expanded-training requires --forward-test-year")
    quality["split_sizes"] = {
        "train": len(climatology_train),
        "residual_model_train": len(train),
        "validation": len(validation),
        "test": len(test),
    }
    if forward_frame is not None:
        quality["split_sizes"]["forward_test"] = len(forward_frame)
    quality["missing_feature_values"] = {
        key: int(value) for key, value in frame[[*CORE_FEATURES, *SPATIAL_FEATURES, *weather_features]].isna().sum().items()
    }
    _json_write(evaluation_dir / "data_quality_report.json", quality)
    diagnosis = save_baseline_diagnosis(frame, evaluation_dir)
    print(
        f"    Rows climatology train={len(climatology_train):,}, residual train={len(train):,}, "
        f"validation={len(validation):,}, test={len(test):,}; "
        f"2025 baseline bias={diagnosis['test_baseline_bias_umol_m2']:+.3f}",
        flush=True,
    )

    baseline_predictions = {
        "validation": validation["baseline_no2_umol_m2"].to_numpy(),
        "test": test["baseline_no2_umol_m2"].to_numpy(),
    }
    baseline_metrics = {
        split: regression_metrics(
            partition["target_no2_umol_m2"].to_numpy(), baseline_predictions[split]
        )
        for split, partition in (("validation", validation), ("test", test))
    }
    predictions: dict[str, dict[str, np.ndarray]] = {BASELINE: baseline_predictions}
    comparison_rows = _score_rows(BASELINE, "training-only cell-month climatology", frame, baseline_predictions, baseline_metrics, None)
    selection_mae = {BASELINE: _selection_mae(validation, baseline_predictions["validation"])}
    fitted: dict[str, object] = {}
    forward_predictions: dict[str, np.ndarray] = {}
    if forward_frame is not None:
        forward_predictions[BASELINE] = forward_frame[
            "baseline_no2_umol_m2"
        ].to_numpy()
    specs = candidate_specs(weather_features)

    print("[B] Training residual-only spatial and seasonal controls", flush=True)
    for spec in specs:
        name = str(spec["name"])
        stage = str(spec["stage"])
        if name == "ridge_weather":
            print("[C] Adding matched MERRA weather, wind, 05:30, calm, and lag features", flush=True)
        elif name == "ridge_spatial_control":
            print("[D] Adding training-only neighbor context and a separate trend control", flush=True)
        elif name == "xgb_spatial_control":
            print("[E] Comparing regularized XGBoost and simple ensembles", flush=True)
        features = list(spec["features"])
        model = make_model(str(spec["kind"]), args.random_state)
        model_started = perf_counter()
        _fit(
            model,
            str(spec["kind"]),
            train[features],
            train["target_residual_umol_m2"],
            train["sample_weight"],
        )
        fit_seconds = perf_counter() - model_started
        fitted[name] = model
        predicted = {
            "validation": validation["baseline_no2_umol_m2"].to_numpy() + model.predict(validation[features]),
            "test": test["baseline_no2_umol_m2"].to_numpy() + model.predict(test[features]),
        }
        if forward_frame is not None:
            forward_predictions[name] = (
                forward_frame["baseline_no2_umol_m2"].to_numpy()
                + model.predict(forward_frame[features])
            )
        predictions[name] = predicted
        selection_mae[name] = _selection_mae(validation, predicted["validation"])
        feature_label = f"{stage}: {len(features)} features; {'MERRA weather' if spec['weather'] else 'no MERRA weather'}"
        comparison_rows.extend(_score_rows(name, feature_label, frame, predicted, baseline_metrics, fit_seconds))
        print(f"    {name}: selection MAE={selection_mae[name]:.4f}; fit={fit_seconds:.1f}s", flush=True)

    for suffix, components in (
        ("control", ("ridge_spatial_control", "hgb_spatial_control", "xgb_spatial_control")),
        ("weather", ("ridge_spatial_weather", "hgb_spatial_weather", "xgb_spatial_weather")),
    ):
        name = f"ensemble_spatial_{suffix}"
        predicted = {
            split: np.mean([predictions[component][split] for component in components], axis=0)
            for split in ("validation", "test")
        }
        if forward_frame is not None:
            forward_predictions[name] = np.mean(
                [forward_predictions[component] for component in components], axis=0
            )
        predictions[name] = predicted
        selection_mae[name] = _selection_mae(validation, predicted["validation"])
        comparison_rows.extend(
            _score_rows(name, f"E: mean of 3 {suffix} residual models", frame, predicted, baseline_metrics, 0.0)
        )

    comparison = pd.DataFrame(comparison_rows)
    comparison["selection_validation_mae_umol_m2"] = comparison["model"].map(selection_mae)
    comparison.to_csv(evaluation_dir / "model_comparison.csv", index=False)
    weather_names = [str(spec["name"]) for spec in specs if spec["weather"]] + ["ensemble_spatial_weather"]
    best_weather = min(weather_names, key=selection_mae.__getitem__)
    best_trained = min((name for name in predictions if name != BASELINE), key=selection_mae.__getitem__)
    control_of = {str(spec["name"]): str(spec["control"]) for spec in specs if spec["weather"]}
    control_of["ensemble_spatial_weather"] = "ensemble_spatial_control"
    control = control_of[best_weather]
    candidate_test = regression_metrics(test["target_no2_umol_m2"].to_numpy(), predictions[best_weather]["test"])
    candidate_improvement = 100 * (
        baseline_metrics["test"]["mae_umol_m2"] - candidate_test["mae_umol_m2"]
    ) / baseline_metrics["test"]["mae_umol_m2"]
    gate = {
        "candidate_model": best_weather,
        "matched_no_weather_control": control,
        "mae_better_than_climatology": candidate_test["mae_umol_m2"] < baseline_metrics["test"]["mae_umol_m2"],
        "mae_improvement_at_least_5_percent": candidate_improvement >= 5.0,
        "weather_beats_matched_control_on_selection_validation": selection_mae[best_weather] < selection_mae[control],
        "beats_climatology_on_selection_validation": selection_mae[best_weather] < selection_mae[BASELINE],
        "r2_at_least_0_70": candidate_test["r2"] >= 0.70,
        "r2_stretch_0_90": candidate_test["r2"] >= 0.90,
    }
    gate["passed"] = bool(
        gate["mae_improvement_at_least_5_percent"]
        and gate["weather_beats_matched_control_on_selection_validation"]
        and gate["beats_climatology_on_selection_validation"]
        and gate["r2_at_least_0_70"]
    )
    selected_name = best_weather if gate["passed"] else BASELINE
    forward_report = None
    development_climatology_report = None
    development_climatology_predictions = None
    expanded_training_report = None
    expanded_training_predictions = None
    if forward_frame is not None:
        forward_report = _forward_holdout_metrics(
            forward_frame,
            args.forward_test_year,
            forward_predictions[BASELINE],
            control,
            forward_predictions[control],
            best_weather,
            forward_predictions[best_weather],
        )
        forward_report["selected_model_from_fixed_evaluation"] = selected_name
        if args.compare_climatology_windows:
            (
                development_climatology_report,
                development_climatology_predictions,
            ) = _compare_climatology_windows(
                frame,
                forward_frame,
                args.forward_test_year,
                forward_predictions[BASELINE],
            )
        if args.compare_expanded_training:
            expanded_training_report, expanded_training_predictions = (
                _compare_expanded_training(
                    frame,
                    forward_frame,
                    args.forward_test_year,
                    specs,
                    args.random_state,
                )
            )
    selected = predictions[selected_name]
    selected_test = regression_metrics(test["target_no2_umol_m2"].to_numpy(), selected["test"])
    selected_improvement = 100 * (
        baseline_metrics["test"]["mae_umol_m2"] - selected_test["mae_umol_m2"]
    ) / baseline_metrics["test"]["mae_umol_m2"]
    interpretation = "weather-adjusted residual" if gate["passed"] else "climatology residual"
    print(
        f"    Best weather={best_weather}; candidate test change={candidate_improvement:+.2f}%; "
        f"gate={gate['passed']}; selected={selected_name}",
        flush=True,
    )

    print("[F] Calibrating intervals on July-September 2024; checking October-December", flush=True)
    calibration = validation["month_number"].between(7, 9).to_numpy()
    interval_check = validation["month_number"].between(10, 12).to_numpy()
    calibration_errors = np.abs(
        validation["target_no2_umol_m2"].to_numpy()[calibration] - selected["validation"][calibration]
    )
    interval_radius = _conformal_quantile(calibration_errors, miscoverage=0.10)
    validation_check_errors = np.abs(
        validation["target_no2_umol_m2"].to_numpy()[interval_check]
        - selected["validation"][interval_check]
    )
    test_errors = np.abs(test["target_no2_umol_m2"].to_numpy() - selected["test"])
    uncertainty = {
        "method": "absolute-residual split conformal; 90% nominal interval",
        "calibration_period": "2024-07 through 2024-09",
        "validation_check_period": "2024-10 through 2024-12",
        "calibration_rows": int(calibration.sum()),
        "validation_check_rows": int(interval_check.sum()),
        "interval_radius_umol_m2": interval_radius,
        "calibration_coverage": float(np.mean(calibration_errors <= interval_radius)),
        "validation_check_coverage": float(np.mean(validation_check_errors <= interval_radius)),
        "test_coverage": float(np.mean(test_errors <= interval_radius)),
        "note": "Empirical coverage only; temporally and spatially dependent cell-months do not guarantee exchangeability.",
    }

    selected_heldout = pd.concat([validation, test], ignore_index=True)
    heldout_predictions = np.concatenate([selected["validation"], selected["test"]])
    save_selected_diagnostics(selected_heldout, heldout_predictions, evaluation_dir, args.random_state)
    test_predictions = pd.DataFrame(
        {
            "month": test["month"].dt.strftime("%Y-%m").to_numpy(),
            "cell_id": test["cell_id"].to_numpy(),
            "latitude": test["latitude"].to_numpy(),
            "longitude": test["longitude"].to_numpy(),
            "actual_no2_umol_m2": test["target_no2_umol_m2"].to_numpy(),
            "climatology_no2_umol_m2": test["baseline_no2_umol_m2"].to_numpy(),
            "predicted_no2_umol_m2": selected["test"],
            "model_residual_anomaly_umol_m2": test["target_no2_umol_m2"].to_numpy() - selected["test"],
            "interval_lower_umol_m2": selected["test"] - interval_radius,
            "interval_upper_umol_m2": selected["test"] + interval_radius,
            "significant_anomaly": test_errors > interval_radius,
            "coverage_fraction": test["coverage_fraction"].to_numpy(),
            "valid_orbit_count": test["valid_orbit_count"].to_numpy(),
            "anomaly_interpretation": interpretation,
        }
    )
    test_predictions.to_csv(evaluation_dir / "predictions.csv.gz", index=False)
    if forward_frame is not None and forward_report is not None:
        _json_write(evaluation_dir / "forward_metrics.json", forward_report)
        forward_predictions_frame = pd.DataFrame(
            {
                "month": forward_frame["month"].dt.strftime("%Y-%m").to_numpy(),
                "cell_id": forward_frame["cell_id"].to_numpy(),
                "actual_no2_umol_m2": forward_frame["target_no2_umol_m2"].to_numpy(),
                "climatology_no2_umol_m2": forward_predictions[BASELINE],
                "matched_no_weather_control_no2_umol_m2": forward_predictions[control],
                "candidate_no2_umol_m2": forward_predictions[best_weather],
                "candidate_model": best_weather,
            }
        )
        forward_predictions_frame.to_csv(
            evaluation_dir / "forward_predictions.csv.gz", index=False
        )
        monthly_rows = []
        for month, group in forward_predictions_frame.groupby("month", observed=True):
            actual = group["actual_no2_umol_m2"].to_numpy()
            for model_name, column in (
                (BASELINE, "climatology_no2_umol_m2"),
                (control, "matched_no_weather_control_no2_umol_m2"),
                (best_weather, "candidate_no2_umol_m2"),
            ):
                monthly_rows.append(
                    {
                        "month": month,
                        "model": model_name,
                        **regression_metrics(actual, group[column].to_numpy()),
                    }
                )
        pd.DataFrame(monthly_rows).to_csv(
            evaluation_dir / "forward_error_by_month.csv", index=False
        )
    if (
        development_climatology_report is not None
        and development_climatology_predictions is not None
    ):
        _json_write(
            evaluation_dir / "development_climatology_windows.json",
            development_climatology_report,
        )
        development_climatology_predictions.to_csv(
            evaluation_dir / "development_climatology_predictions.csv.gz",
            index=False,
        )
        monthly_rows = []
        prediction_columns = [
            column
            for column in development_climatology_predictions
            if column.endswith("_no2_umol_m2")
            and column != "actual_no2_umol_m2"
        ]
        for month, group in development_climatology_predictions.groupby(
            "month", observed=True
        ):
            actual = group["actual_no2_umol_m2"].to_numpy()
            for column in prediction_columns:
                monthly_rows.append(
                    {
                        "month": month,
                        "model": column.removesuffix("_no2_umol_m2"),
                        **regression_metrics(actual, group[column].to_numpy()),
                    }
                )
        pd.DataFrame(monthly_rows).to_csv(
            evaluation_dir / "development_climatology_error_by_month.csv",
            index=False,
        )
    if expanded_training_report is not None and expanded_training_predictions is not None:
        _json_write(
            evaluation_dir / "expanded_training_comparison.json",
            expanded_training_report,
        )
        expanded_training_predictions.to_csv(
            evaluation_dir / "expanded_training_predictions.csv.gz", index=False
        )
        monthly_rows = []
        prediction_columns = [
            column
            for column in expanded_training_predictions
            if column.endswith("_no2_umol_m2")
            and column != "actual_no2_umol_m2"
        ]
        for month, group in expanded_training_predictions.groupby(
            "month", observed=True
        ):
            actual = group["actual_no2_umol_m2"].to_numpy()
            for column in prediction_columns:
                monthly_rows.append(
                    {
                        "month": month,
                        "model": column.removesuffix("_no2_umol_m2"),
                        **regression_metrics(actual, group[column].to_numpy()),
                    }
                )
        pd.DataFrame(monthly_rows).to_csv(
            evaluation_dir / "expanded_training_error_by_month.csv", index=False
        )
    band_metrics = save_band_diagnostic(
        climatology_train["target_no2_umol_m2"].to_numpy(),
        test["target_no2_umol_m2"].to_numpy(),
        selected["test"],
        evaluation_dir,
    )

    print("    Calculating validation-only permutation importance", flush=True)
    if best_weather == "ensemble_spatial_weather":
        importance_model = ResidualEnsemble(
            [fitted[name] for name in ("ridge_spatial_weather", "hgb_spatial_weather", "xgb_spatial_weather")]
        )
        importance_features = CORE_FEATURES + SPATIAL_FEATURES + weather_features
    else:
        importance_model = fitted[best_weather]
        importance_features = list(next(spec for spec in specs if spec["name"] == best_weather)["features"])
    check = validation.loc[validation["month_number"].between(10, 12)]
    sample = check.sample(n=min(args.importance_sample, len(check)), random_state=args.random_state)
    importance = permutation_importance(
        importance_model,
        sample[importance_features],
        sample["target_residual_umol_m2"],
        scoring="neg_mean_absolute_error",
        n_repeats=2,
        random_state=args.random_state,
        n_jobs=1,
    )
    importance_frame = pd.DataFrame(
        {
            "model": best_weather,
            "feature": importance_features,
            "importance_mean": importance.importances_mean,
            "importance_std": importance.importances_std,
        }
    ).sort_values("importance_mean", ascending=False)
    importance_frame.to_csv(evaluation_dir / "feature_importance.csv", index=False)

    candidate_results = {}
    for name in predictions:
        rows = comparison.loc[comparison["model"].eq(name)]
        candidate_results[name] = {
            "selection_validation_mae_umol_m2": selection_mae[name],
            "validation": rows.loc[rows["split"].eq("validation")].iloc[0][
                ["mae_umol_m2", "median_ae_umol_m2", "rmse_umol_m2", "r2", "bias_umol_m2", "mae_change_vs_climatology_percent"]
            ].to_dict(),
            "test": rows.loc[rows["split"].eq("test")].iloc[0][
                ["mae_umol_m2", "median_ae_umol_m2", "rmse_umol_m2", "r2", "bias_umol_m2", "mae_change_vs_climatology_percent"]
            ].to_dict(),
        }
    metrics: dict[str, object] = {
        "selected_model": selected_name,
        "best_trained_candidate": best_trained,
        "best_weather_candidate": best_weather,
        "test": selected_test,
        "spatial_seasonal_climatology_test": baseline_metrics["test"],
        "mae_improvement_over_climatology_percent": selected_improvement,
        "acceptance_gate": gate,
        "anomaly_interpretation": interpretation,
        "concentration_band_diagnostic": band_metrics,
        "candidate_results": candidate_results,
        "baseline_diagnosis": diagnosis,
        "uncertainty": uncertainty,
        "training_seconds": perf_counter() - started,
    }
    if forward_report is not None:
        metrics["forward_holdout"] = forward_report
    if development_climatology_report is not None:
        metrics["development_climatology_windows"] = development_climatology_report
    if expanded_training_report is not None:
        metrics["expanded_training_comparison"] = expanded_training_report
    _json_write(evaluation_dir / "metrics.json", metrics)
    _write_readme(evaluation_dir / "README.md", metrics, comparison, importance_frame, evaluation_dir)
    _json_write(
        evaluation_dir / "run_config.json",
        {
            "tropomi_path": str(Path(args.tropomi_path).resolve()),
            "tropomi_sha256": _sha256_file(Path(args.tropomi_path)),
            "merra_dir": str(Path(args.merra_dir).resolve()),
            "boundary_path": str(Path(args.boundary_path).resolve()),
            "minimum_valid_orbits": args.minimum_valid_orbits,
            "random_state": args.random_state,
            "split": {"train": "2019-2023", "validation": "2024", "test": "2025"},
            "residual_model_train": "2020-2023; training priors use earlier years only",
            "selection_period": "2024-01 through 2024-06",
            "calibration_period": "2024-07 through 2024-09",
            "interval_check_period": "2024-10 through 2024-12",
            "forward_test_year": args.forward_test_year,
            "compare_climatology_windows": args.compare_climatology_windows,
            "compare_expanded_training": args.compare_expanded_training,
            "training_seconds": perf_counter() - started,
        },
    )
    selected_model = fitted.get(selected_name)
    selected_spec = next((spec for spec in specs if spec["name"] == selected_name), None)
    ensemble_components = (
        ("ridge_spatial_weather", "hgb_spatial_weather", "xgb_spatial_weather")
        if selected_name == "ensemble_spatial_weather"
        else None
    )
    component_feature_columns = (
        {
            name: list(next(spec for spec in specs if spec["name"] == name)["features"])
            for name in ensemble_components
        }
        if ensemble_components
        else None
    )
    training_climatology = {
        "cell_month_mean": climatology_train.groupby(["cell_id", "month_number"], observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "cell_mean": climatology_train.groupby("cell_id", observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "seasonal_mean": climatology_train.groupby("month_number", observed=True)["target_no2_umol_m2"].mean().to_dict(),
        "global_mean": float(climatology_train["target_no2_umol_m2"].mean()),
    }
    joblib.dump(
        {
            "checkpoint_schema_version": 2,
            "model_name": selected_name,
            "model": selected_model,
            "acceptance_gate_passed": gate["passed"],
            "feature_columns": list(selected_spec["features"]) if selected_spec else [],
            "ensemble_components": ensemble_components,
            "component_models": {name: fitted[name] for name in ensemble_components} if ensemble_components else None,
            "component_feature_columns": component_feature_columns,
            "best_trained_candidate_name": best_trained,
            "best_trained_candidate_model": fitted.get(best_trained),
            "best_weather_candidate_name": best_weather,
            "climatology": training_climatology,
            "target_units": "µmol m-2",
            "minimum_valid_orbits": args.minimum_valid_orbits,
            "boundary_sha256": hashlib.sha256(Path(args.boundary_path).read_bytes()).hexdigest(),
            "random_state": args.random_state,
            "interval_radius_umol_m2": interval_radius,
            "anomaly_interpretation": interpretation,
            "split": {"train": "2019-2023", "validation": "2024", "test": "2025"},
            "note": "Feature preparation and training-only climatology are specified in modules.atmosphere.tropomi_features.",
        },
        checkpoint_dir / "best_model.joblib",
    )
    metrics["training_seconds"] = perf_counter() - started
    _json_write(evaluation_dir / "metrics.json", metrics)
    print(
        f"Done in {metrics['training_seconds']:.1f}s. Selected={selected_name}; "
        f"2025 MAE={selected_test['mae_umol_m2']:.4f}; R2={selected_test['r2']:.4f}; "
        f"interval check coverage={uncertainty['validation_check_coverage']:.1%}",
        flush=True,
    )
    return metrics


def parse_args() -> argparse.Namespace:
    """Read reproducible experiment paths and fixed resource limits."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tropomi-path",
        default=str(ROOT / "data" / "raw" / "tropomi" / "tropomi_no2_2019-01-01_2025-12-31.csv.gz"),
    )
    parser.add_argument("--merra-dir", default=str(ROOT / "data" / "raw" / "merra"))
    parser.add_argument("--boundary-path", default=str(ROOT / "data" / "raw" / "tropomi" / "philippines_adm0.geojson"))
    parser.add_argument("--evaluation-dir", default=str(ROOT / "models" / "evaluation" / "tropomi"))
    parser.add_argument("--checkpoint-dir", default=str(ROOT / "models" / "checkpoints" / "tropomi"))
    parser.add_argument("--minimum-valid-orbits", type=int, default=5)
    parser.add_argument("--importance-sample", type=int, default=1500)
    parser.add_argument("--random-state", type=int, default=RANDOM_STATE)
    parser.add_argument(
        "--forward-test-year",
        type=int,
        help="Score this year only after model selection; it must be later than 2025",
    )
    parser.add_argument(
        "--compare-climatology-windows",
        action="store_true",
        help="Compare historical climatology windows on the forward year as development data",
    )
    parser.add_argument(
        "--compare-expanded-training",
        action="store_true",
        help="Refit regression candidates through the year before the forward year",
    )
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
