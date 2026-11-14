"""Leakage-safe monthly features for the TROPOMI-MERRA baseline."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from rasterio.features import geometry_mask
from rasterio.transform import from_origin

from pipeline.harmonization.merra_features import RAW_FEATURES


TROPOMI_DTYPES = {
    "cell_id": "category",
    "longitude": "float32",
    "latitude": "float32",
    "tropospheric_no2_mean_mol_m2": "float32",
    "tropospheric_no2_std_mol_m2": "float32",
    "qa_mean": "float32",
    "valid_pixel_count": "int32",
    "valid_orbit_count": "int16",
    "source_product": "category",
}


def load_tropomi_table(path: str | Path) -> pd.DataFrame:
    """Load the compact monthly TROPOMI table with memory-safe dtypes."""

    frame = pd.read_csv(path, dtype=TROPOMI_DTYPES)
    required = {
        "month",
        "cell_id",
        "longitude",
        "latitude",
        "tropospheric_no2_mean_mol_m2",
        "tropospheric_no2_std_mol_m2",
        "qa_mean",
        "valid_pixel_count",
        "valid_orbit_count",
    }
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Missing TROPOMI columns: {missing}")
    frame["month"] = pd.to_datetime(frame["month"] + "-01", utc=True)
    if frame[["month", "cell_id"]].duplicated().any():
        raise ValueError("TROPOMI table contains duplicate month/cell rows")
    return frame


def load_boundary_geometries(path: str | Path) -> list[dict]:
    """Read GeoJSON geometry objects for rasterized cell-center masking."""

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("type") == "FeatureCollection":
        geometries = [
            feature["geometry"]
            for feature in payload.get("features", [])
            if feature.get("geometry")
        ]
    elif payload.get("type") == "Feature":
        geometries = [payload["geometry"]]
    else:
        geometries = [payload]
    if not geometries:
        raise ValueError(f"No geometries found in {path}")
    return geometries


def apply_boundary_mask(
    frame: pd.DataFrame,
    boundary_path: str | Path,
    grid_degrees: float = 0.1,
) -> pd.DataFrame:
    """Keep cells whose centers fall inside the supplied administrative boundary."""

    if frame.empty:
        return frame.copy()
    geometries = load_boundary_geometries(boundary_path)
    half = grid_degrees / 2
    west = float(frame["longitude"].min()) - half
    east = float(frame["longitude"].max()) + half
    south = float(frame["latitude"].min()) - half
    north = float(frame["latitude"].max()) + half
    nx = int(round((east - west) / grid_degrees))
    ny = int(round((north - south) / grid_degrees))
    transform = from_origin(west, north, grid_degrees, grid_degrees)
    inside_grid = geometry_mask(
        geometries,
        out_shape=(ny, nx),
        transform=transform,
        invert=True,
        all_touched=False,
    )

    ix = np.rint((frame["longitude"].to_numpy() - (west + half)) / grid_degrees).astype(
        np.int32
    )
    iy = np.rint(((north - half) - frame["latitude"].to_numpy()) / grid_degrees).astype(
        np.int32
    )
    valid_index = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    keep = np.zeros(len(frame), dtype=bool)
    keep[valid_index] = inside_grid[iy[valid_index], ix[valid_index]]
    return frame.loc[keep].reset_index(drop=True)


def aggregate_merra_monthly(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Aggregate the current hourly national MERRA fields to monthly covariates."""

    missing = sorted(set(RAW_FEATURES + ["time"]) - set(frame.columns))
    if missing:
        raise ValueError(f"Missing required MERRA columns: {missing}")
    prepared = frame.sort_values("time").copy()
    prepared["month"] = pd.to_datetime(
        prepared["time"].dt.strftime("%Y-%m-01"), utc=True
    )
    prepared["wind_speed_10m"] = np.hypot(prepared["u10m"], prepared["v10m"])
    prepared["wind_speed_50m"] = np.hypot(prepared["u50m"], prepared["v50m"])
    prepared["skin_air_delta"] = prepared["ts"] - prepared["t2m"]

    aggregate_columns = RAW_FEATURES + [
        "wind_speed_10m",
        "wind_speed_50m",
        "skin_air_delta",
    ]
    monthly = prepared.groupby("month", observed=True)[aggregate_columns].agg(
        ["mean", "std"]
    )
    monthly.columns = [f"merra_{name}_{stat}" for name, stat in monthly.columns]
    monthly = monthly.reset_index()

    direction_10m = np.arctan2(
        -monthly["merra_u10m_mean"], -monthly["merra_v10m_mean"]
    )
    direction_50m = np.arctan2(
        -monthly["merra_u50m_mean"], -monthly["merra_v50m_mean"]
    )
    monthly["merra_wind_direction_10m_sin"] = np.sin(direction_10m)
    monthly["merra_wind_direction_10m_cos"] = np.cos(direction_10m)
    monthly["merra_wind_direction_50m_sin"] = np.sin(direction_50m)
    monthly["merra_wind_direction_50m_cos"] = np.cos(direction_50m)
    feature_columns = [column for column in monthly.columns if column != "month"]
    monthly[feature_columns] = monthly[feature_columns].astype("float32")
    return monthly, feature_columns


def chronological_masks(frame: pd.DataFrame) -> dict[str, pd.Series]:
    """Fixed train/validation/test partitions for TROPOMI evaluation."""

    years = frame["month"].dt.year
    masks = {
        "train": years <= 2023,
        "validation": years == 2024,
        "test": years == 2025,
    }
    empty = [name for name, mask in masks.items() if not mask.any()]
    if empty:
        raise ValueError(f"Chronological split has empty partitions: {empty}")
    return masks


