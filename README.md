# CSTAR—ENERGY

Multi-satellite transition research workspace.

## React Native frontend

The Expo / React Native application lives in **`app/mobile`**. It includes the sign-in demonstration, dashboard, investigation screens, maps, charts, and local report exports.

From the repository root:

```powershell
cd app/mobile
npm.cmd install
npm.cmd start
```

Use `npm.cmd run web` for a browser preview or `npm.cmd run android` for an Android emulator. On macOS, `npm run ios` starts the iOS simulator. See [the frontend README](app/mobile/README.md) for the complete setup, supported workflows, and demonstration limitations.

```powershell
cd app/mobile
npm.cmd run typecheck
npm.cmd test
npm.cmd run build:web
```

## Repository structure

- `app/mobile/` — React Native frontend, its dependencies, assets, and frontend tests.
- `backend/` — API, database, jobs, and service structure.
- `data/` — Raw, interim, processed, and exported research data.
- `pipeline/` — Satellite ingestion, quality control, harmonization, and analysis.
- `models/`, `research/`, `validation/` — Modeling and scientific validation work.
- `deployment/`, `visualization/` — Deployment and research visualization structure.
- `tests/` — Repository-level data quality, integration, and unit test structure.

The frontend currently uses bundled synthetic data and device-local persistence. Moving it into this repository structure does not connect it to a backend or live satellite feeds.
