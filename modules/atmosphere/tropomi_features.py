"""Leakage-aware monthly TROPOMI and MERRA-2 experiment features.

Weather is aggregated over the target calendar month because the available
TROPOMI table does not retain individual valid orbit dates per cell.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.harmonization.tropomi_features import (
    apply_boundary_mask,
    load_tropomi_table,
)
from pipeline.ingestion.merra import load_merra_directory


RAW_WEATHER = ("cldtmp", "ps", "t2m", "to3", "tqv", "ts", "u10m", "v10m", "u50m", "v50m")
RANDOM_STATE = 42


def monthly_weather(merra: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Aggregate national hourly MERRA fields without averaging vectors first.

    The 05:30 UTC summaries use all available days of a month; they cannot be
    restricted to a cell's valid TROPOMI orbit days with the current extract.
    """

    required = set(RAW_WEATHER) | {"time"}
    if missing := required - set(merra):
        raise ValueError(f"Missing MERRA columns: {sorted(missing)}")
    weather = merra.loc[:, ["time", *RAW_WEATHER]].copy()
    weather["month"] = pd.to_datetime(weather["time"].dt.strftime("%Y-%m-01"), utc=True)
    weather["wind_speed_10m"] = np.hypot(weather["u10m"], weather["v10m"])
    weather["wind_speed_50m"] = np.hypot(weather["u50m"], weather["v50m"])
    direction = np.arctan2(-weather["u10m"], -weather["v10m"])
    weather["wind_direction_sin"] = np.sin(direction)
    weather["wind_direction_cos"] = np.cos(direction)
    weather["calm_wind"] = (weather["wind_speed_10m"] < 2).where(
        weather["wind_speed_10m"].notna()
    ).astype("float32")

    hourly_fields = [
        *RAW_WEATHER,
        "wind_speed_10m",
        "wind_speed_50m",
        "wind_direction_sin",
        "wind_direction_cos",
        "calm_wind",
    ]
    grouped = weather.groupby("month", observed=True)[hourly_fields].agg(["mean", "std"])
    grouped.columns = [f"merra_{field}_{stat}" for field, stat in grouped.columns]
    grouped = grouped.reset_index()

    at_0530 = weather.loc[
        weather["time"].dt.hour.eq(5) & weather["time"].dt.minute.eq(30)
    ]
    overpass_fields = [
        "t2m",
        "wind_speed_10m",
        "wind_direction_sin",
        "wind_direction_cos",
        "calm_wind",
    ]
    overpass = at_0530.groupby("month", observed=True)[overpass_fields].mean()
    overpass.columns = [f"merra_0530_{field}_mean" for field in overpass]
    grouped = grouped.merge(overpass.reset_index(), on="month", how="left", validate="one_to_one")
    grouped = grouped.sort_values("month").reset_index(drop=True)
    for field in ("merra_t2m_mean", "merra_wind_speed_10m_mean", "merra_calm_wind_mean"):
        for lag in (1, 3):
            grouped[f"{field}_lag{lag}m"] = grouped[field].shift(lag)
    features = [column for column in grouped if column != "month"]
    grouped[features] = grouped[features].astype("float32")
    return grouped, features


def climatology_prediction(frame: pd.DataFrame, history: pd.DataFrame) -> pd.Series:
    """Predict cell-month means with cell, seasonal, and global fallbacks."""

    if history.empty:
        raise ValueError("Climatology history must contain observations")
    by_cell_month = history.groupby(["cell_id", "month_number"], observed=True)["target_no2_umol_m2"].mean()
    by_cell = history.groupby("cell_id", observed=True)["target_no2_umol_m2"].mean()
    by_month = history.groupby("month_number", observed=True)["target_no2_umol_m2"].mean()
    key = pd.MultiIndex.from_arrays([frame["cell_id"], frame["month_number"]])
    values = pd.Series(by_cell_month.reindex(key).to_numpy(), index=frame.index)
    values = values.fillna(frame["cell_id"].map(by_cell))
    values = values.fillna(frame["month_number"].map(by_month))
    return values.fillna(float(history["target_no2_umol_m2"].mean())).astype("float32")


