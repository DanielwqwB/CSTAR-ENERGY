import numpy as np
import pandas as pd
import pytest

from modules.atmosphere.train_tropomi_weather import (
    _compare_climatology_windows,
    _compare_expanded_training,
    _forward_holdout_metrics,
)


def test_forward_holdout_metrics_compare_fixed_candidate_without_selection() -> None:
    frame = pd.DataFrame(
        {
            "year": [2026, 2026],
            "month": pd.to_datetime(["2026-01-01", "2026-02-01"], utc=True),
            "target_no2_umol_m2": [10.0, 20.0],
        }
    )

    result = _forward_holdout_metrics(
        frame,
        2026,
        np.array([12.0, 24.0]),
        "ridge_spatial_control",
        np.array([11.0, 22.0]),
        "ridge_weather",
        np.array([10.5, 20.5]),
    )

    assert result["rows"] == 2
    assert result["months"] == ["2026-01", "2026-02"]
    assert result["frozen_candidates_not_used_for_training_or_selection"] is True
    assert result["matched_no_weather_control_model"] == "ridge_spatial_control"
    assert result["candidate_model_selected_on_2024_validation"] == "ridge_weather"
    assert result["candidate_mae_improvement_over_climatology_percent"] == pytest.approx(
        83.3333333333
    )
    assert result["weather_mae_improvement_over_matched_control_percent"] == pytest.approx(
        66.6666666667
    )


def test_climatology_window_development_uses_only_years_before_holdout() -> None:
    frame = pd.DataFrame(
    {
        "year": [2019, 2021, 2023, 2024, 2025, 2026],
        "month": pd.to_datetime(
            [
                "2019-01-01",
                "2021-01-01",
                "2023-01-01",
                "2024-01-01",
                "2025-01-01",
                "2026-01-01",
            ],
            utc=True,
        ),
        "month_number": [1] * 6,
        "cell_id": ["a"] * 6,
        "target_no2_umol_m2": [10.0, 14.0, 18.0, 20.0, 22.0, 999.0],
    }
    )
    holdout = frame.loc[frame["year"].eq(2026)].copy()

    report, predictions = _compare_climatology_windows(
    frame,
    holdout,
    2026,
    np.array([15.0]),
    )

    assert report["training_data_through_year"] == 2025
    assert report["purpose"] == "post-hoc development comparison; not an independent test"
    assert report["best_development_candidate"] == "climatology_2023_2025"
    assert predictions.loc[0, "climatology_2023_2025_no2_umol_m2"] == 20.0
    assert report["candidates"]["climatology_2023_2025"]["training_rows"] == 3


def test_expanded_training_refit_excludes_forward_year_targets() -> None:
    years = list(range(2020, 2027))
    frame = pd.DataFrame(
        {
            "year": years,
            "month": pd.to_datetime(
                [f"{year}-01-01" for year in years], utc=True
            ),
            "cell_id": ["a"] * len(years),
            "year_index": np.asarray(years, dtype=float) - 2019,
            "baseline_no2_umol_m2": [10.0] * len(years),
            "target_residual_umol_m2": [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 999.0],
            "target_no2_umol_m2": [11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 999.0],
            "sample_weight": [1.0] * len(years),
        }
    )
    holdout = pd.concat(
        [
            frame.loc[frame["year"].eq(2026)],
            frame.loc[frame["year"].eq(2026)].assign(
                cell_id="b", target_no2_umol_m2=12.0
            ),
            frame.loc[frame["year"].eq(2026)].assign(
                cell_id="c", target_no2_umol_m2=14.0
            ),
        ],
        ignore_index=True,
    )
    specs = [
        {
            "name": "ridge_core",
            "kind": "ridge",
            "features": ["year_index"],
            "weather": False,
        }
    ]

    report, predictions = _compare_expanded_training(
        pd.concat([frame.loc[frame["year"].lt(2026)], holdout], ignore_index=True),
        holdout,
        2026,
        specs,
        42,
    )

    assert report["training_end_year"] == 2025
    assert report["training_rows"] == 6
    assert report["purpose"] == "post-hoc development comparison; not an independent test"
    assert len(predictions) == 3
    assert report["best_development_candidate"] == "ridge_core"


def test_forward_holdout_metrics_reject_misaligned_or_wrong_year_data() -> None:
    frame = pd.DataFrame(
        {
            "year": [2025],
            "month": pd.to_datetime(["2025-01-01"], utc=True),
            "target_no2_umol_m2": [10.0],
        }
    )

    with pytest.raises(ValueError, match="observations from 2026 only"):
        _forward_holdout_metrics(
            frame,
            2026,
            np.array([10.0]),
            "ridge_spatial_control",
            np.array([10.0]),
            "ridge_weather",
            np.array([10.0]),
        )

    frame["year"] = 2026
    with pytest.raises(ValueError, match="predictions must align"):
        _forward_holdout_metrics(
            frame,
            2026,
            np.array([]),
            "ridge_spatial_control",
            np.array([]),
            "ridge_weather",
            np.array([]),
        )
