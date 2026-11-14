"""Validate and optionally publish a versioned TROPOMI export to Supabase.

Validation works offline. Publishing uses SUPABASE_URL and a server-only
SUPABASE_SECRET_KEY from the process environment; never pass the key as a CLI
argument or place it in the web server's .env file.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT = ROOT / "data/exports/atmosphere/tropomi_no2_anomalies_2025.csv.gz"
STATUSES = {"valid", "low_coverage", "low_qa", "missing_no2", "no_observation"}
REQUIRED_COLUMNS = {
    "month", "cell_id", "latitude", "longitude", "observation_status",
    "qa_mean", "valid_orbit_count", "valid_pixel_count", "coverage_fraction",
    "source_product", "model_name", "expected_no2_umol_m2",
    "observed_no2_umol_m2", "anomaly_umol_m2", "interval_lower_umol_m2",
    "interval_upper_umol_m2", "significant_anomaly", "anomaly_interpretation",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _number(value: str, field: str, *, required: bool = False) -> float | None:
    if value == "":
        if required:
            raise ValueError(f"{field} cannot be blank")
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite")
    return result


def _integer(value: str, field: str) -> int:
    if not re.fullmatch(r"\d+", value):
        raise ValueError(f"{field} must be a nonnegative integer")
    return int(value)


def _boolean(value: str) -> bool | None:
    if value == "":
        return None
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValueError("significant_anomaly must be true, false, or blank")


def _record(raw: dict[str, str], manifest: dict[str, Any]) -> dict[str, Any]:
    month = raw["month"]
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError(f"Invalid month {month!r}")
    if not manifest["start_month"] <= month <= manifest["end_month"]:
        raise ValueError(f"Month {month} is outside the manifest period")
    if not raw["cell_id"] or raw["observation_status"] not in STATUSES:
        raise ValueError("Invalid cell ID or observation status")
    if raw["model_name"] != manifest["selected_model"] or raw[
        "anomaly_interpretation"
    ] != manifest["anomaly_interpretation"]:
        raise ValueError("Model or anomaly label differs from the manifest")
    latitude = _number(raw["latitude"], "latitude", required=True)
    longitude = _number(raw["longitude"], "longitude", required=True)
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Invalid cell coordinates")
    coverage = _number(raw["coverage_fraction"], "coverage_fraction", required=True)
    if not 0 <= coverage <= 1:
        raise ValueError("Coverage fraction must be between 0 and 1")
    qa = _number(raw["qa_mean"], "qa_mean")
    orbit_count = _integer(raw["valid_orbit_count"], "valid_orbit_count")
    pixel_count = _integer(raw["valid_pixel_count"], "valid_pixel_count")
    expected = _number(raw["expected_no2_umol_m2"], "expected_no2_umol_m2", required=True)
    observed = _number(raw["observed_no2_umol_m2"], "observed_no2_umol_m2")
    anomaly = _number(raw["anomaly_umol_m2"], "anomaly_umol_m2")
    lower = _number(raw["interval_lower_umol_m2"], "interval_lower_umol_m2")
    upper = _number(raw["interval_upper_umol_m2"], "interval_upper_umol_m2")
    significant = _boolean(raw["significant_anomaly"])
    if (lower is None) != (upper is None) or (lower is not None and lower > upper):
        raise ValueError("Invalid prediction interval")
    if raw["observation_status"] == "valid":
        if observed is None or anomaly is None:
            raise ValueError("Valid rows require observed NO2 and anomaly")
        if qa is None or qa < manifest["qa_threshold"] or orbit_count < manifest["minimum_valid_orbits"] or pixel_count < 1:
            raise ValueError("Valid row does not meet the manifest quality rules")
        if not math.isclose(anomaly, observed - expected, abs_tol=1e-4):
            raise ValueError("Anomaly does not equal observed minus expected NO2")
        if lower is not None and significant is not (observed < lower or observed > upper):
            raise ValueError("Significance flag differs from the prediction interval")
        if lower is None and significant is not None:
            raise ValueError("Significance requires a prediction interval")
    elif observed is not None or anomaly is not None or significant is not None:
        raise ValueError("Rejected or missing observations cannot have an anomaly")
    return {
        "run_id": manifest["output_sha256"],
        "month": f"{month}-01",
        "cell_id": raw["cell_id"],
        "latitude": latitude,
        "longitude": longitude,
        "observation_status": raw["observation_status"],
        "qa_mean": qa,
        "valid_orbit_count": orbit_count,
        "valid_pixel_count": pixel_count,
        "coverage_fraction": coverage,
        "source_product": raw["source_product"] or None,
        "expected_no2_umol_m2": expected,
        "observed_no2_umol_m2": observed,
        "anomaly_umol_m2": anomaly,
        "interval_lower_umol_m2": lower,
        "interval_upper_umol_m2": upper,
        "significant_anomaly": significant,
    }


def validate_export(csv_path: Path, manifest_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Verify file integrity, schema, counts, model labels, and null handling."""

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1 or not re.fullmatch(
        r"[0-9a-f]{64}", str(manifest.get("output_sha256", ""))
    ):
        raise ValueError("Unsupported or malformed export manifest")
    if _sha256(csv_path) != manifest["output_sha256"]:
        raise ValueError("Export SHA-256 differs from the manifest")
    if manifest.get("anomaly_interpretation") not in {
        "climatology residual", "weather-adjusted residual"
    }:
        raise ValueError("Unsupported anomaly interpretation")
    if (
        manifest["anomaly_interpretation"] == "weather-adjusted residual"
        and manifest.get("acceptance_gate_passed") is not True
    ):
        raise ValueError("Weather-adjusted export lacks a passing model gate")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", manifest["start_month"]) or not re.fullmatch(
        r"\d{4}-(0[1-9]|1[0-2])", manifest["end_month"]
    ) or manifest["start_month"] > manifest["end_month"]:
        raise ValueError("Invalid manifest period")

    opener = gzip.open if csv_path.name.endswith(".gz") else open
    with opener(csv_path, "rt", encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
            raise ValueError("Export CSV lacks required atmospheric columns")
        rows = [_record(raw, manifest) for raw in reader]
    if len(rows) != manifest["total_cell_months"]:
        raise ValueError("Export row count differs from the manifest")
    keys = {(row["month"], row["cell_id"]) for row in rows}
    if len(keys) != len(rows):
        raise ValueError("Duplicate month and cell ID in export")
    statuses = Counter(row["observation_status"] for row in rows)
    if dict(statuses) != manifest["observation_status_counts"]:
        raise ValueError("Observation-status counts differ from the manifest")
    if statuses["valid"] != manifest["valid_observations"]:
        raise ValueError("Valid-observation count differs from the manifest")
    if sum(row["significant_anomaly"] is True for row in rows) != manifest["significant_anomalies"]:
        raise ValueError("Significant-anomaly count differs from the manifest")
    if len({row["cell_id"] for row in rows}) != manifest["philippines_cells"]:
        raise ValueError("Cell count differs from the manifest")
    start = datetime.fromisoformat(manifest["start_month"] + "-01")
    end = datetime.fromisoformat(manifest["end_month"] + "-01")
    month_count = 12 * (end.year - start.year) + end.month - start.month + 1
    expected_cells = {row["cell_id"] for row in rows}
    if len(rows) != month_count * len(expected_cells):
        raise ValueError("Export is not a complete month-by-cell panel")
    cells_by_month: dict[str, set[str]] = {}
    for row in rows:
        cells_by_month.setdefault(row["month"], set()).add(row["cell_id"])
    if len(cells_by_month) != month_count or any(
        cells != expected_cells for cells in cells_by_month.values()
    ):
        raise ValueError("Export months have different Philippines cell coverage")
    return manifest, rows


class SupabaseImporter:
    """Minimal PostgREST writer using a secret key only in the apikey header."""

    def __init__(self, url: str, secret: str):
        if not url.startswith("https://") or not secret.startswith("sb_secret_"):
            raise ValueError("Publishing requires an HTTPS Supabase URL and SUPABASE_SECRET_KEY")
        self.base = url.rstrip("/") + "/rest/v1/"
        self.secret = secret

    def request(
        self, method: str, path: str, body: Any = None, *, prefer: str = "", extra: dict[str, str] | None = None
    ) -> tuple[Any, Any]:
        headers = {"apikey": self.secret, "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        if extra:
            headers.update(extra)
        payload = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base + path, data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=60) as response:
                content = response.read()
                return (json.loads(content) if content else None), response.headers
        except HTTPError as error:
            detail = error.read(400).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase import failed with HTTP {error.code}: {detail}") from error
        except URLError as error:
            raise RuntimeError(f"Supabase import connection failed: {error.reason}") from error


def publish_export(importer: SupabaseImporter, manifest: dict[str, Any], rows: list[dict[str, Any]], batch_size: int) -> str:
    """Upsert all rows into staging, verify count, then publish the run."""

    run_id = manifest["output_sha256"]
    existing, _ = importer.request(
        "GET", f"cstar_atmosphere_runs?select=run_id,status&run_id=eq.{run_id}"
    )
    if existing and existing[0]["status"] == "published":
        return "already_published"
    run = {
        "run_id": run_id,
        "manifest": manifest,
        "model_name": manifest["selected_model"],
        "anomaly_interpretation": manifest["anomaly_interpretation"],
        "start_month": manifest["start_month"] + "-01",
        "end_month": manifest["end_month"] + "-01",
        "total_cell_months": manifest["total_cell_months"],
        "status": "staging",
    }
    importer.request(
        "POST", "cstar_atmosphere_runs?on_conflict=run_id", run,
        prefer="resolution=merge-duplicates,return=minimal"
    )
    for start in range(0, len(rows), batch_size):
        importer.request(
            "POST", "cstar_atmosphere_cells?on_conflict=run_id,month,cell_id",
            rows[start:start + batch_size],
            prefer="resolution=merge-duplicates,return=minimal"
        )
        print(f"Imported {min(start + batch_size, len(rows)):,}/{len(rows):,} rows", flush=True)
    _, headers = importer.request(
        "GET", f"cstar_atmosphere_cells?select=run_id&run_id=eq.{run_id}",
        prefer="count=exact", extra={"Range": "0-0"}
    )
    content_range = headers.get("Content-Range", "")
    try:
        actual_count = int(content_range.rsplit("/", 1)[1])
    except (IndexError, ValueError) as error:
        raise RuntimeError("Supabase did not return an exact imported-row count") from error
    if actual_count != len(rows):
        raise RuntimeError(f"Staging has {actual_count} rows; expected {len(rows)}")
    published, _ = importer.request(
        "PATCH", f"cstar_atmosphere_runs?run_id=eq.{run_id}&status=eq.staging",
        {"status": "published", "published_at": datetime.now(timezone.utc).isoformat()},
        prefer="return=representation"
    )
    if not published or len(published) != 1:
        raise RuntimeError("Supabase did not confirm publication")
    return "published"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_EXPORT)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--publish", action="store_true", help="Write to Supabase after validation")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 1000:
        parser.error("batch size must be between 1 and 1000")
    stem = args.csv.name.removesuffix(".gz").removesuffix(".csv")
    manifest_path = args.manifest or args.csv.with_name(stem + ".manifest.json")
    manifest, rows = validate_export(args.csv, manifest_path)
    print(json.dumps({"validated_rows": len(rows), "run_id": manifest["output_sha256"]}, indent=2))
    if not args.publish:
        return
    importer = SupabaseImporter(
        os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", "")
    )
    print(publish_export(importer, manifest, rows, args.batch_size))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(f"Atmosphere import: {error}", file=sys.stderr)
        raise SystemExit(1) from None
