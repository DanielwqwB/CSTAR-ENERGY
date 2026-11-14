"""Predict monthly TROPOMI NO2 from a selected atmospheric checkpoint.

The input needs ``month`` and ``cell_id``. Observed NO2 is optional and is used
only after prediction to calculate an anomaly. A selected weather model also
needs the feature columns recorded in its checkpoint; those features must be
prepared from information available at the prediction time.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

import joblib
import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
BASELINE = "spatial_seasonal_climatology"


def load_tropomi_checkpoint(path: str | Path) -> dict[str, Any]:
    """Load a trusted local checkpoint and check its required metadata."""

    checkpoint = joblib.load(path)
    if not isinstance(checkpoint, dict) or not {
        "model_name", "climatology"
    }.issubset(checkpoint):
        raise ValueError("Not a TROPOMI regression checkpoint")
    return checkpoint


def _climatology_prediction(
    cell_ids: pd.Series, month_numbers: pd.Series, climatology: Mapping[str, Any]
) -> np.ndarray:
    """Apply the saved cell-month, cell, season, then global fallback chain."""

    required = {"cell_month_mean", "cell_mean", "seasonal_mean", "global_mean"}
    if missing := required - set(climatology):
        raise ValueError(f"Checkpoint climatology is missing: {sorted(missing)}")
    global_mean = float(climatology["global_mean"])
    if not np.isfinite(global_mean):
        raise ValueError("Checkpoint global climatology mean is not finite")

    values: list[float] = []
    for cell_id, month_number in zip(cell_ids, month_numbers, strict=True):
        candidates = (
            climatology["cell_month_mean"].get((cell_id, int(month_number))),
            climatology["cell_mean"].get(cell_id),
            climatology["seasonal_mean"].get(int(month_number)),
            global_mean,
        )
        values.append(
            next(float(value) for value in candidates if value is not None and pd.notna(value))
        )
    return np.asarray(values, dtype=np.float64)


def _feature_frame(prepared: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """Select the recorded model features without silently inventing inputs."""

    if not columns:
        raise ValueError("Selected weather model has no recorded feature columns")
    if missing := sorted(set(columns) - set(prepared)):
        raise ValueError(f"Missing weather-model features: {missing}")
    return prepared.loc[:, columns].apply(pd.to_numeric, errors="raise")


def _weather_residual(prepared: pd.DataFrame, checkpoint: Mapping[str, Any]) -> np.ndarray:
    """Run either a single residual model or the selected ensemble."""

    if checkpoint.get("acceptance_gate_passed") is not True:
        raise ValueError("Weather model has no passing acceptance gate")
    selected = str(checkpoint["model_name"])
    if not selected.endswith("_weather"):
        raise ValueError(f"Selected model is not a weather candidate: {selected}")

    if selected == "ensemble_spatial_weather":
        components = checkpoint.get("ensemble_components")
        models = checkpoint.get("component_models")
        feature_sets = checkpoint.get("component_feature_columns")
        if not components or not models or not feature_sets:
            raise ValueError("Weather ensemble checkpoint lacks its component metadata")
        residuals = [
            np.asarray(
                models[name].predict(_feature_frame(prepared, list(feature_sets[name]))),
                dtype=np.float64,
            )
            for name in components
        ]
        return np.mean(residuals, axis=0)

    model = checkpoint.get("model")
    if model is None:
        raise ValueError("Selected weather model is absent from its checkpoint")
    features = _feature_frame(prepared, list(checkpoint.get("feature_columns") or []))
    return np.asarray(model.predict(features), dtype=np.float64)


def predict_tropomi(
    frame: pd.DataFrame, checkpoint: Mapping[str, Any]
) -> pd.DataFrame:
    """Return expected NO2, optional observed residuals, and interval flags.

    ``observed_no2_umol_m2`` or ``tropospheric_no2_mean_mol_m2`` may supply
    observations. Missing observations remain missing; they never become model
    features or zero-valued anomalies. The weather-adjusted label is allowed
    only for a selected weather candidate with a passing saved gate.
    """

    if frame.empty:
        raise ValueError("No TROPOMI rows supplied for prediction")
    if missing := {"month", "cell_id"} - set(frame):
        raise ValueError(f"Missing TROPOMI identity columns: {sorted(missing)}")
    if frame["month"].isna().any() or frame["cell_id"].isna().any():
        raise ValueError("TROPOMI month and cell_id must be present on every row")

    months = pd.to_datetime(frame["month"], errors="raise", utc=True)
    cell_ids = frame["cell_id"].astype(str)
    if cell_ids.str.len().eq(0).any():
        raise ValueError("TROPOMI cell_id cannot be empty")
    month_labels = months.dt.strftime("%Y-%m")
    if pd.MultiIndex.from_arrays([month_labels, cell_ids]).duplicated().any():
        raise ValueError("Duplicate TROPOMI month and cell_id rows")

    baseline = _climatology_prediction(
        cell_ids, months.dt.month, checkpoint["climatology"]
    )
    selected = str(checkpoint.get("model_name", ""))
    prepared = frame.copy()
    prepared["training_baseline_no2_umol_m2"] = baseline
    if selected == BASELINE:
        if checkpoint.get("model") is not None:
            raise ValueError("Climatology checkpoint unexpectedly contains a selected model")
        predicted = baseline
        interpretation = "climatology residual"
    else:
        predicted = baseline + _weather_residual(prepared, checkpoint)
        interpretation = "weather-adjusted residual"
    if not np.isfinite(predicted).all():
        raise ValueError("Selected TROPOMI model produced non-finite predictions")

    observation_columns = {
        "observed_no2_umol_m2", "tropospheric_no2_mean_mol_m2"
    } & set(frame)
    if len(observation_columns) > 1:
        raise ValueError("Provide observed NO2 in only one unit column")
    if "observed_no2_umol_m2" in observation_columns:
        observed = pd.to_numeric(frame["observed_no2_umol_m2"], errors="raise").to_numpy(
            dtype=np.float64
        )
    elif "tropospheric_no2_mean_mol_m2" in observation_columns:
        observed = (
            pd.to_numeric(frame["tropospheric_no2_mean_mol_m2"], errors="raise")
            .to_numpy(dtype=np.float64)
            * 1_000_000
        )
    else:
        observed = np.full(len(frame), np.nan)
    anomaly = observed - predicted

    radius = checkpoint.get("interval_radius_umol_m2")
    if radius is None:
        lower = upper = np.full(len(frame), np.nan)
        significant = pd.array([pd.NA] * len(frame), dtype="boolean")
    else:
        radius = float(radius)
        if not np.isfinite(radius) or radius < 0:
            raise ValueError("Checkpoint interval radius must be finite and nonnegative")
        lower, upper = predicted - radius, predicted + radius
        significant = pd.array(
            [bool(abs(value) > radius) if np.isfinite(value) else pd.NA for value in anomaly],
            dtype="boolean",
        )

    return pd.DataFrame(
        {
            "month": month_labels.to_numpy(),
            "cell_id": cell_ids.to_numpy(),
            "model_name": selected,
            "expected_no2_umol_m2": predicted,
            "observed_no2_umol_m2": observed,
            "anomaly_umol_m2": anomaly,
            "interval_lower_umol_m2": lower,
            "interval_upper_umol_m2": upper,
            "significant_anomaly": significant,
            "anomaly_interpretation": interpretation,
        }
    )


def main() -> None:
    """Predict from an already harmonized CSV using the selected checkpoint."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=ROOT / "models" / "checkpoints" / "tropomi" / "best_model.joblib",
    )
    args = parser.parse_args()
    checkpoint = load_tropomi_checkpoint(args.checkpoint)
    predictions = predict_tropomi(pd.read_csv(args.input), checkpoint)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(args.output, index=False)
    print(
        json.dumps(
            {
                "rows": len(predictions),
                "model_name": checkpoint["model_name"],
                "anomaly_interpretation": predictions["anomaly_interpretation"].iloc[0],
                "output": str(args.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
