"""Export selected monthly TROPOMI anomalies for downstream integration.

The exporter keeps a row for every Philippine cell and requested month. It
leaves observed NO2 and anomaly fields empty when the satellite observation is
missing or fails the quality rules. The current checkpoint selects climatology;
weather candidates are never substituted for that selected model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from modules.atmosphere.inference import (
    BASELINE,
    ROOT,
    load_tropomi_checkpoint,
    predict_tropomi,
)
from pipeline.harmonization.tropomi_features import (
    apply_boundary_mask,
    load_tropomi_table,
)


def _month(value: str) -> pd.Timestamp:
    """Parse an explicit YYYY-MM month without accepting an ambiguous date."""

    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
        raise ValueError(f"Expected YYYY-MM month, received {value!r}")
    return pd.Timestamp(f"{value}-01", tz="UTC")


def _sha256(path: Path) -> str:
    """Hash one local input or output for export provenance."""

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_location(path: Path) -> str:
    """Use repository-relative paths when an artifact is inside this checkout."""

    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT).as_posix()
    except ValueError:
        return str(resolved)


def _manifest_path(output: Path) -> Path:
    """Place a JSON manifest beside the compressed or plain CSV."""

    name = output.name
    if name.endswith(".csv.gz"):
        stem = name[:-7]
    elif name.endswith(".csv"):
        stem = name[:-4]
    else:
        raise ValueError("Export output must end in .csv or .csv.gz")
    return output.with_name(f"{stem}.manifest.json")


def _panel(
    source: pd.DataFrame,
    boundary_path: Path,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    """Build a complete cell-month panel inside the selected PH boundary."""

    inside = apply_boundary_mask(source, boundary_path).copy()
    if inside.empty:
        raise ValueError("No TROPOMI cells fall inside the supplied boundary")
    inside["cell_id"] = inside["cell_id"].astype(str)
    coordinate_counts = inside.groupby("cell_id", observed=True)[
        ["latitude", "longitude"]
    ].nunique()
    if coordinate_counts.gt(1).any().any():
        raise ValueError("One TROPOMI cell_id has multiple coordinates")
    locations = (
        inside[["cell_id", "latitude", "longitude"]]
        .drop_duplicates("cell_id")
        .sort_values("cell_id")
        .reset_index(drop=True)
    )
    months = pd.date_range(start, end, freq="MS", tz="UTC")
    panel = pd.MultiIndex.from_product(
        [months, locations["cell_id"]], names=["month", "cell_id"]
    ).to_frame(index=False)
    panel = panel.merge(locations, on="cell_id", how="left", validate="many_to_one")
    selected = inside.loc[inside["month"].between(start, end), [
        "month",
        "cell_id",
        "tropospheric_no2_mean_mol_m2",
        "qa_mean",
        "valid_orbit_count",
        "valid_pixel_count",
        "source_product",
    ]]
    panel = panel.merge(
        selected,
        on=["month", "cell_id"],
        how="left",
        validate="one_to_one",
        indicator=True,
    )
    panel["valid_orbit_count"] = panel["valid_orbit_count"].fillna(0).astype("int16")
    panel["valid_pixel_count"] = panel["valid_pixel_count"].fillna(0).astype("int32")
    return panel.sort_values(["month", "cell_id"]).reset_index(drop=True)


def export_tropomi(
    source_path: str | Path,
    boundary_path: str | Path,
    checkpoint_path: str | Path,
    output_path: str | Path,
    start_month: str = "2025-01",
    end_month: str = "2025-12",
    qa_threshold: float = 0.75,
) -> dict[str, Any]:
    """Write a complete, quality-marked atmospheric export and manifest."""

    source_path = Path(source_path)
    boundary_path = Path(boundary_path)
    checkpoint_path = Path(checkpoint_path)
    output_path = Path(output_path)
    manifest_path = _manifest_path(output_path)
    start, end = _month(start_month), _month(end_month)
    if start > end:
        raise ValueError("Start month must be on or before end month")
    if not 0.75 <= qa_threshold <= 1:
        raise ValueError("QA threshold must be between 0.75 and 1")

    checkpoint = load_tropomi_checkpoint(checkpoint_path)
    if checkpoint["model_name"] != BASELINE:
        raise ValueError(
            "Raw TROPOMI export currently supports the selected climatology; "
            "a selected weather model needs harmonized MERRA and spatial features"
        )
    expected_boundary_hash = checkpoint.get("boundary_sha256")
    boundary_hash = _sha256(boundary_path)
    if not expected_boundary_hash or boundary_hash != expected_boundary_hash:
        raise ValueError("Export boundary differs from the checkpoint boundary")
    minimum_valid_orbits = int(checkpoint["minimum_valid_orbits"])
    if minimum_valid_orbits < 1:
        raise ValueError("Checkpoint minimum_valid_orbits must be positive")

    source = load_tropomi_table(source_path)
    panel = _panel(source, boundary_path, start, end)
    has_source_row = panel["_merge"].eq("both")
    has_no2 = panel["tropospheric_no2_mean_mol_m2"].notna()
    qa_ok = panel["qa_mean"].ge(qa_threshold)
    coverage_ok = panel["valid_orbit_count"].ge(minimum_valid_orbits) & panel[
        "valid_pixel_count"
    ].gt(0)
    valid = has_source_row & has_no2 & qa_ok & coverage_ok
    panel["observation_status"] = np.select(
        [
            ~has_source_row,
            ~has_no2,
            ~qa_ok,
            ~coverage_ok,
        ],
        ["no_observation", "missing_no2", "low_qa", "low_coverage"],
        default="valid",
    )
    panel["coverage_fraction"] = (
        panel["valid_orbit_count"] / panel["month"].dt.days_in_month
    ).clip(0, 1)
    observed = (panel["tropospheric_no2_mean_mol_m2"] * 1_000_000).where(valid)
    inference_input = panel[["month", "cell_id"]].copy()
    inference_input["observed_no2_umol_m2"] = observed
    predictions = predict_tropomi(inference_input, checkpoint)

    export = panel[[
        "month",
        "cell_id",
        "latitude",
        "longitude",
        "observation_status",
        "qa_mean",
        "valid_orbit_count",
        "valid_pixel_count",
        "coverage_fraction",
        "source_product",
    ]].copy()
    export["month"] = export["month"].dt.strftime("%Y-%m")
    for column in (
        "model_name",
        "expected_no2_umol_m2",
        "observed_no2_umol_m2",
        "anomaly_umol_m2",
        "interval_lower_umol_m2",
        "interval_upper_umol_m2",
        "significant_anomaly",
        "anomaly_interpretation",
    ):
        export[column] = predictions[column]
    if not valid.any():
        raise ValueError("No valid TROPOMI observations in the requested months")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    compression = {"method": "gzip", "mtime": 0} if output_path.name.endswith(".gz") else None
    export.to_csv(output_path, index=False, compression=compression)
    manifest: dict[str, Any] = {
        "format_version": 1,
        "task": "Philippines monthly TROPOMI expected NO2 and residual anomalies",
        "source_path": _manifest_location(source_path),
        "source_sha256": _sha256(source_path),
        "boundary_path": _manifest_location(boundary_path),
        "boundary_sha256": boundary_hash,
        "checkpoint_path": _manifest_location(checkpoint_path),
        "checkpoint_sha256": _sha256(checkpoint_path),
        "output_path": _manifest_location(output_path),
        "output_sha256": _sha256(output_path),
        "start_month": start_month,
        "end_month": end_month,
        "qa_threshold": qa_threshold,
        "minimum_valid_orbits": minimum_valid_orbits,
        "selected_model": checkpoint["model_name"],
        "anomaly_interpretation": "climatology residual",
        "total_cell_months": len(export),
        "philippines_cells": int(export["cell_id"].nunique()),
        "valid_observations": int(valid.sum()),
        "observation_status_counts": {
            str(name): int(count)
            for name, count in export["observation_status"].value_counts().items()
        },
        "significant_anomalies": int(
            export["significant_anomaly"].fillna(False).sum()
        ),
        "note": (
            "Only quality-valid observed NO2 values produce anomalies. Missing and "
            "rejected observations remain blank, while expected NO2 is model output."
        ),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    """Run the local 2025 export with optional explicit paths and months."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT / "data" / "raw" / "tropomi" / "tropomi_no2_2019-01-01_2025-12-31.csv.gz",
    )
    parser.add_argument(
        "--boundary",
        type=Path,
        default=ROOT / "data" / "raw" / "tropomi" / "philippines_adm0.geojson",
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=ROOT / "models" / "checkpoints" / "tropomi" / "best_model.joblib",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "data" / "exports" / "atmosphere" / "tropomi_no2_anomalies_2025.csv.gz",
    )
    parser.add_argument("--start-month", default="2025-01")
    parser.add_argument("--end-month", default="2025-12")
    parser.add_argument("--qa-threshold", type=float, default=0.75)
    args = parser.parse_args()
    print(
        json.dumps(
            export_tropomi(
                args.source,
                args.boundary,
                args.checkpoint,
                args.output,
                args.start_month,
                args.end_month,
                args.qa_threshold,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
