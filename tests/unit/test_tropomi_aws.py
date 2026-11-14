from datetime import date

import numpy as np

from pipeline.ingestion.tropomi_aws import (
    BBox,
    GridAccumulator,
    choose_orbit,
    expected_overpass_utc,
)


def test_choose_orbit_uses_local_solar_overpass() -> None:
    keys = [
        "COGT/OFFL/L2__NO2___/2025/01/01/"
        "S5P_OFFL_L2__NO2____20250101T031900_20250101T050030_37409_03_020800_"
        "20250102T201941_PRODUCT_nitrogendioxide_tropospheric_column_4326.tif",
        "COGT/OFFL/L2__NO2___/2025/01/01/"
        "S5P_OFFL_L2__NO2____20250101T050030_20250101T064200_37410_03_020800_"
        "20250103T011651_PRODUCT_nitrogendioxide_tropospheric_column_4326.tif",
    ]

    selected = choose_orbit(keys, date(2025, 1, 1), longitude=121.5)

    assert "20250101T050030_20250101T064200" in selected
    assert expected_overpass_utc(date(2025, 1, 1), 121.5).hour == 5


def test_grid_accumulator_calculates_counts_and_orbits() -> None:
    accumulator = GridAccumulator(BBox(120, 14, 121, 15), resolution=0.1)
    longitude = np.array([120.01, 120.02, 120.11])
    latitude = np.array([14.01, 14.02, 14.11])
    no2 = np.array([1e-5, 3e-5, 5e-5])
    qa = np.array([0.8, 0.9, 1.0])

    added = accumulator.add(longitude, latitude, no2, qa)

    assert added == 3
    assert accumulator.count[0, 0] == 2
    assert accumulator.orbit_count[0, 0] == 1
    assert np.isclose(accumulator.no2_sum[0, 0], 4e-5)
    assert accumulator.count[1, 1] == 1
