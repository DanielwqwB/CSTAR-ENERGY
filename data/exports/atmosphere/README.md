# Atmospheric integration export

Run `python -m modules.atmosphere.export_tropomi` from the repository root to
rebuild `tropomi_no2_anomalies_2025.csv.gz` and its adjacent JSON manifest from
the local TROPOMI source table, Philippines boundary, and selected checkpoint.
The default export covers January-December 2025. The manifest records input
hashes, quality thresholds, selected model, row counts, and the output hash.

Each row is one Philippines grid cell and calendar month. `month` and `cell_id`
identify the row; `latitude` and `longitude` are cell centers. The export also
contains `qa_mean`, `valid_orbit_count`, `valid_pixel_count`,
`coverage_fraction`, `source_product`, and `observation_status`. The status is
one of `valid`, `low_coverage`, `low_qa`, `missing_no2`, or `no_observation`.

`expected_no2_umol_m2` is a model prediction for every cell-month. The
`observed_no2_umol_m2`, `anomaly_umol_m2`, and `significant_anomaly` fields are
blank unless the source has a valid NO2 value, mean QA at least 0.75, at least
the checkpoint's minimum valid-orbit count, and at least one valid pixel.
`anomaly_umol_m2` is observed minus expected NO2. The interval columns are
the checkpoint's calibrated bounds; significance means the observed value lies
outside those bounds. A blank significance field means no valid observation or
no calibrated interval, not a non-significant event.

The current checkpoint selects the spatial-seasonal climatology, so the
`anomaly_interpretation` is `climatology residual`. These rows are atmospheric
signals for integration, not verified emissions, ground-level NO2, or CCTF
event labels. The 2025 period was previously examined during model work and is
not a never-seen blind test. No simulated Black Marble values enter this export.

## Prediction input contract

`modules.atmosphere.inference.predict_tropomi()` accepts a non-empty table with
non-null, parseable `month` and non-empty `cell_id` values. Each `(month,
cell_id)` pair must be unique. For the currently selected
`spatial_seasonal_climatology` checkpoint, those identity columns are the only
prediction inputs. Expected NO2 uses the saved lookup fallback order:
cell-month mean, cell mean, month-of-year mean, then global mean. It does not
use same-month observations or weather values to produce the expected value.

Observed NO2 is optional and is only used to calculate the residual and
significance. Provide at most one of `observed_no2_umol_m2` or
`tropospheric_no2_mean_mol_m2`; the latter is converted to umol/m2. Missing
observations remain missing. The export path additionally requires a source
table with `month` (YYYY-MM), `cell_id`, `longitude`, `latitude`,
`tropospheric_no2_mean_mol_m2`, `tropospheric_no2_std_mol_m2`, `qa_mean`,
`valid_pixel_count`, `valid_orbit_count`, and `source_product`, plus the
Philippines boundary GeoJSON and checkpoint. It masks observations unless QA
is at least 0.75, valid orbit count meets the checkpoint minimum, and at least
one valid pixel is present; the boundary hash must match the checkpoint.

Weather-adjusted checkpoints are not selected and cannot be substituted by
the current export command. They require a passing saved acceptance gate and
the exact feature columns recorded by the checkpoint, prepared for the
prediction period. The current weather acceptance gate did not pass because
the candidate failed to beat climatology on the 2024 selection period.

Inference imports `joblib`, NumPy, and pandas; the current checkpoint also
serializes a scikit-learn candidate estimator, so a compatible scikit-learn
runtime is needed to load it. Rebuilding the boundary-masked export also uses
Rasterio. `requirements-ml.txt` lists the research dependencies but only gives
minimum versions, not a reproducible lock. The current backend is Node-only
and publishes/serves the versioned CSV; it does not run Python inference.
Checkpoints are trusted `joblib` artifacts, not user-uploaded inputs.