def _map_with_fallbacks(
    frame: pd.DataFrame,
    cell_month_mean: pd.Series,
    cell_mean: pd.Series,
    seasonal_mean: pd.Series,
    global_mean: float,
) -> pd.Series:
    index = pd.MultiIndex.from_arrays(
        [frame["cell_id"].astype(str), frame["month_number"]]
    )
    values = pd.Series(cell_month_mean.reindex(index).to_numpy(), index=frame.index)
    values = values.fillna(frame["cell_id"].astype(str).map(cell_mean))
    values = values.fillna(frame["month_number"].map(seasonal_mean))
    return values.fillna(global_mean).astype("float32")


def add_training_climatology(
    frame: pd.DataFrame, masks: dict[str, pd.Series]
) -> tuple[pd.DataFrame, dict[str, object]]:
    """Add leakage-safe cell-season climatology and a residual target.

    Training rows use leave-one-observation-out cell-month climatology. Validation
    and test rows use the full 2019-2023 training climatology.
    """

    prepared = frame.copy()
    train = prepared.loc[masks["train"]]
    grouped = train.groupby([train["cell_id"].astype(str), "month_number"], observed=True)[
        "target_no2_umol_m2"
    ].agg(["sum", "count", "mean"])
    cell_month_mean = grouped["mean"]
    cell_mean = train.groupby(train["cell_id"].astype(str), observed=True)[
        "target_no2_umol_m2"
    ].mean()
    seasonal_mean = train.groupby("month_number", observed=True)[
        "target_no2_umol_m2"
    ].mean()
    global_mean = float(train["target_no2_umol_m2"].mean())

    full_baseline = _map_with_fallbacks(
        prepared, cell_month_mean, cell_mean, seasonal_mean, global_mean
    )
    prepared["baseline_no2_umol_m2"] = full_baseline

    train_keys = pd.MultiIndex.from_arrays(
        [
            train["cell_id"].astype(str),
            train["month_number"],
        ]
    )
    sums = grouped["sum"].reindex(train_keys).to_numpy(dtype=np.float64)
    counts = grouped["count"].reindex(train_keys).to_numpy(dtype=np.float64)
    target = train["target_no2_umol_m2"].to_numpy(dtype=np.float64)
    leave_one_out = np.divide(
        sums - target,
        counts - 1,
        out=np.full_like(target, np.nan),
        where=counts > 1,
    )
    train_baseline = pd.Series(leave_one_out, index=train.index).fillna(
        full_baseline.loc[train.index]
    )
    prepared.loc[train.index, "baseline_no2_umol_m2"] = train_baseline.astype(
        "float32"
    )
    prepared["target_residual_umol_m2"] = (
        prepared["target_no2_umol_m2"] - prepared["baseline_no2_umol_m2"]
    ).astype("float32")

    climatology = {
        "cell_month_mean": cell_month_mean.to_dict(),
        "cell_mean": cell_mean.to_dict(),
        "seasonal_mean": seasonal_mean.to_dict(),
        "global_mean": global_mean,
    }
    return prepared, climatology


def build_tropomi_merra_frame(
    tropomi: pd.DataFrame,
    merra_monthly: pd.DataFrame,
    boundary_path: str | Path,
    min_valid_orbits: int = 5,
) -> tuple[pd.DataFrame, list[str], dict[str, pd.Series], dict[str, object]]:
    """Return the final model frame, features, splits, and climatology artifacts."""

    if min_valid_orbits < 1:
        raise ValueError("min_valid_orbits must be positive")
    bounded = apply_boundary_mask(tropomi, boundary_path=boundary_path)
    bounded = bounded.loc[bounded["valid_orbit_count"] >= min_valid_orbits].copy()
    bounded["target_no2_umol_m2"] = (
        bounded["tropospheric_no2_mean_mol_m2"] * 1_000_000
    ).astype("float32")
    bounded["month_number"] = bounded["month"].dt.month.astype("int8")
    bounded["month_sin"] = np.sin(2 * np.pi * bounded["month_number"] / 12).astype(
        "float32"
    )
    bounded["month_cos"] = np.cos(2 * np.pi * bounded["month_number"] / 12).astype(
        "float32"
    )
    bounded["latitude_sq"] = (bounded["latitude"] ** 2).astype("float32")
    bounded["longitude_sq"] = (bounded["longitude"] ** 2).astype("float32")
    bounded["latitude_longitude"] = (
        bounded["latitude"] * bounded["longitude"]
    ).astype("float32")
    days_in_month = bounded["month"].dt.days_in_month.to_numpy(dtype=np.float32)
    bounded["coverage_fraction"] = np.clip(
        bounded["valid_orbit_count"].to_numpy(dtype=np.float32) / days_in_month,
        0,
        1,
    )
    bounded["sample_weight"] = np.clip(
        bounded["coverage_fraction"], 0.25, 1.0
    ).astype("float32")

    merged = bounded.merge(merra_monthly, on="month", how="left", validate="many_to_one")
    merra_features = [column for column in merra_monthly.columns if column != "month"]
    if merged[merra_features].isna().any().any():
        missing_months = merged.loc[
            merged[merra_features].isna().any(axis=1), "month"
        ].dt.strftime("%Y-%m").unique()
        raise ValueError(f"MERRA features missing for months: {missing_months.tolist()}")

    feature_columns = [
        "latitude",
        "longitude",
        "latitude_sq",
        "longitude_sq",
        "latitude_longitude",
        "month_sin",
        "month_cos",
        "coverage_fraction",
        "qa_mean",
        *merra_features,
    ]
    merged[feature_columns] = merged[feature_columns].astype("float32")
    masks = chronological_masks(merged)
    merged, climatology = add_training_climatology(merged, masks)
    return merged.reset_index(drop=True), feature_columns, chronological_masks(merged), climatology
