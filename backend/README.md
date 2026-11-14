# CSTAR Energy — Supabase backend

The Node.js API uses Supabase Auth and PostgreSQL. Workspace data is private to each Supabase user and protected by row-level security (RLS). Node.js 22.18 or newer is required. The React frontend continues using `/api`, proxied by Vite during development.

## Connect your existing project

1. Open your Supabase project's **SQL Editor** and run [the workspace migration](supabase/migrations/202611140001_workspaces.sql). This creates the workspace table, owner policies, and version-update trigger.
2. Run [the prototype data migration](supabase/migrations/202611140003_prototype_data.sql). It stores the sample catalog and monthly chart series in read-only tables for authenticated users. Those demo rows are explicitly synthetic.
3. Open `backend/.env` (copy `.env.example` if needed). Set `SUPABASE_URL` to your Project URL and `SUPABASE_PUBLISHABLE_KEY` to the project's publishable key. A legacy anon key also works via `SUPABASE_ANON_KEY`. Obtain these from the project's Connect dialog or API settings. This app does not need a secret or service-role key.
4. Use **New here? Sign up** in the app to create a test account; its private workspace is created on signup/sign-in. Shared sample catalog/series and published atmospheric rows are read-only and available to every signed-in account. Do not seed a shared password or associate the scientific dataset with one test user's workspace. When email confirmation is enabled, confirm the emailed link before signing in. Under Supabase Auth URL Configuration, set the Site URL and allowed redirect URL to `http://localhost:5173` for development (your HTTPS origin in production). Public signup must be enabled in Supabase for the app's registration form. Password recovery is not implemented.
5. Optional: enable **Anonymous Sign-Ins** in Supabase Auth and set `DEMO_ACCESS=true` for **Open demo workspace**. Each anonymous user receives a private workspace. Signing out or losing its session means that anonymous workspace cannot be recovered through email/password. Demo access defaults to disabled.
6. Start the backend and frontend in separate terminals:

```powershell
cd backend
npm.cmd install
npm.cmd run dev
```

```powershell
cd frontend
npm.cmd run dev
```

Open http://localhost:5173. After editing environment variables, restart the backend. Only backend environment variables are needed for Supabase; keep the existing frontend Mapbox configuration.

