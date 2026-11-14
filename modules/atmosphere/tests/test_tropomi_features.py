"""Focused leakage and weather-aggregation checks for the TROPOMI experiment."""

import numpy as np
import pandas as pd

from modules.atmosphere.tropomi_features import (
    RAW_WEATHER,
    add_climatology,
    add_neighbor_prior,
    climatology_prediction,
    monthly_weather,
)


def test_training_climatology_uses_only_earlier_years():
    """The 2019 prior must not incorporate its 2020-2023 successors."""

    frame = pd.DataFrame(
        {
            "cell_id": ["a", "a", "a", "a"],
            "year": [2019, 2020, 2021, 2024],
            "month_number": [1, 1, 1, 1],
            "target_no2_umol_m2": [10.0, 30.0, 50.0, 70.0],
        }
    )
    with_baseline = add_climatology(frame)
    assert np.isnan(with_baseline.loc[0, "training_baseline_no2_umol_m2"])
    assert np.isclose(with_baseline.loc[1, "training_baseline_no2_umol_m2"], 10.0)
    assert np.isclose(with_baseline.loc[2, "training_baseline_no2_umol_m2"], 20.0)
    assert np.isclose(with_baseline.loc[3, "baseline_no2_umol_m2"], 30.0)


def test_climatology_prediction_uses_historical_window_and_fallbacks():
    history = pd.DataFrame(
        {
            "cell_id": ["a", "a", "a", "b"],
            "month_number": [1, 1, 2, 1],
            "target_no2_umol_m2": [20.0, 30.0, 40.0, 40.0],
        }
    )
    targets = pd.DataFrame(
        {
            "cell_id": ["a", "a", "new-cell"],
            "month_number": [1, 3, 1],
        }
    )

    predictions = climatology_prediction(targets, history)

    np.testing.assert_allclose(predictions, [25.0, 30.0, 30.0])


def test_wind_speed_is_calculated_before_monthly_averaging():
    """Opposing winds have nonzero mean speed despite zero mean vector."""

    times = pd.to_datetime(["2020-01-01T05:30:00Z", "2020-01-02T05:30:00Z"])
    data = {name: [1.0, 1.0] for name in RAW_WEATHER}
    data.update({"u10m": [3.0, -3.0], "v10m": [4.0, -4.0]})
    frame = pd.DataFrame({"time": times, **data})
    monthly, columns = monthly_weather(frame)
    assert len(monthly) == 1
    assert "merra_wind_speed_10m_mean" in columns
    assert np.isclose(monthly.loc[0, "merra_wind_speed_10m_mean"], 5.0)
    assert np.isclose(monthly.loc[0, "merra_0530_wind_speed_10m_mean"], 5.0)


def test_neighbor_prior_uses_only_earlier_training_years():
    """Training context cannot use concurrent or later neighboring labels."""

    frame = pd.DataFrame(
        {
            "cell_id": ["a", "b", "b", "a", "a"],
            "latitude": [10.0] * 5,
            "longitude": [120.0, 120.1, 120.1, 120.0, 120.0],
            "year": [2019, 2019, 2020, 2021, 2024],
            "target_no2_umol_m2": [10.0, 20.0, 40.0, 60.0, 100.0],
        }
    )
    with_prior = add_neighbor_prior(frame)
    assert np.isnan(with_prior.loc[0, "neighbor_prior_no2_umol_m2"])
    assert np.isnan(with_prior.loc[1, "neighbor_prior_no2_umol_m2"])
    assert np.isclose(with_prior.loc[3, "neighbor_prior_no2_umol_m2"], 30.0)
    assert np.isclose(with_prior.loc[4, "neighbor_prior_no2_umol_m2"], 30.0)
