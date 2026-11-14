from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipeline.harmonization.merra_features import (
    RAW_FEATURES,
    build_supervised_frame,
    chronological_masks,
)
from pipeline.ingestion.merra import load_merra_directory


VARIABLES = [
    "CLDTMP",
    "PS",
    "T2M",
    "TO3",
    "TQV",
    "TS",
    "U10M",
    "U50M",
    "V10M",
    "V50M",
]


def write_giovanni_file(root: Path, variable: str, values: list[float]) -> None:
    times = pd.date_range("2023-01-01", periods=len(values), freq="h")
    lines = [
        "User Start Date:,2023-01-01T00:00:00.000Z",
        "User End Date:,2023-01-10T00:00:00.000Z",
        'User Bounding Box:,"116, 4, 127, 22"',
        "Fill Value:,1E+15",
        ",",
        f"time,mean_M2T1NXSLV_5_12_4_{variable}",
    ]
    lines.extend(
        f"{timestamp.strftime('%Y-%m-%dT%H:%M:%S')},{value}"
        for timestamp, value in zip(times, values)
    )
    (root / f"sample_{variable}.csv").write_text("\n".join(lines), encoding="utf-8")


def test_load_and_build_merra_features(tmp_path: Path) -> None:
    row_count = 240
    for offset, variable in enumerate(VARIABLES):
        write_giovanni_file(
            tmp_path,
            variable,
            [float(offset + index / 100) for index in range(row_count)],
        )

    frame, metadata = load_merra_directory(tmp_path)
    assert len(frame) == row_count
    assert {item.variable for item in metadata} == {
        variable.lower() for variable in VARIABLES
    }
    assert frame["time"].dt.tz is not None

    supervised, features = build_supervised_frame(frame)
    assert len(supervised) == row_count - 169
    assert "wind_speed_10m" in features
    assert "t2m_lag_168h" in features
    first = supervised.iloc[0]
    assert first["target_t2m"] > first["t2m"]


def test_split_uses_target_year_at_boundary() -> None:
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(
                [
                    "2023-12-31T22:30:00Z",
                    "2023-12-31T23:30:00Z",
                    "2024-12-31T23:30:00Z",
                    "2025-01-01T00:30:00Z",
                ]
            ),
            "target_time": pd.to_datetime(
                [
                    "2023-12-31T23:30:00Z",
                    "2024-01-01T00:30:00Z",
                    "2025-01-01T00:30:00Z",
                    "2025-01-01T01:30:00Z",
                ]
            ),
        }
    )
    masks = chronological_masks(frame)
    assert masks["train"].tolist() == [True, False, False, False]
    assert masks["validation"].tolist() == [False, True, False, False]
    assert masks["test"].tolist() == [False, False, True, True]


def test_non_hourly_target_is_rejected() -> None:
    times = pd.date_range("2023-12-20T00:30:00Z", periods=240, freq="h")
    times = times.delete(200)
    data = {feature: [1.0] * len(times) for feature in RAW_FEATURES}
    frame = pd.DataFrame({"time": times, **data})
    with pytest.raises(ValueError, match="not exactly 1 hour"):
        build_supervised_frame(frame)
