# CSTAR-Energy Backend

Minimal backend scaffold for CSTAR-Energy, a platform for investigating historical satellite radiance, atmospheric NO?, meteorology, and geographic context. This repository initializes the service structure only. Feature modules are placeholders; no observations, scientific calculations, or evidence conclusions are implemented.

## Stack

Python 3.12+, FastAPI, Pydantic Settings, SQLAlchemy, GeoAlchemy2, Alembic, PostgreSQL/PostGIS, Redis/RQ, and optional scientific/geospatial libraries (NumPy, Pandas, GeoPandas, Rasterio, Shapely, PyProj, SciPy). HTTPX and Pytest support future integrations and smoke checks. No AI/ML packages are included.

## Structure

- `app/`: FastAPI entry point, settings, database foundation, and versioned API routing.
- `models/`, `schemas/`, `services/`: future persistence, request/response contracts, and business services.
- `ingestion/`: future satellite and meteorological data connectors/catalog.
- `processing/`: future data quality and geospatial/temporal preparation.
- `analytics/`: future deterministic environmental analysis and evidence rules.
- `workers/`: future Redis/RQ background task setup.
- `utils/`: shared date, GeoJSON, and file helpers.
- `alembic/`: migration configuration; no tables or migrations are included.
- `data/`: locations for raw, processed, cached, and sample data.
- `artifacts/reports/`: future generated research reports.
- `scripts/`: reserved for database and ingestion utilities.
- `tests/`: smoke tests plus reserved feature test areas.

## Local development

From this directory, create and activate a virtual environment:

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
source .venv/bin/activate
```

Install runtime and development dependencies (optional scientific packages are separate):

```bash
python -m pip install --upgrade pip
pip install -e ".[dev]"
# Optional geospatial/scientific stack when needed:
pip install -e ".[science]"
```

Copy `.env.example` to `.env` and replace placeholder values as appropriate. Settings are read from environment variables; `.env` is ignored by Git. Do not commit credentials. PostgreSQL/PostGIS and NASA/Copernicus credentials are not required to import or start this initial app.

Start the API from the backend directory:

```bash
uvicorn app.main:app --reload
```

The health endpoint is `/health`; interactive docs are at `/docs`. API v1 is mounted at `/api/v1` and currently contains no feature endpoints.

## Database

`app/core/database.py` defines the SQLAlchemy declarative base, engine, and session factory. Engine construction does not open a connection. GeoAlchemy2 is available for future spatial columns. Alembic is configured to read `DATABASE_URL`, but no tables have been defined and no migrations have been run. The database must have PostGIS enabled before spatial migrations are introduced.

## Future development stages

1. Define persistence models and reviewed database migrations.
2. Add input/output schemas and API/service behavior for regions and data availability.
3. Implement source-specific ingestion, provenance, and quality control.
4. Add deterministic geospatial, temporal, and environmental analysis with uncertainty reporting.
5. Add analyst review, verification, report, and audit workflows.
6. Add background jobs and deployment environment configuration.

Rule-based evidence assessments should communicate uncertainty and must not be presented as proof of causation.
