# CSTAR Energy — Supabase backend

The Node.js API uses Supabase Auth and PostgreSQL. Workspace data is private to each Supabase user and protected by row-level security (RLS). Node.js 22.18 or newer is required. The React frontend continues using `/api`, proxied by Vite during development.

## Connect your existing project

1. Run the migrations in order in your Supabase project's **SQL Editor**: [workspaces](supabase/migrations/202611140001_workspaces.sql), [atmosphere](supabase/migrations/202611140002_atmosphere.sql), [prototype data](supabase/migrations/202611140003_prototype_data.sql), and [portal foundation](supabase/migrations/202611150001_portal_foundation.sql). The portal migration creates database-backed profiles, roles, jurisdictions, reports, plans, publications, audit logging, and RLS policies; existing Auth users are initialized as residents.
2. Open `backend/.env` (copy `.env.example` if needed). Set `SUPABASE_URL` to your Project URL and `SUPABASE_PUBLISHABLE_KEY` to the project's publishable key. A legacy anon key also works via `SUPABASE_ANON_KEY`. Obtain these from the project's Connect dialog or API settings. Database requests use each request's authenticated user token. Set `SUPABASE_SERVICE_ROLE_KEY` only on the backend if administrators need to create Auth accounts; never expose it to the frontend.
3. Use **New here? Sign up** in the app to create an account, or create/invite one through **Authentication → Users** in Supabase. When email confirmation is enabled, confirm the emailed link before signing in. Under Supabase Auth URL Configuration, set the Site URL and allowed redirect URL to `http://localhost:5173` for development (your HTTPS origin in production). Public signup must be enabled in Supabase for the app's registration form. Password recovery is not implemented.
4. Optional: enable **Anonymous Sign-Ins** in Supabase Auth and set `DEMO_ACCESS=true` for **Open demo workspace**. Each anonymous user receives a private workspace. Signing out or losing its session means that anonymous workspace cannot be recovered through email/password. Demo access defaults to disabled.
5. Start the backend and frontend in separate terminals:

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

The portal migration creates `cstar_profiles` from Auth users with the least-privileged `RESIDENT` role; submitted signup metadata cannot assign roles. `ADMIN`, `LGU`, `RESEARCHER`, and `RESIDENT` roles, active/suspended state, approval state, and jurisdiction assignments are persisted in PostgreSQL—not trusted from cookies or request claims. Admin mutations are checked by the API and RLS. LGU and researcher access to reports/plans is limited to the assigned jurisdiction. Community reports are owner-bound, status transitions are constrained in the database, and committed profile/jurisdiction/report/plan/publication changes create audit entries. The API's admin user-creation route requires the backend-only service-role key for Supabase Auth account creation; profile changes still use the authenticated caller's RLS context.

For a local-only first administrator, set `NODE_ENV=development`, `ENABLE_DEV_ADMIN_SEEDER=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEV_ADMIN_EMAIL`, and `DEV_ADMIN_PASSWORD` in the local process environment, then run `npm.cmd run seed:dev-admin` from `backend/`. Supabase Auth stores the password securely; the script never prints it. The script refuses to run unless explicitly enabled in development and always refuses `NODE_ENV=production`. Do not commit credentials. For production, provision the first administrator through a trusted operator process.

Access and refresh tokens stay in HTTP-only SameSite cookies. Every API request uses a separate Supabase client, validates the user with Auth, and sends that user's token to the database so RLS remains active. Expired access tokens are refreshed. Remember enables persistent cookies with a seven-day sliding lifetime; otherwise cookies are browser-session cookies. Supabase Auth settings can further limit session lifetime. Sign-out clears local cookies and revokes the Supabase refresh session; already issued JWTs can remain valid until their expiration, as defined by Supabase Auth.

For production, serve the frontend and `/api` under one HTTPS origin, set `FRONTEND_ORIGIN` to that exact origin, and enable `COOKIE_SECURE=true`. The Vite proxy only applies in development. Use Supabase's abuse protection/CAPTCHA configuration if enabling public anonymous sign-in; this implementation does not include a CAPTCHA UI.

