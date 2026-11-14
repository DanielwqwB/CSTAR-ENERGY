# TROPOMI monthly weather experiment

Run the fixed experiment from the repository root:

```powershell
python -m modules.atmosphere.train_tropomi_weather
```

The runner writes the model comparison, updated metrics, observation counts,
diagnostics, interval coverage, plots, and a short result summary to
`models/evaluation/tropomi/`. It uses a fixed random seed of 42 and small
regularized Ridge, histogram boosting, and XGBoost candidates. Training uses
2019-2023, candidate selection uses January-June 2024, interval calibration
uses July-September 2024, interval checking uses October-December 2024, and
2025 is the locked test period.

The climatology uses all 2019-2023 observations. Residual models fit
2020-2023 rows because their climatology and neighboring-cell features use
only earlier years; 2019 supplies the first prior.

To score a later year against the already-selected weather models, include
that year in the input table and pass `--forward-test-year YEAR`. For example:

```powershell
python -m modules.atmosphere.train_tropomi_weather `
  --tropomi-path data/raw/tropomi/forward_holdout_2026/combined_2019-2026-through-09.csv.gz `
  --forward-test-year 2026 `
  --compare-expanded-training `
  --evaluation-dir models/evaluation/tropomi/forward-2026 `
  --checkpoint-dir tmp/tropomi-forward-checkpoint
```

The fixed 2024 candidate selection remains unchanged; the later year's metrics
are written to `forward_metrics.json`, `forward_predictions.csv.gz`, and
`forward_error_by_month.csv` and do not affect selection or the acceptance
gate. The forward report includes the candidate's matched no-weather control,
so weather value is measured against that control as well as against
climatology. Use separate output paths to preserve the existing evaluation
and checkpoint.

For a development comparison of recent-history climatology windows, add
`--compare-climatology-windows`. The candidate windows use observations only
through the year before the requested forward year, but that year is then used
to compare and select development candidates; it is no longer an untouched
test. The comparison is saved separately in
`development_climatology_windows.json` and related prediction files. Keep a
later period for independent confirmation.

For a separate post-hoc development comparison, add
`--compare-expanded-training`. This refits the fixed regression candidates on
2020 through the year before the requested forward year, then compares them
on that forward year. It writes `expanded_training_comparison.json`,
`expanded_training_predictions.csv.gz`, and monthly metrics. Because the
forward year is used to compare candidates, these results are development
data, not an independent test; they do not change production model selection.

The 5% test MAE gate is fixed in code. A weather model must also beat its
matched no-weather control on the selection period. If either condition fails,
the selected output remains the spatial-seasonal climatology residual.

The available TROPOMI CSV has monthly cell means, while the current Giovanni
MERRA CSVs are area averages for the Philippines envelope. Thus 05:30 UTC
weather is aggregated over all days in each month, not over each cell's exact
valid TROPOMI observation days. No road or industrial-distance features are
present in these two datasets.

For TROPOMI three-band training, run
`python -m modules.atmosphere.train_tropomi_bands`. This stage reads TROPOMI
observations and writes `band_` evaluation files directly to
`models/evaluation/tropomi/`, alongside the regression evaluation.

## Selected-model inference

`modules.atmosphere.inference` loads the selected TROPOMI regression checkpoint
without treating the stored best candidate as the selected model. Its input
CSV must contain `month` and `cell_id`. Optional observations can be provided
as `observed_no2_umol_m2` or `tropospheric_no2_mean_mol_m2`; missing observations
remain missing. A selected weather model additionally requires all feature
columns saved in its checkpoint from harmonized, prediction-time data.

After preparing that input, run:

```powershell
python -m modules.atmosphere.inference --input INPUT.csv --output data/exports/tropomi/anomalies.csv.gz
```

The output
contains expected NO2, residuals, intervals, and significant-anomaly flags.
The current selected climatology needs only month and cell ID; it labels its
residuals `climatology residual`. A future weather model must have a passing
gate saved in its checkpoint before the adapter labels its residuals
`weather-adjusted residual`. This adapter is not yet connected to the backend.

## Integration export

Build the current selected-model output for every Philippines cell and month
in 2025:

```powershell
python -m modules.atmosphere.export_tropomi
```

The CSV and provenance manifest are in `data/exports/atmosphere/`. The export
uses the checkpoint's minimum valid-orbit count, the matching Philippines
boundary, and QA of at least 0.75. It retains explicit rows and zero counts
for missing cell-months. Only valid observations receive an anomaly or
significance flag. The selected checkpoint is climatology, so this export does
not claim weather adjustment. See `data/exports/atmosphere/README.md` for the
field contract.