def add_climatology(frame: pd.DataFrame) -> pd.DataFrame:
    """Attach full train climatology and past-year-only training features.

    There is no earlier TROPOMI year for 2019 examples. They establish the
    first prior but are omitted from residual-model fitting. Every 2020-2023
    residual-model row uses NO2 values from strictly earlier years.
    """

    prepared = frame.copy()
    train_mask = prepared["year"].between(2019, 2023)
    train = prepared.loc[train_mask]
    prepared["baseline_no2_umol_m2"] = climatology_prediction(prepared, train)
    prepared["training_baseline_no2_umol_m2"] = prepared["baseline_no2_umol_m2"]
    for year in range(2019, 2024):
        current = prepared["year"].eq(year)
        prior = train.loc[train["year"].lt(year)]
        if prior.empty:
            prepared.loc[current, "training_baseline_no2_umol_m2"] = np.nan
        else:
            prepared.loc[current, "training_baseline_no2_umol_m2"] = climatology_prediction(
                prepared.loc[current], prior
            ).to_numpy()
    prepared["training_baseline_no2_umol_m2"] = prepared[
        "training_baseline_no2_umol_m2"
    ].astype("float32")
    prepared["target_residual_umol_m2"] = (
        prepared["target_no2_umol_m2"] - prepared["training_baseline_no2_umol_m2"]
    ).astype("float32")
    return prepared


def add_neighbor_prior(frame: pd.DataFrame) -> pd.DataFrame:
    """Add adjacent-cell training means using prior years for train rows.

    The prior is static for validation and test and contains no NO2 from either
    period. For residual-model training rows, only earlier years contribute;
    no same-year or later NO2 enters the neighbor feature.
    """

    prepared = frame.copy()
    train = prepared.loc[prepared["year"].between(2019, 2023)]
    locations = prepared[["cell_id", "latitude", "longitude"]].drop_duplicates("cell_id")
    lookup = {
        (round(float(row.latitude) * 10), round(float(row.longitude) * 10)): row.cell_id
        for row in locations.itertuples(index=False)
    }
    totals = train.groupby("cell_id", observed=True)["target_no2_umol_m2"].agg(["sum", "count"])
    by_year = train.groupby(["cell_id", "year"], observed=True)["target_no2_umol_m2"].agg(["sum", "count"])
    full_map: dict[str, float] = {}
    crossfit_map: dict[tuple[str, int], float] = {}
    years = range(2019, 2024)
    for row in locations.itertuples(index=False):
        lat, lon = round(float(row.latitude) * 10), round(float(row.longitude) * 10)
        neighbors = [
            lookup.get((lat + dy, lon + dx))
            for dy in (-1, 0, 1)
            for dx in (-1, 0, 1)
            if dx or dy
        ]
        neighbors = [cell for cell in neighbors if cell in totals.index]
        total_sum = sum(float(totals.loc[cell, "sum"]) for cell in neighbors)
        total_count = sum(int(totals.loc[cell, "count"]) for cell in neighbors)
        full_map[row.cell_id] = total_sum / total_count if total_count else np.nan
        for year in years:
            prior_keys = [
                (cell, prior_year)
                for cell in neighbors
                for prior_year in years
                if prior_year < year and (cell, prior_year) in by_year.index
            ]
            prior_sum = sum(float(by_year.loc[key, "sum"]) for key in prior_keys)
            prior_count = sum(int(by_year.loc[key, "count"]) for key in prior_keys)
            crossfit_map[(row.cell_id, year)] = prior_sum / prior_count if prior_count else np.nan

    prepared["neighbor_prior_no2_umol_m2"] = prepared["cell_id"].map(full_map).astype("float32")
    train_mask = prepared["year"].between(2019, 2023)
    train_keys = list(zip(prepared.loc[train_mask, "cell_id"], prepared.loc[train_mask, "year"]))
    prepared.loc[train_mask, "neighbor_prior_no2_umol_m2"] = np.asarray(
        [crossfit_map.get(key, np.nan) for key in train_keys], dtype="float32"
    )
    return prepared


