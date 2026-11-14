import json

import numpy as np
import pandas as pd

from pipeline.harmonization.merra_features import RAW_FEATURES
from pipeline.harmonization.tropomi_features import (
    add_training_climatology,
    aggregate_merra_monthly,
    apply_boundary_mask,
    chronological_masks,
)


def test_apply_boundary_mask_keeps_cell_centers_inside_polygon(tmp_path) -> None:
    boundary = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[120, 14], [121, 14], [121, 15], [120, 15], [120, 14]]
                    ],
                },
            }
        ],
    }
    path = tmp_path / "boundary.geojson"
    path.write_text(json.dumps(boundary), encoding="utf-8")
    frame = pd.DataFrame(
        {
            "longitude": [120.05, 122.05],
            "latitude": [14.05, 14.05],
            "cell_id": ["inside", "outside"],
        }
    )

    result = apply_boundary_mask(frame, path)

    assert result["cell_id"].tolist() == ["inside"]


def test_aggregate_merra_monthly_builds_weather_statistics() -> None:
    times = pd.to_datetime(
        [
            "2020-01-01T00:30:00Z",
            "2020-01-01T01:30:00Z",
            "2020-02-01T00:30:00Z",
            "2020-02-01T01:30:00Z",
        ]
    )
    frame = pd.DataFrame({"time": times})
    for index, name in enumerate(RAW_FEATURES, start=1):
        frame[name] = np.array([index, index + 2, index + 4, index + 6], dtype=float)

    monthly, features = aggregate_merra_monthly(frame)

    assert len(monthly) == 2
    assert len(features) == 30
    assert np.isclose(monthly.loc[0, "merra_t2m_mean"], RAW_FEATURES.index("t2m") + 2)
    assert not monthly[features].isna().any().any()


def test_training_climatology_is_leave_one_out() -> None:
    frame = pd.DataFrame(
        {
            "month": pd.to_datetime(
                ["2019-01-01", "2020-01-01", "2024-01-01", "2025-01-01"],
                utc=True,
            ),
            "month_number": [1, 1, 1, 1],
            "cell_id": ["cell-a"] * 4,
            "target_no2_umol_m2": np.array([10, 14, 20, 22], dtype=np.float32),
        }
    )
    masks = chronological_masks(frame)

    result, _ = add_training_climatology(frame, masks)

    assert np.isclose(result.loc[0, "baseline_no2_umol_m2"], 14)
    assert np.isclose(result.loc[1, "baseline_no2_umol_m2"], 10)
    assert np.isclose(result.loc[2, "baseline_no2_umol_m2"], 12)
    assert np.isclose(result.loc[3, "baseline_no2_umol_m2"], 12)
