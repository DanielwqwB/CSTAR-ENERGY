"""Monthly TROPOMI band features with strictly earlier NO2 observations."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from modules.atmosphere.tropomi_features import add_climatology, add_neighbor_prior
from pipeline.harmonization.tropomi_features import apply_boundary_mask, load_tropomi_table


HISTORY_FEATURES = (
    "no2_lag1m",
    "no2_lag3m",
    "no2_lag12m",
    "no2_lag24m",
    "no2_lag36m",
    "no2_prior3m_mean",
    "no2_prior3m_count",
    "no2_prior_annual_mean",
    "no2_prior_annual_count",
    "no2_annual_change",
)


def history_features(panel: pd.DataFrame, source_through_year: int) -> pd.DataFrame:
    """Build calendar-month lags from NO2 available by the cutoff year.

    The panel must contain one row for every month of each cell so ``shift(12)``
    always means the same calendar month of the previous year. Missing NO2 stays
    missing; no observation is synthesized or forward-filled.
    """

    ordered = panel.sort_values(["cell_id", "month"]).copy()
    allowed = ordered["month"].dt.year.le(source_through_year)
    source = ordered["target_no2_umol_m2"].where(allowed)
    grouped = source.groupby(ordered["cell_id"], sort=False)
    for lag in (1, 3, 12, 24, 36):
        ordered[f"no2_lag{lag}m"] = grouped.shift(lag).astype("float32")

    prior_three = source.groupby(ordered["cell_id"], sort=False).transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).mean()
    )
    prior_three_count = source.groupby(ordered["cell_id"], sort=False).transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).count()
    )
    annual = ordered[["no2_lag12m", "no2_lag24m", "no2_lag36m"]]
    ordered["no2_prior3m_mean"] = prior_three.astype("float32")
    ordered["no2_prior3m_count"] = prior_three_count.astype("float32")
    ordered["no2_prior_annual_mean"] = annual.mean(axis=1).astype("float32")
    ordered["no2_prior_annual_count"] = annual.notna().sum(axis=1).astype("float32")
    ordered["no2_annual_change"] = (
        ordered["no2_lag12m"] - ordered["no2_lag24m"]
    ).astype("float32")
    return ordered[["month", "cell_id", *HISTORY_FEATURES]]


def load_tropomi_band_frame(
    tropomi_path: str | Path,
    boundary_path: str | Path,
    minimum_valid_orbits: int = 5,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    """Return Philippines cell-month labels, safe priors, and explicit counts."""

    if minimum_valid_orbits < 1:
        raise ValueError("minimum_valid_orbits must be positive")
    raw = load_tropomi_table(tropomi_path)
    bounded = apply_boundary_mask(raw, boundary_path)
    bounded["cell_id"] = bounded["cell_id"].astype(str)
    valid = bounded["tropospheric_no2_mean_mol_m2"].notna() & bounded[
        "valid_orbit_count"
    ].ge(minimum_valid_orbits)
    observed = bounded.loc[valid].copy().reset_index(drop=True)
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

    months = pd.date_range("2019-01-01", "2025-12-01", freq="MS", tz="UTC")
    cells = sorted(bounded["cell_id"].unique())
    panel = pd.MultiIndex.from_product(
        [cells, months], names=["cell_id", "month"]
    ).to_frame(index=False)
    panel = panel.merge(
        observed[["cell_id", "month", "target_no2_umol_m2"]],
        on=["cell_id", "month"], how="left", validate="one_to_one",
    )
    counts = panel[["cell_id", "month"]].merge(
        bounded[["cell_id", "month", "valid_orbit_count", "valid_pixel_count"]],
        on=["cell_id", "month"], how="left", validate="one_to_one",
    )
    counts["valid_orbit_count"] = counts["valid_orbit_count"].fillna(0).astype("int16")
    counts["valid_pixel_count"] = counts["valid_pixel_count"].fillna(0).astype("int32")
    counts["used_for_model"] = panel["target_no2_umol_m2"].notna().to_numpy()

    history_train = history_features(panel, source_through_year=2023)
    history_test = history_features(panel, source_through_year=2024)
    joined = observed.merge(history_train, on=["cell_id", "month"], how="left", validate="one_to_one")
    test_rows = joined["year"].eq(2025)
    test_keys = pd.MultiIndex.from_frame(joined.loc[test_rows, ["cell_id", "month"]])
    test_history = history_test.set_index(["cell_id", "month"]).reindex(test_keys)
    joined.loc[test_rows, list(HISTORY_FEATURES)] = test_history[list(HISTORY_FEATURES)].to_numpy()
    joined = add_climatology(joined)
    joined = add_neighbor_prior(joined)
    quality = {
        "raw_rows": int(len(raw)),
        "boundary_rows": int(len(bounded)),
        "observed_model_rows": int(len(joined)),
        "cell_count": int(joined["cell_id"].nunique()),
        "explicit_zero_count_cell_months": int(counts["valid_orbit_count"].eq(0).sum()),
        "excluded_low_coverage_rows": int((~valid & bounded["tropospheric_no2_mean_mol_m2"].notna()).sum()),
        "minimum_valid_orbits": minimum_valid_orbits,
        "validation_history_through_year": 2023,
        "test_history_through_year": 2024,
        "test_labels_used_as_features": False,
        "missing_feature_values": {
            field: int(value)
            for field, value in joined[list(HISTORY_FEATURES)].isna().sum().items()
        },
    }
    return joined, counts, quality
