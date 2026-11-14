"""Extract QA-filtered TROPOMI NO2 from the public Sentinel-5P AWS archive.

The source archive stores one global Cloud Optimized GeoTIFF (COG) per orbit.
This module reads only the requested geographic window over HTTP, applies the
TROPOMI NO2 quality threshold, and writes compact monthly 0.1-degree tables.
It does not download the roughly 600 MB Level-2 NetCDF orbit files.

Source archive:
https://registry.opendata.aws/sentinel5p/
"""

from __future__ import annotations

import argparse
import calendar
import concurrent.futures
import csv
import gzip
import hashlib
import json
import math
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.windows import Window, from_bounds


S3_BUCKET_URL = "https://meeo-s5p.s3.eu-central-1.amazonaws.com"
S3_LIST_URL = "https://meeo-s5p.s3.amazonaws.com"
PRODUCT_PREFIXES = (
    "COGT/RPRO/L2__NO2___",  # Prefer the reprocessed research-quality stream.
    "COGT/OFFL/L2__NO2___",  # Fall back where RPRO is not available.
)
NO2_SUFFIX = "_PRODUCT_nitrogendioxide_tropospheric_column_4326.tif"
QA_SUFFIX = "_PRODUCT_qa_value_4326.tif"
SOURCE_CATALOG = "https://registry.opendata.aws/sentinel5p/"
SOURCE_PRODUCT = "Sentinel-5P TROPOMI RPRO/OFFL Level-2 NO2 COG"
NO2_UNITS = "mol m-2"
ORBIT_TIME_RE = re.compile(
    r"_(?P<start>\d{8}T\d{6})_(?P<end>\d{8}T\d{6})_\d{5}_"
)


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def validate(self) -> None:
        if not (-180 <= self.west < self.east <= 180):
            raise ValueError("Longitude bounds must satisfy -180 <= west < east <= 180")
        if not (-90 <= self.south < self.north <= 90):
            raise ValueError("Latitude bounds must satisfy -90 <= south < north <= 90")

    @property
    def center_longitude(self) -> float:
        return (self.west + self.east) / 2

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]


@dataclass
class GridAccumulator:
    bbox: BBox
    resolution: float

    def __post_init__(self) -> None:
        self.nx = math.ceil((self.bbox.east - self.bbox.west) / self.resolution)
        self.ny = math.ceil((self.bbox.north - self.bbox.south) / self.resolution)
        shape = (self.ny, self.nx)
        self.count = np.zeros(shape, dtype=np.int64)
        self.orbit_count = np.zeros(shape, dtype=np.int32)
        self.no2_sum = np.zeros(shape, dtype=np.float64)
        self.no2_sum_sq = np.zeros(shape, dtype=np.float64)
        self.qa_sum = np.zeros(shape, dtype=np.float64)

    def add(
        self,
        longitude: np.ndarray,
        latitude: np.ndarray,
        no2: np.ndarray,
        qa: np.ndarray,
    ) -> int:
        ix = np.floor((longitude - self.bbox.west) / self.resolution).astype(np.int64)
        iy = np.floor((latitude - self.bbox.south) / self.resolution).astype(np.int64)
        inside = (ix >= 0) & (ix < self.nx) & (iy >= 0) & (iy < self.ny)
        if not np.any(inside):
            return 0

        ix = ix[inside]
        iy = iy[inside]
        no2 = no2[inside].astype(np.float64, copy=False)
        qa = qa[inside].astype(np.float64, copy=False)
        flat = iy * self.nx + ix

        count_flat = self.count.ravel()
        orbit_flat = self.orbit_count.ravel()
        no2_sum_flat = self.no2_sum.ravel()
        no2_sum_sq_flat = self.no2_sum_sq.ravel()
        qa_sum_flat = self.qa_sum.ravel()

        np.add.at(count_flat, flat, 1)
        np.add.at(no2_sum_flat, flat, no2)
        np.add.at(no2_sum_sq_flat, flat, no2 * no2)
        np.add.at(qa_sum_flat, flat, qa)
        orbit_flat[np.unique(flat)] += 1
        return int(no2.size)


def _urlopen_with_retry(url: str, attempts: int = 4, timeout: int = 60):
    for attempt in range(1, attempts + 1):
        try:
            return urllib.request.urlopen(url, timeout=timeout)
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
            time.sleep(2 ** (attempt - 1))
    raise RuntimeError("unreachable")


def list_s3_keys(prefix: str) -> list[str]:
    keys: list[str] = []
    continuation: str | None = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if continuation:
            query["continuation-token"] = continuation
        url = f"{S3_LIST_URL}/?{urllib.parse.urlencode(query)}"
        with _urlopen_with_retry(url) as response:
            root = ET.fromstring(response.read())
        namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        keys.extend(
            node.text
            for node in root.findall("s3:Contents/s3:Key", namespace)
            if node.text
        )
        truncated = root.findtext("s3:IsTruncated", default="false", namespaces=namespace)
        if truncated.lower() != "true":
            break
        continuation = root.findtext("s3:NextContinuationToken", namespaces=namespace)
        if not continuation:
            raise RuntimeError("S3 listing was truncated without a continuation token")
    return keys


