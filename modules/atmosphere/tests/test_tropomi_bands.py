"""Check the TROPOMI band temporal boundary and validation selection."""

import numpy as np
import pandas as pd

from modules.atmosphere.train_tropomi_bands import (
    BASELINE,
    band_codes,
    choose_by_validation,
)
from modules.atmosphere.tropomi_band_features import history_features


def test_history_uses_only_observations_available_before_each_held_out_year():
    """A 2024 label can inform 2025, but neither period sees its own labels."""

    months = pd.date_range("2022-01-01", "2025-12-01", freq="MS", tz="UTC")
    panel = pd.DataFrame({
        "cell_id": "a",
        "month": months,
        "target_no2_umol_m2": np.arange(len(months), dtype=float),
    })
    panel.loc[panel["month"].eq(pd.Timestamp("2023-01-01", tz="UTC")), "target_no2_umol_m2"] = 13
    panel.loc[panel["month"].eq(pd.Timestamp("2024-01-01", tz="UTC")), "target_no2_umol_m2"] = 99
    panel.loc[panel["month"].eq(pd.Timestamp("2025-01-01", tz="UTC")), "target_no2_umol_m2"] = 999

    validation = history_features(panel, source_through_year=2023).set_index("month")
    test = history_features(panel, source_through_year=2024).set_index("month")
    assert validation.loc[pd.Timestamp("2024-01-01", tz="UTC"), "no2_lag12m"] == 13
    assert np.isnan(validation.loc[pd.Timestamp("2024-02-01", tz="UTC"), "no2_lag1m"])
    assert test.loc[pd.Timestamp("2025-01-01", tz="UTC"), "no2_lag12m"] == 99
    assert np.isnan(test.loc[pd.Timestamp("2025-02-01", tz="UTC"), "no2_lag1m"])
    assert np.isnan(test.loc[pd.Timestamp("2025-12-01", tz="UTC"), "no2_prior3m_mean"])


def test_validation_selection_ignores_test_and_respects_balanced_accuracy():
    """Select the strongest eligible 2024 candidate, regardless of 2025 score."""

    comparison = pd.DataFrame([
        {"model": BASELINE, "split": "validation_2024", "accuracy": 0.68, "balanced_accuracy": 0.67},
        {"model": "a", "split": "validation_2024", "accuracy": 0.75, "balanced_accuracy": 0.50},
        {"model": "b", "split": "validation_2024", "accuracy": 0.72, "balanced_accuracy": 0.70},
        {"model": BASELINE, "split": "test_2025", "accuracy": 0.95, "balanced_accuracy": 0.95},
        {"model": "a", "split": "test_2025", "accuracy": 0.99, "balanced_accuracy": 0.99},
        {"model": "b", "split": "test_2025", "accuracy": 0.30, "balanced_accuracy": 0.30},
    ])
    assert choose_by_validation(comparison) == ("a", "b")


def test_band_cutoffs_remain_fixed_at_both_edges():
    """Concentration cutoffs use a stable three-band mapping."""

    assert band_codes(np.array([1, 8, 8.1, 12, 12.1]), (8, 12)).tolist() == [0, 0, 1, 1, 2]
