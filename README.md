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

The frontend uses synthetic data and browser-local persistence. Backend integration and live satellite feeds are not connected.
