"""Feature preparation for the MERRA-2 next-hour baseline."""

from __future__ import annotations

import numpy as np
import pandas as pd


RAW_FEATURES = [
    "cldtmp",
    "ps",
    "t2m",
    "to3",
    "tqv",
    "ts",
    "u10m",
    "u50m",
    "v10m",
    "v50m",
]


def build_supervised_frame(
    frame: pd.DataFrame, horizon_hours: int = 1
) -> tuple[pd.DataFrame, list[str]]:
    """Create leakage-safe features for future `T2M` prediction."""

    if horizon_hours < 1:
        raise ValueError("horizon_hours must be at least 1")

    missing = sorted(set(RAW_FEATURES + ["time"]) - set(frame.columns))
    if missing:
        raise ValueError(f"Missing required MERRA columns: {missing}")

    prepared = frame.sort_values("time").reset_index(drop=True).copy()
    hour = prepared["time"].dt.hour + prepared["time"].dt.minute / 60.0
    day_of_year = prepared["time"].dt.dayofyear

    prepared["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    prepared["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    prepared["doy_sin"] = np.sin(2 * np.pi * day_of_year / 365.25)
    prepared["doy_cos"] = np.cos(2 * np.pi * day_of_year / 365.25)
    prepared["wind_speed_10m"] = np.hypot(prepared["u10m"], prepared["v10m"])
    prepared["wind_speed_50m"] = np.hypot(prepared["u50m"], prepared["v50m"])
    prepared["skin_air_delta"] = prepared["ts"] - prepared["t2m"]

    lag_hours = [1, 2, 3, 24, 168]
    for lag in lag_hours:
        prepared[f"t2m_lag_{lag}h"] = prepared["t2m"].shift(lag)

    prepared["t2m_change_1h"] = prepared["t2m"].diff()
    prepared["t2m_roll_24h"] = prepared["t2m"].rolling(24).mean()
    prepared["t2m_roll_168h"] = prepared["t2m"].rolling(168).mean()
    prepared["target_time"] = prepared["time"].shift(-horizon_hours)
    prepared["target_t2m"] = prepared["t2m"].shift(-horizon_hours)
    target_gap = prepared["target_time"] - prepared["time"]
    invalid_gap = prepared["target_time"].notna() & target_gap.ne(
        pd.Timedelta(hours=horizon_hours)
    )
    if invalid_gap.any():
        raise ValueError(
            f"Found {int(invalid_gap.sum())} targets that are not exactly "
            f"{horizon_hours} hour(s) after their input"
        )

    feature_columns = RAW_FEATURES + [
        "hour_sin",
        "hour_cos",
        "doy_sin",
        "doy_cos",
        "wind_speed_10m",
        "wind_speed_50m",
        "skin_air_delta",
        *[f"t2m_lag_{lag}h" for lag in lag_hours],
        "t2m_change_1h",
        "t2m_roll_24h",
        "t2m_roll_168h",
    ]

    prepared = prepared.dropna(
        subset=feature_columns + ["target_time", "target_t2m"]
    ).reset_index(drop=True)
    return prepared, feature_columns


def chronological_masks(frame: pd.DataFrame) -> dict[str, pd.Series]:
    """Split by label time so no training target enters a later period."""

    years = frame["target_time"].dt.year
    masks = {
        "train": years <= 2023,
        "validation": years == 2024,
        "test": years >= 2025,
    }
    empty = [name for name, mask in masks.items() if not mask.any()]
    if empty:
        raise ValueError(f"Chronological split has empty partitions: {empty}")
    return masks
