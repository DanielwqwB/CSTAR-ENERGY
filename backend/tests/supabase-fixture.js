// Protocol fixture for the real Supabase SDK. It does not replace testing RLS in PostgreSQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const demoDatasets = JSON.parse(
  readFileSync(
    new URL("../../frontend/src/data/datasets.json", import.meta.url),
    "utf8",
  ),
);
const demoSeries = JSON.parse(
  readFileSync(
    new URL("../../frontend/src/data/series.json", import.meta.url),
    "utf8",
  ),
);
export function supabaseFixture({
  confirmationRequired = false,
  atmosphere = null,
  profileOverrides = {},
} = {}) {
  const rows = new Map();
  const sessions = new Map();
  const users = new Map();
  const profiles = new Map();
  const portalRows = {
    cstar_jurisdictions: [],
    cstar_community_reports: [],
    cstar_audit_log: [],
    cstar_action_plans: [],
    cstar_publications: [],
  };
  let counter = 0;
  const userId = () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const ensureProfile = (user) => {
    if (!profiles.has(user.id)) {
      const override = profileOverrides[user.email] || {};
      profiles.set(user.id, {
        user_id: user.id,
        name: user.user_metadata?.full_name || "CSTAR User",
        email: user.email || "",
        role: override.role || "RESIDENT",
        status: override.status || "ACTIVE",
        approval_status: override.approval_status || "NOT_REQUIRED",
        jurisdiction_id: override.jurisdiction_id || null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    }
    return profiles.get(user.id);
  };
  const jwt = (user, exp = Math.floor(Date.now() / 1000) + 3600) =>
    [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          exp,
          role: "authenticated",
          aud: "authenticated",
          session_id: `session-${counter}`,
        }),
      ).toString("base64url"),
      Buffer.from("test-signature").toString("base64url"),
    ].join(".");
  function session(user) {
    const refresh_token = `refresh-${++counter}`;
    const access_token = jwt(user);
    sessions.set(refresh_token, { user, access_token });
    return {
      user,
      access_token,
      refresh_token,
      expires_in: 3600,
      token_type: "bearer",
    };
  }
  const response = (data, status = 200, extraHeaders = {}) =>
    new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...extraHeaders },
    });
  return {
    expiredToken: () => jwt({ id: "expired-user" }, 1),
    async fetch(input, options = {}) {
      const url = new URL(input);
      const headers = new Headers(options.headers);
      assert.equal(headers.get("apikey"), "publishable-test-key");
      const body = options.body ? JSON.parse(options.body) : {};
      const method = options.method || "GET";
      if (url.pathname === "/auth/v1/signup") {
        if (body.email) {
          const user = {
            id: userId(),
            email: body.email,
            user_metadata: body.data,
          };
          users.set(body.email, user);
          ensureProfile(user);
          return response(confirmationRequired ? { user } : session(user));
        }
        const user = { id: userId(), is_anonymous: true };
        ensureProfile(user);
        return response(session(user));
      }
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const previous = sessions.get(body.refresh_token);
          if (!previous) return response({ msg: "Expired refresh token" }, 401);
          sessions.delete(body.refresh_token);
          return response(session(previous.user));
        }
        if (body.password !== "test-password")
          return response({ msg: "Invalid credentials" }, 400);
        if (!users.has(body.email)) {
          const user = {
            id: userId(),
            email: body.email,
          };
          users.set(body.email, user);
          ensureProfile(user);
        }
        return response(session(users.get(body.email)));
      }
      const access = headers.get("Authorization")?.replace("Bearer ", "");
      const entry = [...sessions].find(
        ([, value]) => value.access_token === access,
      );
      if (!entry) return response({ msg: "Unauthorized" }, 401);
      const user = entry[1].user;
      if (url.pathname === "/auth/v1/user") return response(user);
      if (url.pathname === "/auth/v1/logout") {
        sessions.delete(entry[0]);
        return response(null, 204);
      }
      if (url.pathname === "/rest/v1/cstar_atmosphere_runs") {
        const published = atmosphere?.run?.status === "published" ? atmosphere.run : null;
        return response(
          headers.get("Accept")?.includes("vnd.pgrst.object")
            ? published
            : published ? [published] : [],
        );
      }
      if (url.pathname === "/rest/v1/cstar_atmosphere_cells") {
        const runId = url.searchParams.get("run_id")?.replace("eq.", "");
        const month = url.searchParams.get("month")?.replace("eq.", "");
        const status = url.searchParams.get("observation_status")?.replace("eq.", "");
        const matching = (atmosphere?.run?.status === "published" ? atmosphere.rows : [])
          .filter((row) => row.run_id === runId && row.month === month)
          .filter((row) => !status || row.observation_status === status)
          .sort((a, b) => a.cell_id.localeCompare(b.cell_id));
        const start = Number(url.searchParams.get("offset") || 0);
        const limit = Number(url.searchParams.get("limit") || 1000);
        const page = matching.slice(start, start + limit).map(({ run_id, ...row }) => row);
        const range = matching.length
          ? `${start}-${start + page.length - 1}/${matching.length}`
          : "*/0";
        return response(page, 200, { "Content-Range": range });
      }
      if (url.pathname === "/rest/v1/cstar_demo_dataset_catalog") {
        return response(
          demoDatasets.map(
            ([name, product, scale, status, description], index) => ({
              sort_order: index + 1,
              name,
              product,
              scale,
              status,
              description,
            }),
          ),
        );
      }
      if (url.pathname === "/rest/v1/cstar_demo_monthly_series") {
        return response(
          demoSeries.map((row, index) => ({
            period_start: `2024-${String(index + 1).padStart(2, "0")}-01`,
            radiance: row.radiance,
            adjusted: row.adjusted,
            no2: row.no2,
            counter: row.counter,
          })),
        );
      }
      if (url.pathname === "/rest/v1/cstar_profiles") {
        const id = url.searchParams.get("user_id")?.replace("eq.", "");
        const current = ensureProfile(user);
        const target = id ? profiles.get(id) : null;
        const isAdmin = current.role === "ADMIN" && current.status === "ACTIVE";
        if (method === "PATCH") {
          if (!isAdmin || !target) return response([]);
          Object.assign(target, structuredClone(body));
          return response([target]);
        }
        let matches = id
          ? target && (isAdmin || id === user.id) ? [target] : []
          : isAdmin ? [...profiles.values()] : [current];
        for (const field of ["role", "status", "approval_status", "jurisdiction_id"]) {
          const value = url.searchParams.get(field)?.replace("eq.", "");
          if (value) matches = matches.filter((item) => item[field] === value);
        }
        for (const field of ["name", "email"]) {
          const value = url.searchParams.get(field);
          if (value?.startsWith("ilike.")) {
            const needle = value.slice(6).replace(/^%|%$/g, "").toLowerCase();
            matches = matches.filter((item) => item[field].toLowerCase().includes(needle));
          }
        }
        if (method === "HEAD")
          return response(null, 200, {
            "Content-Range": matches.length ? `0-${matches.length - 1}/${matches.length}` : "*/0",
          });
        const ordered = url.searchParams.get("order")?.startsWith("created_at.desc")
          ? matches.reverse()
          : matches;
        const limit = Number(url.searchParams.get("limit") || 1000);
        const data = ordered.slice(0, limit);
        return headers.get("Accept")?.includes("vnd.pgrst.object")
          ? response(data[0] || null)
          : response(data);
      }
      const portalTable = url.pathname.match(/^\/rest\/v1\/(cstar_(?:jurisdictions|community_reports|audit_log|action_plans|publications))$/);
      if (portalTable) {
        let matching = portalRows[portalTable[1]];
        for (const [field, raw] of url.searchParams) {
          if (raw.startsWith("eq."))
            matching = matching.filter((item) => String(item[field]) === raw.slice(3));
        }
        if (method === "HEAD")
          return response(null, 200, {
            "Content-Range": matching.length
              ? `0-${matching.length - 1}/${matching.length}`
              : "*/0",
          });
        return response(matching);
      }
      assert.equal(url.pathname, "/rest/v1/cstar_workspaces");
      const owner = url.searchParams.get("user_id")?.replace("eq.", "");
      if (owner && owner !== user.id) return response([]);
      if (method === "POST") {
        assert.equal(body.user_id, user.id);
        if (!rows.has(user.id)) rows.set(user.id, structuredClone(body));
        return response(null, 201);
      }
      if (method === "PATCH") {
        const current = rows.get(user.id);
        if (
          !current ||
          String(current.version) !==
            url.searchParams.get("version")?.replace("eq.", "")
        )
          return response([]);
        rows.set(user.id, { ...current, ...structuredClone(body) });
        return response([{ version: body.version }]);
      }
      const row = rows.get(user.id);
      const data = row ? { data: row.data, version: row.version } : null;
      return headers.get("Accept")?.includes("vnd.pgrst.object")
        ? response(data)
        : response(data ? [data] : []);
    },
  };
}
