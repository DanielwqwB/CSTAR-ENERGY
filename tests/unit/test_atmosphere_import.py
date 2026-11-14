"""Offline import checks for scientific integrity and staged publication."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pytest

from backend.jobs.import_atmosphere import (
    REQUIRED_COLUMNS,
    publish_export,
    validate_export,
)


def sample(tmp_path: Path) -> tuple[Path, Path]:
    csv_path = tmp_path / "sample.csv"
    fields = sorted(REQUIRED_COLUMNS)
    row = {
        "month": "2025-01",
        "cell_id": "a",
        "latitude": "13.0",
        "longitude": "123.0",
        "observation_status": "valid",
        "qa_mean": "0.9",
        "valid_orbit_count": "7",
        "valid_pixel_count": "20",
        "coverage_fraction": "0.2",
        "source_product": "TROPOMI",
        "model_name": "spatial_seasonal_climatology",
        "expected_no2_umol_m2": "10",
        "observed_no2_umol_m2": "12",
        "anomaly_umol_m2": "2",
        "interval_lower_umol_m2": "8",
        "interval_upper_umol_m2": "11",
        "significant_anomaly": "True",
        "anomaly_interpretation": "climatology residual",
    }
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerow(row)
    manifest = {
        "format_version": 1,
        "output_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
        "start_month": "2025-01",
        "end_month": "2025-01",
        "selected_model": "spatial_seasonal_climatology",
        "anomaly_interpretation": "climatology residual",
        "total_cell_months": 1,
        "valid_observations": 1,
        "observation_status_counts": {"valid": 1},
        "significant_anomalies": 1,
        "philippines_cells": 1,
        "qa_threshold": 0.75,
        "minimum_valid_orbits": 5,
    }
    manifest_path = tmp_path / "sample.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return csv_path, manifest_path


def test_validate_export_checks_hash_and_anomaly_semantics(tmp_path: Path) -> None:
    csv_path, manifest_path = sample(tmp_path)
    manifest, rows = validate_export(csv_path, manifest_path)
    assert len(rows) == 1
    assert rows[0]["month"] == "2025-01-01"
    assert rows[0]["significant_anomaly"] is True
    csv_path.write_text(csv_path.read_text().replace("climatology residual", "wrong label"))
    with pytest.raises(ValueError, match="SHA-256"):
        validate_export(csv_path, manifest_path)
    manifest["output_sha256"] = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="label differs"):
        validate_export(csv_path, manifest_path)


class ImportFixture:
    def __init__(self, count: int):
        self.count = count
        self.calls: list[tuple[str, str]] = []

    def request(self, method, path, body=None, *, prefer="", extra=None):
        self.calls.append((method, path))
        if method == "GET" and path.startswith("cstar_atmosphere_runs"):
            return [], {}
        if method == "GET" and path.startswith("cstar_atmosphere_cells"):
            return [], {"Content-Range": f"0-0/{self.count}"}
        if method == "PATCH":
            return [{"run_id": body["status"]}], {}
        return None, {}


def test_publish_never_exposes_an_incomplete_staging_run(tmp_path: Path) -> None:
    csv_path, manifest_path = sample(tmp_path)
    manifest, rows = validate_export(csv_path, manifest_path)
    incomplete = ImportFixture(count=0)
    with pytest.raises(RuntimeError, match="Staging has 0 rows"):
        publish_export(incomplete, manifest, rows, 1)
    assert not any(method == "PATCH" for method, _ in incomplete.calls)

    complete = ImportFixture(count=1)
    assert publish_export(complete, manifest, rows, 1) == "published"
    assert any(method == "PATCH" for method, _ in complete.calls)
