import { createServer } from "node:http";
import { createSupabaseStore } from "./supabase.js";
import { parseAtmosphereQuery } from "./atmosphere.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readData = (name) =>
  JSON.parse(
    readFileSync(resolve(root, `frontend/src/data/${name}.json`), "utf8"),
  );
const seed = readData("events");
const statuses = [
  "Pending Review",
  "Under Investigation",
  "Additional Evidence Required",
  "Reviewed",
  "Unresolved",
];
const regions = [
  "Aurelia Pilot Locality",
  "North District Subset",
  "Eastport Study Area",
];
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function string(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, `Invalid ${name}`);
  return value.trim();
}
function profile(value) {
  const name = string(value?.name, "profile name", 100);
  const email = string(value?.email, "profile email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Invalid email");
  return { name, email };
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 262144) fail(413, "Request too large");
  }
  let parsed;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    fail(400, "Invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail(400, "Expected a JSON object");
  return parsed;
}
export function createApp({
  store = createSupabaseStore(),
  demo = process.env.DEMO_ACCESS === "true",
  origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173",
} = {}) {
  const attempts = new Map();
  const initialWorkspace = (user) => ({
    events: seed,
    records: [],
    region: regions[0],
    profile: {
      name: user.is_anonymous
        ? "Demo Analyst"
        : user.user_metadata?.full_name || "Research Analyst",
      email: user.email || "analyst@cstar.demo",
    },
  });
  function cookies(req) {
    return Object.fromEntries(
      (req.headers.cookie || "").split(";").map((value) => {
        const index = value.indexOf("=");
        return index < 0
          ? ["", ""]
          : [value.slice(0, index).trim(), value.slice(index + 1)];
      }),
    );
  }
  function sessionCookies(res, session, remember, clear = false) {
    const suffix = `; HttpOnly; SameSite=Strict; Path=/api${clear ? "; Max-Age=0" : remember ? "; Max-Age=604800" : ""}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
    res.setHeader("Set-Cookie", [
      `cstar_access=${clear ? "" : session.access_token}${suffix}`,
      `cstar_refresh=${clear ? "" : session.refresh_token}${suffix}`,
      `cstar_remember=${clear ? "" : remember ? "1" : "0"}${suffix}`,
      "cstar_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0",
    ]);
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      if (req.headers.origin && req.headers.origin !== origin)
        fail(403, "Origin not allowed");
      if (req.headers.origin === origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return send(204, null);
      }
      if (
        !["GET", "DELETE"].includes(req.method) &&
        !req.headers["content-type"]?.startsWith("application/json")
      )
        fail(415, "Use application/json");
      if (path === "/api/health" && req.method === "GET")
        return send(store.configured ? 200 : 503, {
          status: store.configured ? "ok" : "configuration_required",
          database: "supabase",
          dataset: "synthetic-v0.4",
        });
      if (
        ["/api/session", "/api/signup"].includes(path) &&
        req.method === "POST"
      ) {
        const input = await body(req);
        if (input.demo !== undefined && typeof input.demo !== "boolean")
          fail(400, "Invalid demo option");
        const key = req.socket.remoteAddress;
        const now = Date.now();
        const attempt = attempts.get(key) || { count: 0, until: now + 60000 };
        if (attempt.until < now) {
          attempt.count = 0;
          attempt.until = now + 60000;
        }
        if (++attempt.count > 20)
          fail(429, "Too many sign-in attempts. Try again in a minute.");
        attempts.set(key, attempt);
        if (path === "/api/signup") {
          const name = string(input.name, "name", 100);
          const email = string(input.email, "email");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            fail(400, "Enter a valid email");
          if (
            typeof input.password !== "string" ||
            input.password.length < 8 ||
            input.password.length > 1024
          )
            fail(400, "Use a password with at least 8 characters");
          const context = await store.signup({
            name,
            email,
            password: input.password,
            redirectTo: origin,
          });
          if (!context.session)
            return send(200, {
              confirmationRequired: true,
              message:
                "Check your inbox for a confirmation link, then sign in.",
            });
          const workspace = await store.load(
            context,
            initialWorkspace(context.user),
          );
          sessionCookies(res, context.session, input.remember === true);
          return send(201, { confirmationRequired: false, workspace });
        }
        if (input.demo === true && !demo)
          fail(
            403,
            "Demo access is disabled. Sign in with your Supabase account.",
          );
        if (!input.demo) {
          string(input.email, "email");
          string(input.password, "password", 1024);
        }
        const context = await store.login(input);
        const data = await store.load(context, initialWorkspace(context.user));
        sessionCookies(res, context.session, input.remember === true);
        return send(200, data);
      }
      const savedCookies = cookies(req);
      const context = await store.authenticate(savedCookies);
      if (path === "/api/session" && req.method === "DELETE") {
        await store.logout(context);
        sessionCookies(res, null, false, true);
        return send(200, { ok: true });
      }
      sessionCookies(res, context.session, savedCookies.cstar_remember === "1");
      if (req.method === "GET" && path.startsWith("/api/atmosphere/")) {
        if (!["/api/atmosphere/manifest", "/api/atmosphere/no2"].includes(path))
          fail(404, "Route not found");
        const run = await store.currentAtmosphereRun(context);
        if (!run) fail(503, "No published atmospheric export is available");
        if (path === "/api/atmosphere/manifest") return send(200, run);
        const query = parseAtmosphereQuery(url.searchParams);
        if (query.month < run.start_month || query.month > run.end_month)
          fail(400, "Month outside the published atmospheric export");
        const result = await store.listAtmosphereCells(context, {
          runId: run.run_id,
          ...query,
        });
        return send(200, {
          run_id: run.run_id,
          model_name: run.model_name,
          anomaly_interpretation: run.anomaly_interpretation,
          month: query.month.slice(0, 7),
          limit: query.limit,
          offset: query.offset,
          total: result.total,
          rows: result.rows,
        });
      }
      if (req.method === "GET" && path === "/api/datasets")
        return send(200, await store.listDemoDatasets(context));
      if (req.method === "GET" && path === "/api/series")
        return send(200, await store.listDemoSeries(context));
      const current = await store.load(context, initialWorkspace(context.user));
      if (path === "/api/workspace" && req.method === "GET")
        return send(200, current);
      if (path === "/api/workspace" && req.method === "PUT") {
        const input = await body(req);
        if (
          !Number.isInteger(input.version) ||
          input.version < 0 ||
          input.version >= 2147483647
        )
          fail(400, "Workspace version required");
        if (!regions.includes(input.region)) fail(400, "Invalid study region");
        if (!Array.isArray(input.events) || input.events.length !== seed.length)
          fail(400, "Invalid events");
        const events = seed.map((original) => {
          const edits = input.events.filter((e) => e?.id === original.id);
          if (edits.length !== 1) fail(400, "Invalid event ID");
          const edit = edits[0];
          if (!statuses.includes(edit.status))
            fail(400, "Invalid event status");
          if (
            edit.notes !== undefined &&
            (typeof edit.notes !== "string" || edit.notes.length > 20000)
          )
            fail(400, "Invalid notes");
          return {
            ...original,
            mechanism: string(edit.mechanism, "mechanism", 300),
            status: edit.status,
            analyst: string(edit.analyst, "analyst", 100),
            ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
          };
        });
        if (!Array.isArray(input.records) || input.records.length > 1000)
          fail(400, "Invalid records");
        const ids = new Set();
        const records = input.records.map((r) => {
          const id = string(r?.id, "record ID", 100);
          if (ids.has(id) || !seed.some((e) => e.id === r.eventId))
            fail(400, "Duplicate record or invalid event");
          ids.add(id);
          const level = string(r.level, "evidence level");
          if (!/^Level [ABC] [—–-] .+/.test(level))
            fail(400, "Invalid evidence level");
          return {
            id,
            name: string(r.name, "record name", 500),
            level,
            eventId: r.eventId,
          };
        });
        const data = {
          events,
          records,
          region: input.region,
          profile: profile(input.profile),
        };
        return send(200, await store.save(context, data, input.version));
      }
      if (req.method === "GET" && path === "/api/events")
        return send(
          200,
          current.events.filter(
            (e) =>
              (!url.searchParams.get("status") ||
                e.status === url.searchParams.get("status")) &&
              (!url.searchParams.get("q") ||
                JSON.stringify(e)
                  .toLowerCase()
                  .includes(url.searchParams.get("q").toLowerCase())),
          ),
        );
      if (req.method === "GET" && path.startsWith("/api/events/")) {
        const event = current.events.find((e) => e.id === path.slice(12));
        if (!event) fail(404, "Event not found");
        return send(200, event);
      }
      if (req.method === "GET" && path === "/api/records")
        return send(200, current.records);
      fail(404, "Route not found");
    } catch (error) {
      if (!error.status) console.error(error);
      send(error.status || 500, {
        error: error.status ? error.message : "Internal server error",
      });
    }
  });

  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`CSTAR API listening at http://127.0.0.1:${port}`),
  );
}
