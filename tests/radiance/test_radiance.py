from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np

from modules.radiance.acquisition import discover_granules, parse_granule_name
from modules.radiance.download import (
    RemoteGranule,
    load_inventory,
    month_starts,
    select_tile_row,
    write_inventory,
)
from modules.radiance.demo import generate_demo_rows
from modules.radiance.preprocessing import DATA_FIELDS, summarize_granule


def _write_granule(path: Path) -> None:
    with h5py.File(path, "w") as handle:
        fields = handle.require_group(DATA_FIELDS)
        fields.create_dataset("lat", data=np.array([14.0, 13.0, 12.0]))
        fields.create_dataset("lon", data=np.array([122.5, 123.5, 124.5]))
        radiance = fields.create_dataset(
            "AllAngle_Composite_Snow_Free",
            data=np.array([[1, 2, 3], [4, 5, 6], [7, -999.9, 9]], dtype=np.float32),
        )
        radiance.attrs["_FillValue"] = np.array([-999.9], dtype=np.float32)
        radiance.attrs["scale_factor"] = np.array([1.0], dtype=np.float32)
        radiance.attrs["offset"] = np.array([0.0], dtype=np.float32)
        radiance.attrs["units"] = "nWatts/(cm^2 sr)"
        fields.create_dataset(
            "AllAngle_Composite_Snow_Free_Quality",
            data=np.array([[0, 0, 1], [0, 2, 0], [255, 0, 0]], dtype=np.uint8),
        )
        fields.create_dataset(
            "AllAngle_Composite_Snow_Free_Num",
            data=np.full((3, 3), 2, dtype=np.uint16),
        )
        fields.create_dataset(
            "Land_Water_Mask",
            data=np.array([[1, 1, 1], [1, 1, 3], [1, 1, 5]], dtype=np.uint8),
        )


def test_parse_granule_name() -> None:
    item = parse_granule_name("VNP46A3.A2024061.h30v07.002.12345.h5")
    assert item.observation_date.isoformat() == "2024-03-01"
    assert item.tile == "h30v07"


def test_discovery_excludes_duplicates_and_other_tiles(tmp_path: Path) -> None:
    primary = tmp_path / "VNP46A3.A2018091.h30v07.002.123.h5"
    duplicate = tmp_path / "VNP46A3.A2018091.h30v07.002.123 (1).h5"
    other_tile = tmp_path / "VNP46A3.A2018091.h30v08.002.123.h5"
    for path in (primary, duplicate, other_tile):
        _write_granule(path)
    (tmp_path / "partial.crdownload").write_bytes(b"partial")

    granules, excluded = discover_granules(tmp_path)

    assert [item.path.name for item in granules] == [primary.name]
    assert {entry["reason"] for entry in excluded} == {
        "duplicate",
        "not_hdf5",
        "tile_not_h30v07",
    }


def test_quality_filtered_summary(tmp_path: Path) -> None:
    path = tmp_path / "VNP46A3.A2020001.h30v07.002.123.h5"
    _write_granule(path)

    result = summarize_granule(path)

    assert result.total_pixels == 9
    assert result.land_pixels == 8
    assert result.direct_good_pixels == 5
    # One direct/good pixel contains the radiance fill value and is invalid.
    assert result.valid_pixels == 4
    assert result.gap_filled_pixels == 1
    assert result.poor_quality_pixels == 1
    assert result.fill_quality_pixels == 1
    assert result.mean_radiance == 4.0


def test_month_starts_excludes_future_months() -> None:
    from datetime import date

    months = month_starts(2025, 2026, today=date(2026, 11, 14))

    assert len(months) == 23
    assert months[0] == date(2025, 1, 1)
    assert months[-1] == date(2026, 11, 1)


def test_select_tile_row() -> None:
    from datetime import date

    text = """name,size,downloadsLink
VNP46A3.A2016153.h29v07.002.111.h5,10,https://example.test/other.h5
VNP46A3.A2016153.h30v07.002.222.h5,20,https://example.test/wanted.h5
"""

    result = select_tile_row(text, month=date(2016, 6, 1), tile="h30v07")

    assert result.name == "VNP46A3.A2016153.h30v07.002.222.h5"
    assert result.size == 20
    assert result.url == "https://example.test/wanted.h5"


def test_inventory_cache_round_trip(tmp_path: Path) -> None:
    from datetime import date

    items = [
        RemoteGranule(
            name="VNP46A3.A2025001.h30v07.002.1.h5",
            observation_date="2025-01-01",
            size=20,
            url="https://example.test/january.h5",
        ),
        RemoteGranule(
            name="VNP46A3.A2025032.h30v07.002.2.h5",
            observation_date="2025-02-01",
            size=21,
            url="https://example.test/february.h5",
        ),
    ]
    path = tmp_path / "inventory.json"
    write_inventory(items, path)

    loaded = load_inventory(
        path,
        start_year=2025,
        end_year=2025,
        tile="h30v07",
        today=date(2025, 2, 15),
    )

    assert loaded == items


def test_demo_generation_preserves_observations_and_labels_synthetic() -> None:
    from datetime import date

    observations = {
        date(2020, 1, 1): {
            "mean_radiance": "1.0",
            "source_file": "january.h5",
        },
        date(2020, 3, 1): {
            "mean_radiance": "3.0",
            "source_file": "march.h5",
        },
    }

    rows = generate_demo_rows(
        observations,
        start=date(2020, 1, 1),
        end=date(2020, 3, 1),
        seed=1,
    )

    assert len(rows) == 3
    assert rows[0]["mean_radiance"] == 1.0
    assert rows[0]["is_synthetic"] == "false"
    assert rows[1]["is_synthetic"] == "true"
    assert rows[1]["presentation_only"] == "true"
    assert rows[2]["mean_radiance"] == 3.0
    assert rows[2]["is_synthetic"] == "false"