def parse_orbit_interval(key: str) -> tuple[datetime, datetime]:
    match = ORBIT_TIME_RE.search(key)
    if not match:
        raise ValueError(f"Could not parse orbit interval from {key}")
    start = datetime.strptime(match.group("start"), "%Y%m%dT%H%M%S").replace(
        tzinfo=timezone.utc
    )
    end = datetime.strptime(match.group("end"), "%Y%m%dT%H%M%S").replace(
        tzinfo=timezone.utc
    )
    return start, end


def expected_overpass_utc(day: date, longitude: float) -> datetime:
    # Sentinel-5P crosses the equator at approximately 13:30 local solar time.
    utc_hours = (13.5 - longitude / 15.0) % 24
    midnight = datetime.combine(day, datetime_time(), tzinfo=timezone.utc)
    return midnight + timedelta(hours=utc_hours)


def choose_orbit(keys: Iterable[str], day: date, longitude: float) -> str | None:
    no2_keys = sorted(key for key in keys if key.endswith(NO2_SUFFIX))
    if not no2_keys:
        return None
    target = expected_overpass_utc(day, longitude)
    containing: list[str] = []
    scored: list[tuple[float, str]] = []
    for key in no2_keys:
        start, end = parse_orbit_interval(key)
        if start <= target < end:
            containing.append(key)
        midpoint = start + (end - start) / 2
        scored.append((abs((midpoint - target).total_seconds()), key))
    if containing:
        return containing[0]
    return min(scored)[1]


def _remote_url(key: str) -> str:
    return f"{S3_BUCKET_URL}/{urllib.parse.quote(key, safe='/')}"


def _clamped_window(
    dataset: rasterio.io.DatasetReader, bbox: BBox
) -> Window | None:
    if (
        bbox.east <= dataset.bounds.left
        or bbox.west >= dataset.bounds.right
        or bbox.north <= dataset.bounds.bottom
        or bbox.south >= dataset.bounds.top
    ):
        return None
    requested = from_bounds(
        bbox.west,
        bbox.south,
        bbox.east,
        bbox.north,
        transform=dataset.transform,
    ).round_offsets().round_lengths()
    full = Window(0, 0, dataset.width, dataset.height)
    return requested.intersection(full)


def read_orbit_window(
    no2_key: str,
    bbox: BBox,
    qa_threshold: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    qa_key = no2_key[: -len(NO2_SUFFIX)] + QA_SUFFIX
    no2_url = _remote_url(no2_key)
    qa_url = _remote_url(qa_key)
    gdal_options = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
        "GDAL_HTTP_MULTIRANGE": "YES",
        "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    }
    with rasterio.Env(**gdal_options):
        with rasterio.open(no2_url) as no2_dataset, rasterio.open(qa_url) as qa_dataset:
            no2_window = _clamped_window(no2_dataset, bbox)
            qa_window = _clamped_window(qa_dataset, bbox)
            if no2_window is None or qa_window is None:
                empty = np.array([], dtype=np.float64)
                return empty, empty, empty, empty
            no2 = no2_dataset.read(1, window=no2_window, masked=True)
            no2_transform = no2_dataset.window_transform(no2_window)
            qa_source = qa_dataset.read(1, window=qa_window, masked=False)
            qa_transform = qa_dataset.window_transform(qa_window)
            qa_values = np.full(no2.shape, 255, dtype=np.float32)
            reproject(
                source=qa_source,
                destination=qa_values,
                src_transform=qa_transform,
                src_crs=qa_dataset.crs,
                src_nodata=qa_dataset.nodata,
                dst_transform=no2_transform,
                dst_crs=no2_dataset.crs,
                dst_nodata=255,
                resampling=Resampling.nearest,
            )

    no2_values = np.asarray(no2.data)
    qa_cutoff = qa_threshold * 100 if qa_threshold <= 1 else qa_threshold
    valid = (
        ~np.ma.getmaskarray(no2)
        & np.isfinite(no2_values)
        & np.isfinite(qa_values)
        & (qa_values != 255)
        & (qa_values >= qa_cutoff)
        & (no2_values >= -0.001)
    )
    if not np.any(valid):
        empty = np.array([], dtype=np.float64)
        return empty, empty, empty, empty

    rows, columns = np.nonzero(valid)
    longitude = no2_transform.c + (columns + 0.5) * no2_transform.a
    latitude = no2_transform.f + (rows + 0.5) * no2_transform.e
    return (
        longitude.astype(np.float64),
        latitude.astype(np.float64),
        no2_values[valid].astype(np.float64),
        qa_values[valid].astype(np.float64) / 100.0,
    )


def read_orbit_window_with_retry(
    no2_key: str,
    bbox: BBox,
    qa_threshold: float,
    attempts: int = 3,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    for attempt in range(1, attempts + 1):
        try:
            return read_orbit_window(no2_key, bbox=bbox, qa_threshold=qa_threshold)
        except Exception:
            if attempt == attempts:
                raise
            time.sleep(2 ** (attempt - 1))
    raise RuntimeError("unreachable")


def iter_days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def iter_months(start: date, end: date) -> Iterable[tuple[int, int]]:
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        month += 1
        if month == 13:
            year += 1
            month = 1


def write_month_csv(
    path: Path,
    month_label: str,
    accumulator: GridAccumulator,
) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    valid_cells = np.argwhere(accumulator.count > 0)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "month",
                "cell_id",
                "longitude",
                "latitude",
                "tropospheric_no2_mean_mol_m2",
                "tropospheric_no2_std_mol_m2",
                "qa_mean",
                "valid_pixel_count",
                "valid_orbit_count",
                "source_product",
            ]
        )
        for iy, ix in valid_cells:
            count = int(accumulator.count[iy, ix])
            mean = accumulator.no2_sum[iy, ix] / count
            variance = max(accumulator.no2_sum_sq[iy, ix] / count - mean * mean, 0.0)
            longitude = accumulator.bbox.west + (ix + 0.5) * accumulator.resolution
            latitude = accumulator.bbox.south + (iy + 0.5) * accumulator.resolution
            writer.writerow(
                [
                    month_label,
                    f"x{ix:04d}_y{iy:04d}",
                    f"{longitude:.6f}",
                    f"{latitude:.6f}",
                    f"{mean:.12g}",
                    f"{math.sqrt(variance):.12g}",
                    f"{accumulator.qa_sum[iy, ix] / count:.6f}",
                    count,
                    int(accumulator.orbit_count[iy, ix]),
                    SOURCE_PRODUCT,
                ]
            )
    return int(valid_cells.shape[0])


