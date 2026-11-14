from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

from backend.jobs import run_atmosphere_batch as batch


MANIFEST = {
    "output_sha256": "a" * 64,
    "source_sha256": "1" * 64,
    "boundary_sha256": "2" * 64,
    "checkpoint_sha256": "3" * 64,
    "selected_model": "spatial_seasonal_climatology",
}
ROWS = [{"cell_id": "sample"}]


def stub_pipeline(monkeypatch, calls: list[tuple], tmp_path: Path) -> Path:
    output_path = tmp_path / "sample.csv.gz"

    def export_tropomi(**kwargs):
        calls.append(("export", kwargs))
        return MANIFEST

    def validate_export(csv_path, manifest_path):
        calls.append(("validate", csv_path, manifest_path))
        return MANIFEST, ROWS

    monkeypatch.setattr(batch, "export_tropomi", export_tropomi)
    monkeypatch.setattr(batch, "validate_export", validate_export)
    return output_path


def configure_storage_manifest(
    monkeypatch, tmp_path: Path, payloads: dict[str, bytes], wrong_hash: str | None = None
) -> dict[str, str]:
    object_paths = {
        "source": "data/source.csv.gz",
        "boundary": "data/boundary.geojson",
        "checkpoint": "models/checkpoint.joblib",
    }
    artifacts = {}
    for role, object_path in object_paths.items():
        payload = payloads[object_path]
        digest = hashlib.sha256(payload).hexdigest()
        artifacts[role] = {
            "object_path": object_path,
            "sha256": "0" * 64 if role == wrong_hash else digest,
            "size_bytes": len(payload),
        }
    manifest_path = tmp_path / "input-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "format_version": 1,
                "bucket": batch.INPUTS_BUCKET,
                "artifacts": artifacts,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(batch, "INPUT_MANIFEST_PATH", manifest_path)
    return object_paths


def test_batch_validates_without_publishing_by_default(monkeypatch, tmp_path: Path) -> None:
    calls: list[tuple] = []
    output_path = stub_pipeline(monkeypatch, calls, tmp_path)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setattr(
        batch,
        "SupabaseImporter",
        lambda *_: pytest.fail("dry-run must not create a Supabase importer"),
    )

    result = batch.run_batch(output_path=output_path)

    assert result == {
        "run_id": "a" * 64,
        "model_name": "spatial_seasonal_climatology",
        "validated_rows": 1,
        "status": "validated",
    }
    assert [call[0] for call in calls] == ["export", "validate"]
    assert calls[1][2] == tmp_path / "sample.manifest.json"


def test_batch_publishes_only_after_validation_when_requested(
    monkeypatch, tmp_path: Path
) -> None:
    calls: list[tuple] = []
    output_path = stub_pipeline(monkeypatch, calls, tmp_path)
    importer = object()
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    monkeypatch.setattr(
        batch, "SupabaseImporter", lambda url, secret: importer
    )

    def publish_export(passed_importer, manifest, rows, batch_size):
        calls.append(("publish", passed_importer, manifest, rows, batch_size))
        return "published"

    monkeypatch.setattr(batch, "publish_export", publish_export)
    result = batch.run_batch(output_path=output_path, publish=True, batch_size=250)

    assert result["status"] == "published"
    assert [call[0] for call in calls] == ["export", "validate", "publish"]
    assert calls[-1][1:] == (importer, MANIFEST, ROWS, 250)


def test_invalid_batch_size_fails_before_running_inference(
    monkeypatch, tmp_path: Path
) -> None:
    calls: list[tuple] = []
    output_path = stub_pipeline(monkeypatch, calls, tmp_path)

    with pytest.raises(ValueError, match="between 1 and 1000"):
        batch.run_batch(output_path=output_path, batch_size=1001)

    assert calls == []


def test_storage_downloads_use_authenticated_hash_checked_objects(
    monkeypatch, tmp_path: Path
) -> None:
    payloads = {
        "data/source.csv.gz": b"source",
        "data/boundary.geojson": b"boundary",
        "models/checkpoint.joblib": b"checkpoint",
    }
    object_paths = configure_storage_manifest(monkeypatch, tmp_path, payloads)
    requests: list[str] = []

    def fake_urlopen(request, timeout):
        assert timeout == 120
        assert request.get_header("Apikey") == "sb_secret_test"
        assert request.get_header("Authorization") is None
        object_path = request.full_url.split(f"/{batch.INPUTS_BUCKET}/", 1)[1]
        requests.append(object_path)
        return io.BytesIO(payloads[object_path])

    monkeypatch.setattr(batch, "urlopen", fake_urlopen)
    inputs = batch.download_atmosphere_inputs(
        tmp_path / "downloads",
        supabase_url="https://example.supabase.co",
        secret_key="sb_secret_test",
    )

    assert set(requests) == set(object_paths.values())
    assert inputs.source.local_path.read_bytes() == payloads[object_paths["source"]]
    assert inputs.boundary.local_path.read_bytes() == payloads[object_paths["boundary"]]
    assert inputs.checkpoint.local_path.read_bytes() == payloads[object_paths["checkpoint"]]


