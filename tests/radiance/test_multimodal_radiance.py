from __future__ import annotations

import csv
from pathlib import Path

from experiments.radiance_multimodal_demo import (
    load_radiance,
    observed_monthly_pairs,
)


def test_load_radiance_accepts_processed_observation_schema(tmp_path: Path) -> None:
    path = tmp_path / "radiance_time_series.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["date", "mean_radiance"])
        writer.writeheader()
        writer.writerows(
            [
                {"date": "2020-01-01", "mean_radiance": "1.0"},
                {"date": "2020-03-01", "mean_radiance": "3.0"},
            ]
        )

    observations = load_radiance(path)

    assert set(observations) == {"2020-01", "2020-03"}
    assert observations["2020-03"]["lag_radiance"] == 1.0
    assert observations["2020-03"]["lag_gap_months"] == 2
    assert observations["2020-03"]["radiance_is_synthetic"] == "false"


def test_load_radiance_excludes_synthetic_months_and_reads_real_series(
    tmp_path: Path,
) -> None:
    path = tmp_path / "radiance.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=[
                "date",
                "mean_radiance",
                "is_synthetic",
                "presentation_only",
                "value_source",
            ],
        )
        writer.writeheader()
        writer.writerows(
            [
                {
                    "date": "2020-01-01",
                    "mean_radiance": "1.0",
                    "is_synthetic": "false",
                    "presentation_only": "false",
                    "value_source": "observed_vnp46a3",
                },
                {
                    "date": "2020-02-01",
                    "mean_radiance": "99.0",
                    "is_synthetic": "true",
                    "presentation_only": "true",
                    "value_source": "synthetic_demo",
                },
                {
                    "date": "2020-03-01",
                    "mean_radiance": "3.0",
                    "is_synthetic": "false",
                    "presentation_only": "false",
                    "value_source": "observed_vnp46a3",
                },
            ]
        )

    observations = load_radiance(path)

    assert set(observations) == {"2020-01", "2020-03"}
    assert observations["2020-03"]["radiance"] == 3.0
    assert observations["2020-03"]["lag_radiance"] == 1.0
    assert observations["2020-03"]["radiance_is_synthetic"] == "false"


def test_monthly_direction_pairs_exclude_gaps() -> None:
    rows = [
        {"month": "2020-02", "lag_gap_months": 1},
        {"month": "2020-04", "lag_gap_months": 2},
    ]

    assert observed_monthly_pairs(rows) == [rows[0]]
