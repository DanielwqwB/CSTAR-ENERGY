# CSTAR—ENERGY

Multi-satellite transition research workspace.

## React frontend

The browser application lives directly in **`frontend/`** and uses React, TypeScript, and Vite.

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). On macOS/Linux, use `npm` instead of `npm.cmd`.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
```

See [frontend setup and functionality](frontend/README.md) for details.

## Repository structure

- `frontend/` — React browser interface, assets, and frontend tests.
- `backend/` — API, database, jobs, and service structure.
- `data/` — Raw, interim, processed, and exported research data.
- `pipeline/` — Satellite ingestion, quality control, harmonization, and analysis.
- `models/`, `research/`, `validation/` — Modeling and scientific validation work.
- `deployment/`, `visualization/` — Deployment and research visualization structure.
- `tests/` — Repository-level data quality, integration, and unit test structure.

The frontend connects to a Node.js API using Supabase Auth and PostgreSQL. Configure your existing Supabase project, apply the SQL migrations, and start the API with `cd backend` and `npm.cmd run dev`. See [Supabase setup, configuration, and endpoints](backend/README.md). Frontend events and illustrative series remain synthetic; the Evidence Timeline separately displays the authenticated, published TROPOMI export as a paginated monthly grid. Its climatology residuals are precomputed output, not live inference.

## Radiance processing

The `modules/radiance/` package inventories and processes NASA Black Marble
VNP46A3 Collection 2 monthly composites. The current MVP study area is the
Bicol Region, approximated by the bounding box `122.3, 11.4, 124.7, 14.6`
inside tile `h30v07`.

Primary radiance statistics use:

- `AllAngle_Composite_Snow_Free`
- quality value `0` (direct, good-quality observations)
- observation count greater than zero
- land and coastal pixels only

Poor-quality and gap-filled pixels are counted for provenance but excluded
from the primary statistics.

Inventory the official NASA LAADS monthly archive without downloading files:

```powershell
python -m modules.radiance.download --start-year 2016 --end-year 2026 --list-only
```

The downloader writes raw HDF5 files to `data/raw/black_marble/`. It selects
only VNP46A3 Collection 2 tile `h30v07`, skips complete local files, writes
through a temporary `.part` file, validates the HDF5
signature and advertised size, and checks free disk space before transfer.
It reuses `data/raw/black_marble/nasa_archive_inventory.json` after the first
successful inventory scan. Pass `--refresh-inventory` only when a fresh NASA
archive scan is needed.
After freeing sufficient space, set `NASA_EARTHDATA_TOKEN` in the current
PowerShell session without committing it, then omit `--list-only`:

```powershell
python -m modules.radiance.download --start-year 2016 --end-year 2026
```

Never paste an Earthdata token into source code, Git, screenshots, or chat.

Run the processor:

```powershell
python -m modules.radiance.analysis --input data/raw/black_marble
```

This writes a time-series CSV and provenance manifest under
`data/processed/radiance/`. Raw HDF5 inputs are intentionally ignored by Git.
The existing processed manifest records the old `BlackMarbles/` input path;
that historical provenance is preserved until processing is rerun from the
new raw directory.

Run tests:

```powershell
python -m pytest
```

## Experimental baseline training

The current data can run a small next-observation regression experiment. This
validates the training and evaluation pipeline; it is not a transition
classifier and is not the planned multimodal ST-GNN.

```powershell
python experiments/radiance_baseline.py
```

The experiment uses chronological train/validation/test periods, compares a
Ridge model with a persistence baseline, and writes metrics and predictions to
`models/evaluation/blackmarble/`. Its checkpoint is saved under
`models/checkpoints/blackmarble/`. Classification metrics remain unavailable
until independently verified transition labels are supplied.

### Data limitations

The available observations cover 2016-2026 but use inconsistent months, which
can introduce seasonal bias. VNP46A3 is a monthly composite product, not daily
VNP46A2 data. Results are preliminary evidence and must not be described as
proof of lighting transitions or energy savings.

## Presentation-only radiance demo data

Generate a complete January 2016 through December 2026 monthly series for UI
mockups and presentations:

```powershell
python -m modules.radiance.demo
```

The output in `data/demo/blackmarble/` preserves real VNP46A3 observations and
explicitly labels every filled month as `synthetic_demo` with uncertainty
bounds and a disclaimer. It
must not be used for model training, evaluation, accuracy claims, or scientific
inference. The training script rejects presentation-only synthetic rows.

Train the explicitly labelled multimodal presentation demo and generate charts:

```powershell
python experiments/radiance_multimodal_demo.py
```

This joins Bicol-cropped monthly TROPOMI NO2, monthly Giovanni/MERRA-2 weather
aggregates, and the presentation radiance series. Its source defaults point
to `data/demo/blackmarble/`, `data/raw/tropomi/`, and `data/raw/merra/`.
Outputs under
`artifacts/radiance_multimodal_demo/` are prototype visuals only. XGBoost is
included as a validation-selected candidate when the optional dependency is
installed; the script falls back to scikit-learn candidates otherwise.

## MERRA-2 baseline training

The initial atmospheric baseline predicts next-hour MERRA-2 two-meter air
temperature (`T2M`) from the current meteorological state and lagged features.
It uses chronological train/validation/test partitions and compares the trained
models with a persistence forecast. Split periods use the target timestamp, so
a next-hour label cannot cross into a later evaluation period.

Place Giovanni `M2T1NXSLV` CSV exports in `data/raw/merra/`, then run:

```powershell
python -m models.training.train_merra_baseline
```

Evaluation reports, predictions, plots, and the model card are written to
`models/evaluation/merra/`. The selected local checkpoint is written to
`models/checkpoints/merra/` and is ignored by Git.

## TROPOMI NO2 extraction

The atmospheric branch can build compact, QA-filtered monthly TROPOMI NO2
tables from the public Sentinel-5P AWS archive without an Earthdata or
Copernicus bearer token. The extractor prefers the research-quality
reprocessed stream (RPRO), falls back to the offline stream (OFFL), reads only
the requested window from the orbit Cloud Optimized GeoTIFFs, and applies the
recommended `qa >= 0.75` threshold.

For the same Philippines envelope as the current MERRA-2 exports:

```powershell
python -m pipeline.ingestion.tropomi_aws `
  --start 2019-01-01 `
  --end 2025-12-31 `
  --bbox 116 4 127 22 `
  --workers 4
