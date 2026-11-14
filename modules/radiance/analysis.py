"""Create quality-filtered radiance time series and map-ready point outputs."""

from __future__ import annotations

import argparse
import csv
from dataclasses import fields
import gzip
import json
from pathlib import Path
from typing import Sequence

from .acquisition import discover_granules
from .preprocessing import BICOL_BOUNDS, RadianceStats, filtered_points, summarize_granule


def _with_changes(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    previous: float | None = None
    for row in rows:
        current = row.get("mean_radiance")
        if isinstance(current, (int, float)) and previous is not None:
            absolute = float(current) - previous
            row["change_from_previous"] = absolute
            row["percent_change_from_previous"] = (
                absolute / previous * 100 if previous != 0 else None
            )
        else:
            row["change_from_previous"] = None
            row["percent_change_from_previous"] = None
        if isinstance(current, (int, float)):
            previous = float(current)
    return rows


def build_time_series(
    input_directory: str | Path,
    *,
    tile: str = "h30v07",
    bounds: tuple[float, float, float, float] = BICOL_BOUNDS,
) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    granules, excluded = discover_granules(input_directory, tile=tile)
    rows = [summarize_granule(item, bounds=bounds).to_dict() for item in granules]
    return _with_changes(rows), excluded


def write_time_series(rows: Sequence[dict[str, object]], output: str | Path) -> Path:
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    base_fields = [field.name for field in fields(RadianceStats)]
    fieldnames = base_fields + ["change_from_previous", "percent_change_from_previous"]
    with target.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return target


def write_map_points(granule_path: str | Path, output: str | Path) -> Path:
    """Write a gzip-compressed, map-ready point table for one granule."""

    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    latitudes, longitudes, radiance, observations = filtered_points(granule_path)
    with gzip.open(target, "wt", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["latitude", "longitude", "radiance", "observation_count"])
        writer.writerows(zip(latitudes, longitudes, radiance, observations, strict=True))
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("BlackMarbles"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/processed/radiance/radiance_time_series.csv"),
    )
    parser.add_argument("--tile", default="h30v07")
    parser.add_argument(
        "--bounds",
        nargs=4,
        type=float,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        default=BICOL_BOUNDS,
    )
    args = parser.parse_args()

    rows, excluded = build_time_series(
        args.input, tile=args.tile, bounds=tuple(args.bounds)
    )
    output = write_time_series(rows, args.output)
    manifest = output.with_suffix(".manifest.json")
    manifest.write_text(
        json.dumps(
            {
                "input_directory": str(args.input),
                "tile": args.tile,
                "bounds": args.bounds,
                "records": len(rows),
                "excluded": excluded,
                "limitations": [
                    "Bicol is approximated by a bounding box, not an administrative polygon.",
                    "Observation months differ across years and may introduce seasonal bias.",
                    "VNP46A3 composites are monthly; they are not daily VNP46A2 observations.",
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} records to {output}")
    print(f"Wrote provenance and exclusions to {manifest}")


if __name__ == "__main__":
    main()