def test_storage_checksum_mismatch_stops_before_inference(
    monkeypatch, tmp_path: Path
) -> None:
    payloads = {
        "data/source.csv.gz": b"bad",
        "data/boundary.geojson": b"boundary",
        "models/checkpoint.joblib": b"checkpoint",
    }
    configure_storage_manifest(monkeypatch, tmp_path, payloads, wrong_hash="source")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")

    def fake_urlopen(request, timeout):
        object_path = request.full_url.split(f"/{batch.INPUTS_BUCKET}/", 1)[1]
        return io.BytesIO(payloads[object_path])

    monkeypatch.setattr(batch, "urlopen", fake_urlopen)
    monkeypatch.setattr(
        batch,
        "export_tropomi",
        lambda **_: pytest.fail("inference must not run after a checksum mismatch"),
    )

    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        batch.run_batch(output_path=tmp_path / "result.csv.gz", from_storage=True)


def test_storage_http_errors_include_safe_response_detail(
    monkeypatch, tmp_path: Path
) -> None:
    secret = "sb_secret_test"

    def fake_urlopen(request, timeout):
        raise HTTPError(
            request.full_url,
            400,
            "Bad Request",
            hdrs=None,
            fp=io.BytesIO(
                f'{{"message":"invalid object metadata","echo":"{secret}"}}'.encode()
            ),
        )

    monkeypatch.setattr(batch, "urlopen", fake_urlopen)

    with pytest.raises(RuntimeError, match="invalid object metadata") as error:
        batch.download_verified_object(
            supabase_url="https://example.supabase.co",
            secret_key=secret,
            bucket=batch.INPUTS_BUCKET,
            object_path="models/checkpoints/tropomi/best_model.joblib",
            destination=tmp_path / "checkpoint.joblib",
            expected_sha256="a" * 64,
            expected_size=1,
        )

    assert secret not in str(error.value)
    assert "[redacted]" in str(error.value)


def test_storage_batch_preserves_object_provenance_in_output_manifest(
    monkeypatch, tmp_path: Path
) -> None:
    payloads = {
        "data/source.csv.gz": b"source",
        "data/boundary.geojson": b"boundary",
        "models/checkpoint.joblib": b"checkpoint",
    }
    object_paths = {
        "source": "data/source.csv.gz",
        "boundary": "data/boundary.geojson",
        "checkpoint": "models/checkpoint.joblib",
    }
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")

    def fake_download(destination_dir, *, supabase_url, secret_key):
        assert supabase_url == "https://example.supabase.co"
        assert secret_key == "sb_secret_test"
        assets = {}
        for role, object_path in object_paths.items():
            path = destination_dir / Path(object_path).name
            payload = payloads[object_path]
            path.write_bytes(payload)
            assets[role] = batch.InputArtifact(
                local_path=path,
                object_path=object_path,
                sha256=hashlib.sha256(payload).hexdigest(),
                size_bytes=len(payload),
            )
        return batch.DownloadedAtmosphereInputs(
            bucket=batch.INPUTS_BUCKET,
            source=assets["source"],
            boundary=assets["boundary"],
            checkpoint=assets["checkpoint"],
        )

    monkeypatch.setattr(batch, "download_atmosphere_inputs", fake_download)
    generated = {
        **MANIFEST,
        "source_sha256": hashlib.sha256(payloads[object_paths["source"]]).hexdigest(),
        "boundary_sha256": hashlib.sha256(payloads[object_paths["boundary"]]).hexdigest(),
        "checkpoint_sha256": hashlib.sha256(
            payloads[object_paths["checkpoint"]]
        ).hexdigest(),
    }

    def export_tropomi(**kwargs):
        assert Path(kwargs["source_path"]).exists()
        assert Path(kwargs["boundary_path"]).exists()
        assert Path(kwargs["checkpoint_path"]).exists()
        return generated

    def validate_export(csv_path, manifest_path):
        return json.loads(manifest_path.read_text(encoding="utf-8")), ROWS

    monkeypatch.setattr(batch, "export_tropomi", export_tropomi)
    monkeypatch.setattr(batch, "validate_export", validate_export)
    output_path = tmp_path / "storage-result.csv.gz"

    result = batch.run_batch(output_path=output_path, from_storage=True)
    manifest = json.loads(
        (tmp_path / "storage-result.manifest.json").read_text(encoding="utf-8")
    )

    assert result["status"] == "validated"
    assert manifest["input_storage_bucket"] == batch.INPUTS_BUCKET
    assert manifest["source_path"] == object_paths["source"]
    assert manifest["boundary_path"] == object_paths["boundary"]
    assert manifest["checkpoint_path"] == object_paths["checkpoint"]