SQLite is no longer read or written. Existing files under `backend/storage/` are preserved as local backups and are not automatically imported into Supabase. Browser-local data is also not automatically imported. Live satellite feeds and scientific processing remain unconnected; the observations are synthetic.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Existing API status plus `service`, `databaseStatus`, and `databaseReachable`; database reachability is `null` because the public health route does not make an authenticated DB probe |
| POST | `/api/session` | `{email,password,remember}` or optional `{demo:true,remember}` |
| POST | `/api/signup` | `{name,email,password,remember}`; returns a workspace or confirmation instructions |
| DELETE | `/api/session` | Supabase sign-out and cookie cleanup |
| GET | `/api/me` | `{profile:{id,name,email,role,status,approval_status,jurisdiction_id,...},session:{expires_at,expires_in,token_type}}`; does not return tokens |
| GET | `/api/workspace` | Current user's workspace and version |
| PUT | `/api/workspace` | Validate and save workspace with version check |
| GET | `/api/events` | Events, optionally filtered by `q` and `status` |
| GET | `/api/events/:id` | Event details |
| GET | `/api/records` | Current user's records |
| GET | `/api/datasets` | Bundled synthetic product catalog |
| GET | `/api/series` | Bundled synthetic historical observations |
| GET | `/api/admin/dashboard` | Admin-only persisted counts and recent audit activity; `failedJobs` is `null` because there is no job-status store |
| GET | `/api/admin/users?query=&role=&status=` | Admin-only user directory |
| POST | `/api/admin/users` | Admin-only Auth account creation and role/profile assignment; requires `SUPABASE_SERVICE_ROLE_KEY` |
| PATCH | `/api/admin/users/:id` | Admin-only name, role, status, approval, or jurisdiction update |
| GET / POST | `/api/admin/jurisdictions` | Admin-only jurisdiction listing and creation |
| GET / POST | `/api/admin/reports` | Admin-only report listing and creation |
| PATCH | `/api/admin/reports/:id` | Admin-only report assignment/status update |
| GET | `/api/reports` | RLS-scoped community reports |
| POST | `/api/reports` | Resident creates an owned report in their assigned jurisdiction |
| PATCH | `/api/reports/:id` | Admin or jurisdiction LGU assignment/status update |
| GET | `/api/admin/datasets` | Admin-only existing dataset catalog; rows are labeled `synthetic_demo` |
| GET | `/api/admin/audit-logs` | Admin-only audit history |
| GET / POST | `/api/action-plans` | Admin/LGU create; Admin/LGU/Researcher read plans within RLS scope |
| PATCH | `/api/action-plans/:id` | Admin or jurisdiction LGU changes plan status |
| GET | `/api/publications` | Authenticated, jurisdiction-scoped publication list |
| POST | `/api/admin/publications` | Admin creates a persisted publication |

Portal errors use `{error}`. Missing/expired authentication returns 401; authenticated users lacking the required role or suspended accounts receive 403. All portal writes are role-checked by the API and independently constrained by RLS and database checks. Dataset pipeline controls (retry, ingestion, processing progress, and job status) are deliberately not exposed because those pipelines are disconnected; no synthetic jobs or fake retry outcomes are returned. The admin dataset endpoint returns only the persisted demo catalog and labels its synthetic classification. Event notes, status, analyst, and working mechanism remain editable as before. The JSON workspace remains a research prototype rather than shared authoritative source records.

## Verification

Run `npm.cmd test` in `backend/`. API integration tests exercise the real Supabase JavaScript SDK against a protocol fixture, covering password and anonymous sign-in, cookie handling, token refresh, workspace reads/saves, user isolation, conflicts, invalid input, current-user role output, suspended-account blocking, signup role isolation, and missing configuration. They do not contact your hosted project.

After applying the migrations, run the SQL policy tests in `supabase/tests/` in the Supabase SQL Editor to verify actual PostgreSQL RLS. Hosted authentication and database connectivity require your project's configuration and must be checked after those values are supplied.