def load_experiment_data(
    tropomi_path: str | Path,
    merra_dir: str | Path,
    boundary_path: str | Path,
    minimum_valid_orbits: int = 5,
) -> tuple[pd.DataFrame, pd.DataFrame, list[str], dict[str, object]]:
    """Return observed model rows, explicit observation counts, and metadata."""

    tropomi = load_tropomi_table(tropomi_path)
    inside = apply_boundary_mask(tropomi, boundary_path)
    if inside.empty:
        raise ValueError("No TROPOMI rows fall inside the Philippines boundary")
    inside["cell_id"] = inside["cell_id"].astype(str)
    months = pd.date_range(
        inside["month"].min(), inside["month"].max(), freq="MS", tz="UTC"
    )
    cell_ids = sorted(inside["cell_id"].unique())
    panel = pd.MultiIndex.from_product([months, cell_ids], names=["month", "cell_id"]).to_frame(index=False)
    counts = panel.merge(
        inside[["month", "cell_id", "valid_orbit_count", "valid_pixel_count", "tropospheric_no2_mean_mol_m2"]],
        on=["month", "cell_id"],
        how="left",
        validate="one_to_one",
    )
    counts["observed"] = counts["tropospheric_no2_mean_mol_m2"].notna()
    counts["valid_orbit_count"] = counts["valid_orbit_count"].fillna(0).astype("int16")
    counts["valid_pixel_count"] = counts["valid_pixel_count"].fillna(0).astype("int32")
    counts["used_for_model"] = counts["observed"] & counts["valid_orbit_count"].ge(minimum_valid_orbits)
    counts = counts.drop(columns="tropospheric_no2_mean_mol_m2")

    observed = inside.loc[
        inside["tropospheric_no2_mean_mol_m2"].notna()
        & inside["valid_orbit_count"].ge(minimum_valid_orbits)
    ].copy().reset_index(drop=True)
    observed["target_no2_umol_m2"] = (
        observed["tropospheric_no2_mean_mol_m2"] * 1_000_000
    ).astype("float32")
    observed["year"] = observed["month"].dt.year.astype("int16")
    observed["month_number"] = observed["month"].dt.month.astype("int8")
    observed["month_sin"] = np.sin(2 * np.pi * observed["month_number"] / 12).astype("float32")
    observed["month_cos"] = np.cos(2 * np.pi * observed["month_number"] / 12).astype("float32")
    observed["year_index"] = (observed["year"] - 2019).astype("float32")
    observed["latitude_sq"] = observed["latitude"].pow(2).astype("float32")
    observed["longitude_sq"] = observed["longitude"].pow(2).astype("float32")
    observed["latitude_longitude"] = (
        observed["latitude"] * observed["longitude"]
    ).astype("float32")
    observed["coverage_fraction"] = (
        observed["valid_orbit_count"] / observed["month"].dt.days_in_month
    ).clip(0, 1).astype("float32")
    observed["sample_weight"] = observed["coverage_fraction"].clip(0.25, 1).astype("float32")

    merra, metadata = load_merra_directory(merra_dir)
    weather_monthly, weather_features = monthly_weather(merra)
    frame = observed.merge(weather_monthly, on="month", how="left", validate="many_to_one")
    missing_weather_months = frame.loc[
        frame[weather_features].isna().all(axis=1), "month"
    ].dt.strftime("%Y-%m").unique()
    if len(missing_weather_months):
        raise ValueError(f"Missing MERRA months: {missing_weather_months.tolist()}")
    frame = add_climatology(frame)
    frame = add_neighbor_prior(frame)
    metadata_out = {
        "raw_tropomi_rows": len(tropomi),
        "boundary_rows": len(inside),
        "model_rows": len(frame),
        "model_cells": frame["cell_id"].nunique(),
        "explicit_zero_observation_cell_months": int(counts["valid_orbit_count"].eq(0).sum()),
        "dropped_missing_no2_rows": int(inside["tropospheric_no2_mean_mol_m2"].isna().sum()),
        "dropped_low_coverage_rows": int(
            (inside["tropospheric_no2_mean_mol_m2"].notna() & inside["valid_orbit_count"].lt(minimum_valid_orbits)).sum()
        ),
        "merra_variables": [entry.variable for entry in metadata],
        "merra_spatial_scope": "Giovanni area average over 116-127E, 4-22N",
        "tropomi_temporal_resolution": "monthly cell mean; exact valid observation dates unavailable",
        "minimum_valid_orbits": minimum_valid_orbits,
        "residual_model_train_years": "2020-2023; 2019 supplies the first NO2 prior",
    }
    return frame, counts, weather_features, metadata_out