def combine_monthly_csvs(output_dir: Path, start: date, end: date) -> Path:
    monthly_paths = sorted((output_dir / "monthly").glob("tropomi_no2_*.csv.gz"))
    expected_months = sum(1 for _ in iter_months(start, end))
    if len(monthly_paths) != expected_months:
        raise ValueError(
            f"Expected {expected_months} monthly CSV files but found {len(monthly_paths)}"
        )
    combined_path = output_dir / f"tropomi_no2_{start}_{end}.csv.gz"
    expected_header: str | None = None
    with gzip.open(combined_path, "wt", encoding="utf-8", newline="") as output:
        for monthly_path in monthly_paths:
            with gzip.open(monthly_path, "rt", encoding="utf-8", newline="") as source:
                header = source.readline()
                if expected_header is None:
                    expected_header = header
                    output.write(header)
                elif header != expected_header:
                    raise ValueError(f"Header mismatch in {monthly_path}")
                shutil.copyfileobj(source, output)
    return combined_path


def write_sha256sums(output_dir: Path, combined_path: Path) -> Path:
    paths = sorted((output_dir / "monthly").glob("tropomi_no2_*"))
    paths.extend([combined_path, output_dir / "tropomi_extraction_summary.json"])
    checksum_path = output_dir / "SHA256SUMS.txt"
    lines: list[str] = []
    for path in paths:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        lines.append(f"{digest.hexdigest()}  {path.relative_to(output_dir).as_posix()}")
    checksum_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return checksum_path


