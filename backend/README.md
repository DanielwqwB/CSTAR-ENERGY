# CSTAR Energy — Supabase backend

The Node.js API uses Supabase Auth and PostgreSQL. Workspace data is private to each Supabase user and protected by row-level security (RLS). Node.js 22.18 or newer is required. The React frontend continues using `/api`, proxied by Vite during development.

## Connect your existing project

1. Open your Supabase project's **SQL Editor** and run [the workspace migration](supabase/migrations/202611140001_workspaces.sql). This creates the workspace table, owner policies, and version-update trigger.
2. Open `backend/.env` (copy `.env.example` if needed). Set `SUPABASE_URL` to your Project URL and `SUPABASE_PUBLISHABLE_KEY` to the project's publishable key. A legacy anon key also works via `SUPABASE_ANON_KEY`. Obtain these from the project's Connect dialog or API settings. This app does not need a secret or service-role key.
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

Access and refresh tokens stay in HTTP-only SameSite cookies. Every API request uses a separate Supabase client, validates the user with Auth, and sends that user's token to the database so RLS remains active. Expired access tokens are refreshed. Remember enables persistent cookies with a seven-day sliding lifetime; otherwise cookies are browser-session cookies. Supabase Auth settings can further limit session lifetime. Sign-out clears local cookies and revokes the Supabase refresh session; already issued JWTs can remain valid until their expiration, as defined by Supabase Auth.

For production, serve the frontend and `/api` under one HTTPS origin, set `FRONTEND_ORIGIN` to that exact origin, and enable `COOKIE_SECURE=true`. The Vite proxy only applies in development. Use Supabase's abuse protection/CAPTCHA configuration if enabling public anonymous sign-in; this implementation does not include a CAPTCHA UI.

SQLite is no longer read or written. Existing files under `backend/storage/` are preserved as local backups and are not automatically imported into Supabase. Browser-local data is also not automatically imported. Live satellite feeds and scientific processing remain unconnected; the observations are synthetic.

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
| GET | `/api/datasets` | Bundled synthetic product catalog |
| GET | `/api/series` | Bundled synthetic historical observations |

All routes except health and session creation require authentication. Event notes, status, analyst, and working mechanism are editable. Source observations remain fixed in the app. The database owner policies isolate users; a user with their own valid token can modify their own JSON workspace directly through Supabase. The JSON model is intended for this research prototype rather than shared, authoritative source records.

## Verification

Run `npm.cmd test` in `backend/`. API integration tests exercise the real Supabase JavaScript SDK against a protocol fixture, covering password and anonymous sign-in, cookie handling, token refresh, workspace reads/saves, user isolation, conflicts, invalid input, and missing configuration. They do not contact your hosted project.

After applying the migration, run [the SQL policy tests](supabase/tests/workspaces.sql) in the Supabase SQL Editor to verify actual PostgreSQL RLS and version checks. The tests insert temporary users and roll back all changes. Hosted authentication and database connectivity require your project's configuration and must be checked after those values are supplied.
