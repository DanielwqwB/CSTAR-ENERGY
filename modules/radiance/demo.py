"""Generate clearly labelled synthetic radiance values for presentations only."""

from __future__ import annotations

import argparse
import csv
from datetime import date
import json
from pathlib import Path

import numpy as np


DISCLAIMER = (
    "PRESENTATION-ONLY SYNTHETIC DATA. Missing months are simulated and are not "
    "NASA observations, training labels, or scientific evidence."
)


def _month_starts(start: date, end: date) -> list[date]:
    if start > end:
        raise ValueError("start date must not be after end date")
    current = date(start.year, start.month, 1)
    final = date(end.year, end.month, 1)
    months: list[date] = []
    while current <= final:
        months.append(current)
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return months


def load_observations(path: str | Path) -> dict[date, dict[str, str]]:
    observations: dict[date, dict[str, str]] = {}
    with Path(path).open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            value = row.get("mean_radiance", "").strip()
            if value:
                observations[date.fromisoformat(row["date"])] = row
    if len(observations) < 2:
        raise ValueError("At least two real observations are required")
    return observations


def generate_demo_rows(
    observations: dict[date, dict[str, str]],
    *,
    start: date = date(2016, 1, 1),
    end: date = date(2026, 12, 1),
    seed: int = 46,
) -> list[dict[str, object]]:
    """Fill missing months while preserving real values and explicit provenance."""

    observed_dates = sorted(observations)
    observed_x = np.asarray([item.toordinal() for item in observed_dates], dtype=float)
    observed_y = np.asarray(
        [float(observations[item]["mean_radiance"]) for item in observed_dates],
        dtype=float,
    )
    change_scale = float(np.median(np.abs(np.diff(observed_y))))
    if not np.isfinite(change_scale) or change_scale <= 0:
        change_scale = max(float(np.median(observed_y)) * 0.05, 1e-6)

    months = _month_starts(start, end)
    interpolated = np.interp(
        np.asarray([item.toordinal() for item in months], dtype=float),
        observed_x,
        observed_y,
    )
    rng = np.random.default_rng(seed)
    rows: list[dict[str, object]] = []
    previous_value: float | None = None
    for index, (month, base) in enumerate(zip(months, interpolated, strict=True)):
        observed = observations.get(month)
        if observed is not None:
            value = float(observed["mean_radiance"])
            lower = upper = value
            source = "observed_vnp46a3"
            method = "measured_monthly_composite"
            source_file = observed.get("source_file", "")
            is_synthetic = False
            nearest_months = 0
        else:
            seasonal = change_scale * 0.10 * np.sin(2 * np.pi * index / 12)
            noise = float(rng.normal(0.0, change_scale * 0.08))
            value = max(0.0, float(base + seasonal + noise))
            nearest_days = min(abs((month - item).days) for item in observed_dates)
            nearest_months = int(round(nearest_days / 30.4375))
            uncertainty = min(0.15 + nearest_months * 0.01, 0.45)
            lower = max(0.0, value * (1 - uncertainty))
            upper = value * (1 + uncertainty)
            source = "synthetic_demo"
            method = "linear_interpolation_with_seeded_demo_variation"
            source_file = ""
            is_synthetic = True
        change = None if previous_value is None else value - previous_value
        percent_change = (
            None
            if previous_value in (None, 0.0)
            else (value - previous_value) / previous_value * 100
        )
        rows.append(
            {
                "date": month.isoformat(),
                "year": month.year,
                "month": month.month,
                "mean_radiance": value,
                "lower_demo_bound": lower,
                "upper_demo_bound": upper,
                "change_from_previous": change,
                "percent_change_from_previous": percent_change,
                "value_source": source,
                "is_synthetic": str(is_synthetic).lower(),
                "generation_method": method,
                "nearest_observation_months": nearest_months,
                "source_file": source_file,
                "presentation_only": "true",
                "disclaimer": DISCLAIMER,
            }
        )
        previous_value = value
    return rows


def write_demo(rows: list[dict[str, object]], output: str | Path) -> Path:
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    metadata = {
        "disclaimer": DISCLAIMER,
        "records": len(rows),
        "observed_records": sum(row["is_synthetic"] == "false" for row in rows),
        "synthetic_records": sum(row["is_synthetic"] == "true" for row in rows),
        "start": rows[0]["date"],
        "end": rows[-1]["date"],
        "allowed_use": "UI demonstrations and presentation mockups only",
        "prohibited_use": "model evaluation, accuracy claims, scientific inference",
    }
    target.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/processed/radiance/radiance_time_series.csv"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/processed/radiance/radiance_demo_monthly_2016_2026.csv"),
    )
    parser.add_argument("--seed", type=int, default=46)
    args = parser.parse_args()
    rows = generate_demo_rows(load_observations(args.input), seed=args.seed)
    output = write_demo(rows, args.output)
    observed = sum(row["is_synthetic"] == "false" for row in rows)
    print(
        f"Wrote {len(rows)} presentation rows to {output}: "
        f"{observed} observed, {len(rows) - observed} synthetic"
    )
    print(DISCLAIMER)


if __name__ == "__main__":
    main()