def process_month(
    year: int,
    month: int,
    requested_start: date,
    requested_end: date,
    bbox: BBox,
    resolution: float,
    qa_threshold: float,
    output_dir: Path,
) -> dict:
    month_start, month_end = month_bounds(year, month)
    start = max(month_start, requested_start)
    end = min(month_end, requested_end)
    label = f"{year:04d}-{month:02d}"
    output_path = output_dir / "monthly" / f"tropomi_no2_{label}.csv.gz"
    manifest_path = output_dir / "monthly" / f"tropomi_no2_{label}.manifest.json"
    if output_path.exists() and manifest_path.exists():
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        same_configuration = (
            existing.get("period_start") == start.isoformat()
            and existing.get("period_end") == end.isoformat()
            and existing.get("bbox_wgs84") == bbox.as_list()
            and existing.get("output_grid_degrees") == resolution
            and existing.get("qa_threshold") == qa_threshold
        )
        if same_configuration and not existing.get("failures"):
            print(f"[{label}] already complete; skipping")
            return {"month": label, "status": "existing", "output": str(output_path)}
        if not same_configuration:
            raise ValueError(
                f"Existing {manifest_path} was produced with a different date, bbox, "
                "grid, or QA configuration. Use a different --output-dir."
            )
        print(f"[{label}] retrying because the previous run recorded failures")

    accumulator = GridAccumulator(bbox=bbox, resolution=resolution)
    source_keys: list[str] = []
    failed: list[dict[str, str]] = []
    days_without_product: list[str] = []
    total_valid_pixels = 0

    for day in iter_days(start, end):
        try:
            keys: list[str] = []
            for product_prefix in PRODUCT_PREFIXES:
                prefix = f"{product_prefix}/{day:%Y/%m/%d}/"
                keys = list_s3_keys(prefix)
                if any(key.endswith(NO2_SUFFIX) for key in keys):
                    break
            no2_key = choose_orbit(keys, day, bbox.center_longitude)
            if no2_key is None:
                days_without_product.append(day.isoformat())
                print(f"[{day}] no OFFL NO2 product")
                continue
            longitude, latitude, no2, qa = read_orbit_window_with_retry(
                no2_key, bbox=bbox, qa_threshold=qa_threshold
            )
            added = accumulator.add(longitude, latitude, no2, qa)
            total_valid_pixels += added
            source_keys.append(no2_key)
            print(f"[{day}] {added:,} valid QA-filtered pixels")
        except Exception as error:  # Continue so a transient day does not lose a month.
            failed.append({"date": day.isoformat(), "error": str(error)})
            print(f"[{day}] ERROR {error}")

    row_count = write_month_csv(output_path, label, accumulator)
    manifest = {
        "month": label,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "source_catalog": SOURCE_CATALOG,
        "source_product": SOURCE_PRODUCT,
        "source_units": NO2_UNITS,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "bbox_wgs84": bbox.as_list(),
        "output_grid_degrees": resolution,
        "qa_threshold": qa_threshold,
        "minimum_no2_mol_m2": -0.001,
        "source_orbit_count": len(source_keys),
        "source_keys": source_keys,
        "days_without_product": days_without_product,
        "failures": failed,
        "valid_pixel_count": total_valid_pixels,
        "output_cell_count": row_count,
        "output": str(output_path),
        "scope_note": (
            "Gridded COG training fallback. It does not preserve native Level-2 "
            "pixel-corner footprint polygons required for the final footprint map."
        ),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        f"[{label}] wrote {row_count:,} cells from {total_valid_pixels:,} pixels "
        f"to {output_path}"
    )
    return {
        "month": label,
        "status": "complete",
        "output": str(output_path),
        "cells": row_count,
        "valid_pixels": total_valid_pixels,
        "failures": len(failed),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--bbox",
        type=float,
        nargs=4,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        required=True,
    )
    parser.add_argument("--grid-degrees", type=float, default=0.1)
    parser.add_argument("--qa-threshold", type=float, default=0.75)
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of months to extract concurrently (use 4 for the full Philippines run)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/raw/tropomi"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start > args.end:
        raise ValueError("--start must be on or before --end")
    bbox = BBox(*args.bbox)
    bbox.validate()
    if args.grid_degrees <= 0:
        raise ValueError("--grid-degrees must be positive")
    if not (0 <= args.qa_threshold <= 100):
        raise ValueError("--qa-threshold must be between 0 and 1 or 0 and 100")
    if args.workers < 1:
        raise ValueError("--workers must be at least 1")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    months = list(iter_months(args.start, args.end))
    kwargs = {
        "requested_start": args.start,
        "requested_end": args.end,
        "bbox": bbox,
        "resolution": args.grid_degrees,
        "qa_threshold": args.qa_threshold,
        "output_dir": args.output_dir,
    }
    if args.workers == 1:
        run_summary = [
            process_month(year=year, month=month, **kwargs) for year, month in months
        ]
    else:
        run_summary = []
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(process_month, year=year, month=month, **kwargs): (
                    year,
                    month,
                )
                for year, month in months
            }
            for future in concurrent.futures.as_completed(futures):
                run_summary.append(future.result())
        run_summary.sort(key=lambda item: item["month"])

    summary_path = args.output_dir / "tropomi_extraction_summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "created_utc": datetime.now(timezone.utc).isoformat(),
                "source_catalog": SOURCE_CATALOG,
                "bbox_wgs84": bbox.as_list(),
                "start": args.start.isoformat(),
                "end": args.end.isoformat(),
                "grid_degrees": args.grid_degrees,
                "qa_threshold": args.qa_threshold,
                "workers": args.workers,
                "months": run_summary,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    combined_path = combine_monthly_csvs(args.output_dir, args.start, args.end)
    checksum_path = write_sha256sums(args.output_dir, combined_path)
    print(f"Extraction summary: {summary_path}")
    print(f"Combined training table: {combined_path}")
    print(f"SHA-256 manifest: {checksum_path}")


if __name__ == "__main__":
    main()
