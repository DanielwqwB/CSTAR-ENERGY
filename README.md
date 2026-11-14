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

The frontend connects to a Node.js API using Supabase Auth and PostgreSQL. Configure your existing Supabase project, apply the SQL migration, and start the API with `cd backend` and `npm.cmd run dev`. See [Supabase setup, configuration, and endpoints](backend/README.md). Live satellite feeds remain unconnected; observations are synthetic.

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

The downloader selects only VNP46A3 Collection 2 tile `h30v07`, skips complete
local files, writes through a temporary `.part` file, validates the HDF5
signature and advertised size, and checks free disk space before transfer.
It reuses `nasa_archive_inventory.json` after the first successful inventory
scan. Pass `--refresh-inventory` only when a fresh NASA archive scan is needed.
After freeing sufficient space, set `NASA_EARTHDATA_TOKEN` in the current
PowerShell session without committing it, then omit `--list-only`:

```powershell
python -m modules.radiance.download --start-year 2016 --end-year 2026
```

Never paste an Earthdata token into source code, Git, screenshots, or chat.

Run the processor:

```powershell
python -m modules.radiance.analysis --input BlackMarbles
```

This writes a time-series CSV and provenance manifest under
`data/processed/radiance/`. Raw HDF5 inputs are intentionally ignored by Git.

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
`artifacts/radiance_baseline/`. Classification metrics remain unavailable
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

The output preserves real VNP46A3 observations and explicitly labels every
filled month as `synthetic_demo` with uncertainty bounds and a disclaimer. It
must not be used for model training, evaluation, accuracy claims, or scientific
inference. The training script rejects presentation-only synthetic rows.

Train the explicitly labelled multimodal presentation demo and generate charts:

```powershell
python experiments/radiance_multimodal_demo.py
```

This joins Bicol-cropped monthly TROPOMI NO2, monthly Giovanni/MERRA-2 weather
aggregates, and the presentation radiance series. Outputs under
`artifacts/radiance_multimodal_demo/` are prototype visuals only. XGBoost is
included as a validation-selected candidate when the optional dependency is
installed; the script falls back to scikit-learn candidates otherwise.