```

Monthly compressed CSVs and provenance manifests are written under
`data/raw/tropomi/monthly/`, along with a combined compressed training table,
an extraction summary, and SHA-256 checksums. Existing completed months are
skipped when the command is restarted. These gridded files are suitable for
feature-table training, but they do not replace native Level-2 footprint
polygons required for the final footprint visualization.

## TROPOMI-MERRA modeling

The current monthly Philippines experiment compares a training-only
cell-by-month climatology with MERRA-2 weather corrections, matched no-weather
controls, training-only neighbor context, and prediction intervals. Run:

```powershell
python -m modules.atmosphere.train_tropomi_weather
```

Evaluation tables, predictions, plots, and the model card are written to
`models/evaluation/tropomi/`. The selected checkpoint is written to
`models/checkpoints/tropomi/best_model.joblib` and is ignored by Git. The
climatology uses 2019-2023, candidate selection uses 2024, and 2025 is the
locked test period. If the weather gate fails, anomalies remain climatology
residuals. The runner can also score a later, untouched year with
`--forward-test-year`, keeping that period out of training and selection.
Adding `--compare-climatology-windows` uses that period for development
selection, so it should not then be described as an untouched test.

The experiment code and run guide are in `modules/atmosphere/`. Its result
summary is written to `models/evaluation/tropomi/README.md`.

The older `python -m models.training.train_tropomi_baseline` command writes
`legacy_baseline_`-prefixed files inside `models/evaluation/tropomi/` and a
`legacy_baseline_best_model.joblib` checkpoint inside
`models/checkpoints/tropomi/`. It cannot overwrite the current experiment.

For the TROPOMI low, medium, and high NO2 concentration-band training, run
`python -m modules.atmosphere.train_tropomi_bands`. Its `band_` evaluation
files are written directly to `models/evaluation/tropomi/`.

To build the selected TROPOMI atmospheric handoff table without backend
integration, run `python -m modules.atmosphere.export_tropomi`. The CSV,
provenance manifest, and field contract are in `data/exports/atmosphere/`.
