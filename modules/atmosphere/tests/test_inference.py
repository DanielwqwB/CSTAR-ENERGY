"""Checkpoint inference must preserve baseline and weather gate semantics."""

import numpy as np
import pandas as pd
import pytest
from sklearn.dummy import DummyRegressor

from modules.atmosphere.inference import predict_tropomi


def climatology() -> dict[str, object]:
    return {
        "cell_month_mean": {("a", 1): 10.0},
        "cell_mean": {"a": 20.0},
        "seasonal_mean": {1: 30.0},
        "global_mean": 40.0,
    }


def test_selected_climatology_uses_saved_fallbacks_and_keeps_missing_observations() -> None:
    checkpoint = {
        "model_name": "spatial_seasonal_climatology",
        "model": None,
        "climatology": climatology(),
        "interval_radius_umol_m2": 2.0,
    }
    frame = pd.DataFrame(
        {
            "month": ["2025-01", "2025-02", "2025-01", "2025-02"],
            "cell_id": ["a", "a", "b", "b"],
            "observed_no2_umol_m2": [11.0, 23.0, np.nan, 35.0],
        }
    )
    result = predict_tropomi(frame, checkpoint)
    np.testing.assert_allclose(result["expected_no2_umol_m2"], [10, 20, 30, 40])
    np.testing.assert_allclose(
        result["anomaly_umol_m2"], [1, 3, np.nan, -5], equal_nan=True
    )
    assert not bool(result.loc[0, "significant_anomaly"])
    assert bool(result.loc[1, "significant_anomaly"])
    assert pd.isna(result.loc[2, "significant_anomaly"])
    assert bool(result.loc[3, "significant_anomaly"])
    assert set(result["anomaly_interpretation"]) == {"climatology residual"}


def test_weather_residual_requires_passed_gate_and_saved_features() -> None:
    model = DummyRegressor(strategy="constant", constant=2.0)
    model.fit(pd.DataFrame({"merra_t2m_mean": [1.0]}), [2.0])
    checkpoint = {
        "model_name": "ridge_weather",
        "model": model,
        "feature_columns": ["merra_t2m_mean"],
        "acceptance_gate_passed": True,
        "climatology": climatology(),
        "interval_radius_umol_m2": 1.0,
    }
    frame = pd.DataFrame(
        {
            "month": ["2025-01"],
            "cell_id": ["a"],
            "merra_t2m_mean": [300.0],
            "tropospheric_no2_mean_mol_m2": [15e-6],
        }
    )
    result = predict_tropomi(frame, checkpoint)
    assert np.isclose(result.loc[0, "expected_no2_umol_m2"], 12.0)
    assert np.isclose(result.loc[0, "anomaly_umol_m2"], 3.0)
    assert bool(result.loc[0, "significant_anomaly"])
    assert result.loc[0, "anomaly_interpretation"] == "weather-adjusted residual"

    checkpoint["acceptance_gate_passed"] = False
    with pytest.raises(ValueError, match="passing acceptance gate"):
        predict_tropomi(frame, checkpoint)
    checkpoint["acceptance_gate_passed"] = True
    with pytest.raises(ValueError, match="merra_t2m_mean"):
        predict_tropomi(frame.drop(columns="merra_t2m_mean"), checkpoint)


def test_selected_weather_ensemble_can_predict_without_a_primary_model() -> None:
    components = {}
    for name, constant in (("ridge_spatial_weather", 1.0), ("hgb_spatial_weather", 3.0)):
        model = DummyRegressor(strategy="constant", constant=constant)
        model.fit(pd.DataFrame({"merra_t2m_mean": [1.0]}), [constant])
        components[name] = model
    checkpoint = {
        "model_name": "ensemble_spatial_weather",
        "model": None,
        "acceptance_gate_passed": True,
        "climatology": climatology(),
        "ensemble_components": tuple(components),
        "component_models": components,
        "component_feature_columns": {
            name: ["merra_t2m_mean"] for name in components
        },
    }
    frame = pd.DataFrame(
        {"month": ["2025-01"], "cell_id": ["a"], "merra_t2m_mean": [300.0]}
    )
    result = predict_tropomi(frame, checkpoint)
    assert np.isclose(result.loc[0, "expected_no2_umol_m2"], 12.0)
    assert np.isnan(result.loc[0, "anomaly_umol_m2"])
    assert pd.isna(result.loc[0, "significant_anomaly"])
