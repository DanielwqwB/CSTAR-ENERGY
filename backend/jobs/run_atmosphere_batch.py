"""Rebuild, validate, and optionally publish one TROPOMI atmosphere batch."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.jobs.import_atmosphere import (
    DEFAULT_EXPORT,
    SupabaseImporter,
    publish_export,
    validate_export,
)
from modules.atmosphere.export_tropomi import export_tropomi


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = (
    ROOT / "data" / "raw" / "tropomi" / "tropomi_no2_2019-01-01_2025-12-31.csv.gz"
)
DEFAULT_BOUNDARY = ROOT / "data" / "raw" / "tropomi" / "philippines_adm0.geojson"
DEFAULT_CHECKPOINT = ROOT / "models" / "checkpoints" / "tropomi" / "best_model.joblib"
INPUT_MANIFEST_PATH = Path(__file__).with_name("atmosphere_input_manifest.json")
INPUTS_BUCKET = "cstar-atmosphere-inputs"


@dataclass(frozen=True)
class InputArtifact:
    local_path: Path
    object_path: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class DownloadedAtmosphereInputs:
    bucket: str
    source: InputArtifact
    boundary: InputArtifact
    checkpoint: InputArtifact


def download_verified_object(
    *,
    supabase_url: str,
    secret_key: str,
    bucket: str,
    object_path: str,
    destination: Path,
    expected_sha256: str,
    expected_size: int,
) -> None:
    """Stream a private Storage object to disk and verify its pinned digest."""

    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError(f"Invalid SHA-256 for Storage object {object_path}")
    if expected_size <= 0:
        raise ValueError(f"Invalid size for Storage object {object_path}")
    if not supabase_url.startswith("https://") or not secret_key.startswith("sb_secret_"):
        raise ValueError("Storage downloads require HTTPS and SUPABASE_SECRET_KEY")

    url = (
        supabase_url.rstrip("/")
        + "/storage/v1/object/authenticated/"
        + quote(bucket, safe="")
        + "/"
        + quote(object_path, safe="/")
    )
    request = Request(
        url,
        headers={
            "apikey": secret_key,
            "Accept": "application/octet-stream",
        },
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    received = 0
    try:
        response = urlopen(request, timeout=120)
    except HTTPError as error:
        detail = error.read(1024).decode("utf-8", errors="replace").strip()
        if secret_key in detail:
            detail = detail.replace(secret_key, "[redacted]")
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(
            f"Storage download failed for {object_path} "
            f"(HTTP {error.code}){suffix}"
        ) from None
    except URLError as error:
        raise RuntimeError(
            f"Storage download failed for {object_path}: {error.reason}"
        ) from None

    too_large = False
    with response, destination.open("wb") as stream:
        while chunk := response.read(1024 * 1024):
            received += len(chunk)
            if received > expected_size:
                too_large = True
                break
            digest.update(chunk)
            stream.write(chunk)

    if too_large or received != expected_size:
        destination.unlink(missing_ok=True)
        raise ValueError(
            f"Storage object size mismatch for {object_path}: "
            f"expected {expected_size}, received {received}"
        )
    if digest.hexdigest() != expected_sha256:
        destination.unlink(missing_ok=True)
        raise ValueError(f"Storage object SHA-256 mismatch for {object_path}")


def download_atmosphere_inputs(
    destination_dir: Path, *, supabase_url: str, secret_key: str
) -> DownloadedAtmosphereInputs:
    """Download all configured inputs and verify them before model loading."""

    config = json.loads(INPUT_MANIFEST_PATH.read_text(encoding="utf-8"))
    if (
        not isinstance(config, dict)
        or config.get("format_version") != 1
        or config.get("bucket") != INPUTS_BUCKET
    ):
        raise ValueError("Unsupported atmosphere input manifest")
    artifacts = config.get("artifacts")
    roles = {"source", "boundary", "checkpoint"}
    if not isinstance(artifacts, dict) or set(artifacts) != roles:
        raise ValueError("Atmosphere input manifest has an invalid artifact set")

    downloaded: dict[str, InputArtifact] = {}
    for role in sorted(roles):
        item = artifacts[role]
        if not isinstance(item, dict):
            raise ValueError(f"Invalid {role} entry in atmosphere input manifest")
        object_path = item.get("object_path")
        sha256 = item.get("sha256")
        size_bytes = item.get("size_bytes")
        if (
            not isinstance(object_path, str)
            or not object_path
            or object_path.startswith("/")
            or any(part in {"", ".", ".."} for part in object_path.split("/"))
            or not isinstance(sha256, str)
            or not isinstance(size_bytes, int)
            or isinstance(size_bytes, bool)
        ):
            raise ValueError(f"Invalid {role} entry in atmosphere input manifest")
        local_path = destination_dir / Path(object_path).name
        download_verified_object(
            supabase_url=supabase_url,
            secret_key=secret_key,
            bucket=INPUTS_BUCKET,
            object_path=object_path,
            destination=local_path,
            expected_sha256=sha256,
            expected_size=size_bytes,
        )
        downloaded[role] = InputArtifact(
            local_path=local_path,
            object_path=object_path,
            sha256=sha256,
            size_bytes=size_bytes,
        )

    return DownloadedAtmosphereInputs(
        bucket=INPUTS_BUCKET,
        source=downloaded["source"],
        boundary=downloaded["boundary"],
        checkpoint=downloaded["checkpoint"],
    )


def manifest_path_for(csv_path: Path) -> Path:
    """Return the export manifest path for a CSV or gzip-compressed CSV."""

    name = csv_path.name
    if name.endswith(".csv.gz"):
        stem = name[:-7]
    elif name.endswith(".csv"):
        stem = name[:-4]
    else:
        raise ValueError("Batch output must end in .csv or .csv.gz")
    return csv_path.with_name(f"{stem}.manifest.json")


def _execute_batch(
    *,
    source_path: Path = DEFAULT_SOURCE,
    boundary_path: Path = DEFAULT_BOUNDARY,
    checkpoint_path: Path = DEFAULT_CHECKPOINT,
    output_path: Path = DEFAULT_EXPORT,
    start_month: str = "2025-01",
    end_month: str = "2025-12",
    qa_threshold: float = 0.75,
    publish: bool = False,
    batch_size: int = 500,
    inputs: DownloadedAtmosphereInputs | None = None,
) -> dict[str, Any]:
    generated = export_tropomi(
        source_path=source_path,
        boundary_path=boundary_path,
        checkpoint_path=checkpoint_path,
        output_path=output_path,
        start_month=start_month,
        end_month=end_month,
        qa_threshold=qa_threshold,
    )
    manifest_path = manifest_path_for(output_path)
    if inputs:
        input_hashes = {
            "source": inputs.source.sha256,
            "boundary": inputs.boundary.sha256,
            "checkpoint": inputs.checkpoint.sha256,
        }
        for role, expected_hash in input_hashes.items():
            if generated[f"{role}_sha256"] != expected_hash:
                raise RuntimeError(f"Export input hash changed for {role}")
        generated.update(
            {
                "input_storage_bucket": inputs.bucket,
                "source_path": inputs.source.object_path,
                "boundary_path": inputs.boundary.object_path,
                "checkpoint_path": inputs.checkpoint.object_path,
            }
        )
        manifest_path.write_text(json.dumps(generated, indent=2), encoding="utf-8")
    manifest, rows = validate_export(output_path, manifest_path)
    if generated["output_sha256"] != manifest["output_sha256"]:
        raise RuntimeError("Generated and validated manifests refer to different exports")

    status = "validated"
    if publish:
        importer = SupabaseImporter(
            os.environ.get("SUPABASE_URL", ""),
            os.environ.get("SUPABASE_SECRET_KEY", ""),
        )
        status = publish_export(importer, manifest, rows, batch_size)

    return {
        "run_id": manifest["output_sha256"],
        "model_name": manifest["selected_model"],
        "validated_rows": len(rows),
        "status": status,
    }


def run_batch(
    *,
    source_path: Path = DEFAULT_SOURCE,
    boundary_path: Path = DEFAULT_BOUNDARY,
    checkpoint_path: Path = DEFAULT_CHECKPOINT,
    output_path: Path = DEFAULT_EXPORT,
    start_month: str = "2025-01",
    end_month: str = "2025-12",
    qa_threshold: float = 0.75,
    publish: bool = False,
    batch_size: int = 500,
    from_storage: bool = False,
) -> dict[str, Any]:
    """Generate and validate an export; publish only when explicitly requested."""

    if not 1 <= batch_size <= 1000:
        raise ValueError("Batch size must be between 1 and 1000")

    if from_storage:
        if (
            source_path != DEFAULT_SOURCE
            or boundary_path != DEFAULT_BOUNDARY
            or checkpoint_path != DEFAULT_CHECKPOINT
        ):
            raise ValueError(
                "--from-storage cannot be combined with --source, --boundary, or --checkpoint"
            )
        supabase_url = os.environ.get("SUPABASE_URL", "")
        secret_key = os.environ.get("SUPABASE_SECRET_KEY", "")
        with tempfile.TemporaryDirectory(prefix="cstar-atmosphere-inputs-") as temp_dir:
            inputs = download_atmosphere_inputs(
                Path(temp_dir), supabase_url=supabase_url, secret_key=secret_key
            )
            return _execute_batch(
                source_path=inputs.source.local_path,
                boundary_path=inputs.boundary.local_path,
                checkpoint_path=inputs.checkpoint.local_path,
                output_path=output_path,
                start_month=start_month,
                end_month=end_month,
                qa_threshold=qa_threshold,
                publish=publish,
                batch_size=batch_size,
                inputs=inputs,
            )

    return _execute_batch(
        source_path=source_path,
        boundary_path=boundary_path,
        checkpoint_path=checkpoint_path,
        output_path=output_path,
        start_month=start_month,
        end_month=end_month,
        qa_threshold=qa_threshold,
        publish=publish,
        batch_size=batch_size,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--boundary", type=Path, default=DEFAULT_BOUNDARY)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=Path, default=DEFAULT_EXPORT)
    parser.add_argument("--start-month", default="2025-01")
    parser.add_argument("--end-month", default="2025-12")
    parser.add_argument("--qa-threshold", type=float, default=0.75)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish the validated, content-addressed run to Supabase",
    )
    parser.add_argument(
        "--from-storage",
        action="store_true",
        help="Download and hash-check private inputs from Supabase Storage",
    )
    args = parser.parse_args()

    try:
        result = run_batch(
            source_path=args.source,
            boundary_path=args.boundary,
            checkpoint_path=args.checkpoint,
            output_path=args.output,
            start_month=args.start_month,
            end_month=args.end_month,
            qa_threshold=args.qa_threshold,
            publish=args.publish,
            batch_size=args.batch_size,
            from_storage=args.from_storage,
        )
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Atmosphere batch: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
