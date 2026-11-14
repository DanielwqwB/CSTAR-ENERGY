from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np

from experiments.blackmarble_spatial_forecast import (
    _exclude_empty_months,
    _month_after,
    _month_before,
    _write_observed,
    make_features,
)


def test_month_helpers_cross_year_boundaries() -> None:
    assert _month_before("2024-01") == "2023-12"
    assert _month_after("2024-12") == "2025-01"


def test_features_include_cell_coordinates_lagged_radiance_and_month() -> None:
    features = make_features(
        np.array([14.5]),
        np.array([122.9]),
        np.array([1.25]),
        "2024-01",
    )

    assert features.shape == (1, 5)
    np.testing.assert_allclose(features[0, :3], [122.9, 14.5, 1.25])
    np.testing.assert_allclose(features[0, 3:], [0.0, 1.0], atol=1e-6)


def test_empty_source_months_are_excluded_from_observed_grids() -> None:
    monthly = {
        "2026-10": (np.array([1.0, np.nan]), np.array([1, 0])),
        "2026-11": (np.array([np.nan, np.nan]), np.array([0, 0])),
    }

    excluded = _exclude_empty_months(monthly)

    assert excluded == ["2026-11"]
    assert list(monthly) == ["2026-10"]


def test_observation_export_preserves_little_endian_arrays(tmp_path: Path) -> None:
    path = tmp_path / "month.bin.gz"
    radiance = np.array([1.25, np.nan], dtype=np.float32)
    counts = np.array([4, 0], dtype=np.uint16)

    _write_observed(path, radiance, counts)

    with gzip.open(path, "rb") as stream:
        exported = stream.read()
    expected = radiance.astype("<f4").tobytes() + counts.astype("<u2").tobytes()
    assert exported == expected