See the official [API key guide](https://supabase.com/docs/guides/getting-started/api-keys), [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), and [anonymous sign-in reference](https://supabase.com/docs/reference/javascript/auth-signinanonymously).

## Storage and sessions

`public.cstar_workspaces` contains one JSON workspace per `auth.users.id`, including events, records, display profile, region, and a version number. The first successful sign-in seeds the four synthetic events. A user's display-profile email does not change their Supabase Auth email. Updates compare the stored version atomically; stale saves return HTTP 409 and require a reload.

The shared sample catalog and monthly chart series are stored separately in
`cstar_demo_dataset_catalog` and `cstar_demo_monthly_series`; RLS allows
authenticated reads only. The series is presentation-only synthetic data. The
published TROPOMI export is stored in the separate versioned
`cstar_atmosphere_runs` and `cstar_atmosphere_cells` tables.

Access and refresh tokens stay in HTTP-only SameSite cookies. Every API request uses a separate Supabase client, validates the user with Auth, and sends that user's token to the database so RLS remains active. Expired access tokens are refreshed. Remember enables persistent cookies with a seven-day sliding lifetime; otherwise cookies are browser-session cookies. Supabase Auth settings can further limit session lifetime. Sign-out clears local cookies and revokes the Supabase refresh session; already issued JWTs can remain valid until their expiration, as defined by Supabase Auth.

For production, serve the frontend and `/api` under one HTTPS origin, set `FRONTEND_ORIGIN` to that exact origin, and enable `COOKIE_SECURE=true`. The Vite proxy only applies in development. Use Supabase's abuse protection/CAPTCHA configuration if enabling public anonymous sign-in; this implementation does not include a CAPTCHA UI.

## Render deployment

The repository-root `render.yaml` defines a backend-only Render web service:
it installs and starts from `backend/` and uses Render's assigned `PORT`. The
service keeps the repository root available because the backend currently reads
bundled seed JSON from `frontend/src/data/`; it does not build or serve the
frontend. The initial plan is Render's free plan, which may spin down when idle.
Review the plan before creating the service if you need always-on availability.

Set the prompted `FRONTEND_ORIGIN` to the exact HTTPS origin users open in
their browser. Because the frontend calls relative `/api` URLs and uses
same-origin cookies, configure the frontend host to proxy `/api/*` to the
Render service while preserving request methods, cookies, and `Set-Cookie`
headers. Do not point browser requests directly at a different Render origin.
Set the Supabase Site URL and allowed redirect URL to the frontend origin as
well. The blueprint does not include any service-role key; atmospheric imports
remain a separate server-side job.

The `/api/health` Render check confirms that the process is running and the
Supabase URL/key are configured; it does not probe database availability.

SQLite is no longer read or written. Existing files under `backend/storage/` are preserved as local backups and are not automatically imported into Supabase. Browser-local data is also not automatically imported. The prototype overview and data explorer load the sample catalog through
`GET /api/datasets`, and trend charts load the synthetic series through
`GET /api/series`. These remain illustrative data, not live satellite
observations or AI inference. The separate atmospheric routes can serve the
validated TROPOMI export after its migration and import.

## Atmospheric data backend

The authenticated atmosphere routes serve the selected 2025 TROPOMI export.
They do not run Python training or accept model uploads through the browser.
The separate [atmosphere migration](supabase/migrations/202611140002_atmosphere.sql)
creates staging/published runs and cell-month rows. Signed-in users can read
published rows only; the server-only import job writes staging rows. An
incomplete run cannot be published, and published rows are immutable.

From the repository root, validate the export and its SHA-256 manifest offline:

```powershell
python backend/jobs/import_atmosphere.py
```

To regenerate the export from the local source table, boundary, and checkpoint,
run the separate Python batch job. It validates the output but does not publish
by default:

```powershell
python -m backend.jobs.run_atmosphere_batch
```

Install the exact dependency closure for this local worker with
`python -m pip install -r backend/jobs/requirements-atmosphere-worker.txt`.
To publish the content-addressed run after validation, add `--publish` and
provide `SUPABASE_URL` and `SUPABASE_SECRET_KEY` through the process environment.
The job reuses the importer’s staging, count verification, and immutable publish
flow. It is an operator-run local batch, not a hosted or scheduled worker.

After applying the migration, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in
the import job's process environment and run
`python backend/jobs/import_atmosphere.py --publish`. The job uploads in
idempotent batches, verifies the row count, and publishes only after all rows
are present. Keep the secret key out of Git, the frontend, command history,
and `backend/.env` used by the web server. The web server keeps using its
publishable key and the signed-in user's session.

The current export contains 29,580 cell-month rows, including explicit missing
and rejected observations. The selected model is climatology, so its anomaly
label remains `climatology residual`. Frontend events and chart series remain
synthetic demonstration data; they are stored for display, not model input.
The repository's 2025 export is validated offline and covers all twelve months;
January–February alone contain 4,930 cell-month rows. For the MVP, import the
complete versioned export rather than truncating it. These are precomputed
climatology predictions and residuals, not an online model-inference API or
training data. The simulated Black Marble presentation series is kept separate
and is never a model input.

The source TROPOMI input, boundary, and trained checkpoint remain local
pipeline assets; they are not uploaded by the import job and are not tracked in
Git. The current local batch can regenerate/publish from these files, but a
hosted worker cannot access them. Cloud execution remains a separate task
requiring controlled object storage and a Python job or inference service. Two
months can exercise data display and API flow but cannot establish scientific
model accuracy.

### Private worker inputs

The [atmosphere input-storage migration](supabase/migrations/202611150001_atmosphere_input_storage.sql)
creates a private `cstar-atmosphere-inputs` bucket. Client roles are explicitly
blocked from its objects; a future server-side worker must use a secret key
from its environment. Run
[the storage policy check](supabase/tests/atmosphere_storage.sql) after applying
the migration.

Upload these existing local artifacts through the Supabase Storage dashboard
using the following exact object paths. Their SHA-256 values are in the export
manifest and should be checked after upload:

| Object path | Local file | SHA-256 |
| --- | --- | --- |
| `data/raw/tropomi/tropomi_no2_2019-01-01_2025-12-31.csv.gz` | `data/raw/tropomi/tropomi_no2_2019-01-01_2025-12-31.csv.gz` | `0f39af1d032c0f16549e51ccf74550f1cd9f30e9994ba66e7bb010df28d4805d` |
| `data/raw/tropomi/philippines_adm0.geojson` | `data/raw/tropomi/philippines_adm0.geojson` | `7c3a7a39dacb5fb0c14d150061306fa5839455fbf93231854af3c6d74a1fa24f` |
| `data/raw/tropomi/best_model.joblib` | `models/checkpoints/tropomi/best_model.joblib` | `4b42bc465dec3695d02e1e9afc7396911c9fc411cc561ef0220f2fb1ff6d8b27` |

The bucket accepts individual objects up to 50,000,000 bytes, enough for the
current 45,151,732-byte TROPOMI source. The migration does not upload data or
configure a hosted worker.

The local batch runner can now fetch these private inputs with
`--from-storage`. Its pinned [input manifest](jobs/atmosphere_input_manifest.json)
contains each object path, expected byte size, and SHA-256. The runner downloads
all three objects to a temporary directory, verifies every size and hash before
loading the checkpoint, then validates the regenerated export. The temporary
inputs are removed when the run finishes; the generated export remains at the
requested `--output` path. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the
worker process environment (never in the frontend or web-server `.env`).

For a download-and-validation run, use:

```powershell
python -m backend.jobs.run_atmosphere_batch --from-storage --output "$env:TEMP\cstar-atmosphere-storage-check.csv.gz"
```

Add `--publish` only when intentionally publishing the complete validated run.
This remains a manually operated batch command; no hosted or scheduled worker
has been configured.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API status and whether Supabase variables are configured; not a live database probe |
| POST | `/api/session` | `{email,password,remember}` or optional `{demo:true,remember}` |
| POST | `/api/signup` | `{name,email,password,remember}`; returns a workspace or confirmation instructions |
| DELETE | `/api/session` | Supabase sign-out and cookie cleanup |
| GET | `/api/workspace` | Current user's workspace and version |
| PUT | `/api/workspace` | Validate and save workspace with version check |
| GET | `/api/events` | Events, optionally filtered by `q` and `status` |
| GET | `/api/events/:id` | Event details |
| GET | `/api/records` | Current user's records |
| GET | `/api/datasets` | Authenticated read of the synthetic catalog stored in Supabase |
| GET | `/api/series` | Authenticated read of the synthetic monthly series stored in Supabase |
| GET | `/api/atmosphere/manifest` | Latest published atmospheric run and provenance manifest |
| GET | `/api/atmosphere/no2?month=2025-01&limit=500&offset=0` | Published NO2 cell-month rows; optional `status` filter |
| GET | `/api/cctf/assessment` | Conservative CCTF evidence assessment; returns the configured pilot and remains `unresolved` until the evidence gate passes |

All routes except health and session creation require authentication. Event notes, status, analyst, and working mechanism are editable. Source observations remain fixed in the app. The database owner policies isolate users; a user with their own valid token can modify their own JSON workspace directly through Supabase. The JSON model is intended for this research prototype rather than shared, authoritative source records.

Atmospheric pages are ordered by `cell_id`, have a maximum `limit` of 1000,
and include `total` for pagination. Each row preserves quality status and null
observed/anomaly fields where no valid observation exists. The response also
includes the selected run ID, model name, and anomaly interpretation.

The CCTF endpoint deliberately abstains when event geometry, a documented
treatment window, linked radiance change, overpass-matched wind evidence, or
eligible counterfactual controls are missing. It exposes the configured pilot
event and its evidence gaps, may expose the published TROPOMI run as available
provenance, but never turns that run into a causal mechanism verdict by itself.

## Verification

Run `npm.cmd test` in `backend/`. API integration tests exercise the real Supabase JavaScript SDK against a protocol fixture, covering password and anonymous sign-in, cookie handling, token refresh, workspace reads/saves, user isolation, conflicts, invalid input, and missing configuration. They do not contact your hosted project.

After applying the migration, run [the SQL policy tests](supabase/tests/workspaces.sql) in the Supabase SQL Editor to verify actual PostgreSQL RLS and version checks. The tests insert temporary users and roll back all changes. Hosted authentication and database connectivity require your project's configuration and must be checked after those values are supplied.

After the atmosphere migration, run its [RLS test](supabase/tests/atmosphere.sql)
in the SQL Editor as well. Local API tests use a protocol fixture and do not
replace checking the hosted database's policies.
After the prototype data migration, run
[its RLS test](supabase/tests/prototype_data.sql) to confirm authenticated
read-only access and deny anonymous reads.
