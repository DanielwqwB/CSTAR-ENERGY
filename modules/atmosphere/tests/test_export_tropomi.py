"""The integration export must preserve missing and rejected NO2 observations."""

import hashlib
import json

import joblib
import numpy as np
import pandas as pd

from modules.atmosphere.export_tropomi import export_tropomi


def test_export_keeps_complete_ph_panel_and_only_valid_anomalies(tmp_path) -> None:
    boundary = tmp_path / "philippines.geojson"
    boundary.write_text(
        json.dumps(
            {
                "type": "Polygon",
                "coordinates": [[[120, 14], [121, 14], [121, 15], [120, 15], [120, 14]]],
            }
        ),
        encoding="utf-8",
    )
    source = tmp_path / "tropomi.csv"
    rows = [
        ("2019-01", "a", 120.05, 14.05, 10e-6, 0.9, 10, 5),
        ("2019-01", "b", 120.15, 14.05, 20e-6, 0.9, 10, 5),
        ("2025-01", "a", 120.05, 14.05, 11e-6, 0.9, 10, 5),
        ("2025-02", "a", 120.05, 14.05, 12e-6, 0.9, 4, 2),
        ("2025-02", "b", 120.15, 14.05, 21e-6, 0.7, 12, 6),
        ("2025-01", "outside", 122.05, 14.05, 99e-6, 0.9, 10, 5),
    ]
    frame = pd.DataFrame(
        rows,
        columns=[
            "month",
            "cell_id",
            "longitude",
            "latitude",
            "tropospheric_no2_mean_mol_m2",
            "qa_mean",
            "valid_pixel_count",
            "valid_orbit_count",
        ],
    )
    frame["tropospheric_no2_std_mol_m2"] = 0.0
    frame["source_product"] = "test"
    frame.to_csv(source, index=False)

    checkpoint = tmp_path / "checkpoint.joblib"
    joblib.dump(
        {
            "model_name": "spatial_seasonal_climatology",
            "model": None,
            "minimum_valid_orbits": 5,
            "boundary_sha256": hashlib.sha256(boundary.read_bytes()).hexdigest(),
            "interval_radius_umol_m2": 2.0,
            "climatology": {
                "cell_month_mean": {("a", 1): 10.0, ("b", 2): 20.0},
                "cell_mean": {"a": 10.0, "b": 20.0},
                "seasonal_mean": {1: 15.0, 2: 15.0},
                "global_mean": 15.0,
            },
        },
        checkpoint,
    )
    output = tmp_path / "anomalies.csv.gz"
    manifest = export_tropomi(
        source, boundary, checkpoint, output, "2025-01", "2025-02"
    )
    exported = pd.read_csv(output).set_index(["month", "cell_id"])

    assert len(exported) == 4
    assert set(exported.index.get_level_values("cell_id")) == {"a", "b"}
    assert manifest["valid_observations"] == 1
    assert manifest["observation_status_counts"] == {
        "valid": 1,
        "no_observation": 1,
        "low_coverage": 1,
        "low_qa": 1,
    }
    valid = exported.loc[("2025-01", "a")]
    assert np.isclose(valid["expected_no2_umol_m2"], 10.0)
    assert np.isclose(valid["observed_no2_umol_m2"], 11.0)
    assert np.isclose(valid["anomaly_umol_m2"], 1.0)
    for key in (("2025-01", "b"), ("2025-02", "a"), ("2025-02", "b")):
        assert np.isnan(exported.loc[key, "observed_no2_umol_m2"])
        assert np.isnan(exported.loc[key, "anomaly_umol_m2"])
        assert pd.isna(exported.loc[key, "significant_anomaly"])
    assert (tmp_path / "anomalies.manifest.json").is_file()
    rerun = export_tropomi(source, boundary, checkpoint, output, "2025-01", "2025-02")
    assert rerun["output_sha256"] == manifest["output_sha256"]
