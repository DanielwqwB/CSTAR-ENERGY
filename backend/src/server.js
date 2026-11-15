import { createServer } from "node:http";
import { createSupabaseStore } from "./supabase.js";
import { parseAtmosphereQuery } from "./atmosphere.js";
import { buildCctfAssessment } from "./cctf.js";
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
const portalRoles = ["ADMIN", "LGU", "RESEARCHER", "RESIDENT"];
const profileStatuses = ["ACTIVE", "SUSPENDED"];
const approvalStatuses = ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"];
const jurisdictionLevels = [
  "NATIONAL", "REGION", "PROVINCE", "CITY", "MUNICIPALITY", "BARANGAY", "LOCAL",
];
const reportStatuses = [
  "PENDING", "UNDER_REVIEW", "ACTION_PLANNED", "RESOLVED", "REJECTED",
];
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function string(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, `Invalid ${name}`);
  return value.trim();
}
function text(value, name, max = 200) {
  if (typeof value !== "string" || value.length > max)
    fail(400, `Invalid ${name}`);
  return value.trim();
}
function profile(value) {
  const name = string(value?.name, "profile name", 100);
  const email = string(value?.email, "profile email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Invalid email");
  return { name, email };
}
function role(profileValue, allowed) {
  if (profileValue.status !== "ACTIVE")
    fail(403, "Account is suspended");
  if (!allowed.includes(profileValue.role))
    fail(403, "You do not have permission to perform this action");
}
function optionalEnum(value, values, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!values.includes(value)) fail(400, `Invalid ${name}`);
  return value;
}
function optionalUuid(value, name) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    fail(400, `Invalid ${name}`);
  return value;
}
function uuidPath(value, name) {
  const id = optionalUuid(value, name);
  if (!id) fail(400, `Invalid ${name}`);
  return id;
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
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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
          service: "ok",
          databaseStatus: store.configured ? "configured" : "not_configured",
          databaseReachable: null,
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
          const currentProfile = await store.getProfile(context);
          if (currentProfile.status !== "ACTIVE")
            fail(403, "Account is suspended");
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
        const currentProfile = await store.getProfile(context);
        sessionCookies(res, context.session, input.remember === true);
        if (currentProfile.status !== "ACTIVE")
          return send(403, { error: "Account is suspended" });
        const data = await store.load(context, initialWorkspace(context.user));
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
      if (path === "/api/me" && req.method === "GET") {
        const currentProfile = await store.getProfile(context);
        return send(200, {
          profile: currentProfile,
          session: {
            expires_at: context.session.expires_at ?? null,
            expires_in: context.session.expires_in ?? null,
            token_type: context.session.token_type ?? "bearer",
          },
        });
      }
      const currentProfile = await store.getProfile(context);
      if (currentProfile.status !== "ACTIVE") fail(403, "Account is suspended");

      if (path === "/api/admin/dashboard" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        return send(200, await store.dashboard(context));
      }
      if (path === "/api/admin/users" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        const query = url.searchParams.get("query")?.trim() || "";
        if (query.length > 100) fail(400, "Invalid query");
        const selectedRole = optionalEnum(url.searchParams.get("role"), portalRoles, "role");
        const selectedStatus = optionalEnum(
          url.searchParams.get("status"), profileStatuses, "status",
        );
        return send(200, {
          users: await store.listAdminUsers(context, {
            query,
            role: selectedRole,
            status: selectedStatus,
          }),
        });
      }
      if (path === "/api/admin/users" && req.method === "POST") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const name = string(input.name, "name", 100);
        const email = string(input.email, "email");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Invalid email");
        if (
          typeof input.password !== "string" ||
          input.password.length < 8 ||
          input.password.length > 1024
        )
          fail(400, "Use a password with at least 8 characters");
        const selectedRole = optionalEnum(input.role, portalRoles, "role") || "RESIDENT";
        const jurisdictionId = optionalUuid(
          input.jurisdiction_id ?? input.jurisdictionId,
          "jurisdiction",
        ) ?? null;
        if (["LGU", "RESEARCHER"].includes(selectedRole) && !jurisdictionId)
          fail(400, "LGU and researcher accounts require a jurisdiction");
        const authUser = await store.createAuthUser({ email, password: input.password, name });
        const user = await store.updateProfile(context, authUser.id, {
          name,
          role: selectedRole,
          status: "ACTIVE",
          approval_status: "NOT_REQUIRED",
          jurisdiction_id: jurisdictionId,
        });
        return send(201, { user });
      }
      const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userMatch && req.method === "PATCH") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const changes = {};
        if (input.name !== undefined) changes.name = string(input.name, "name", 100);
        if (input.role !== undefined) {
          changes.role = optionalEnum(input.role, portalRoles, "role");
          if (!changes.role) fail(400, "Invalid role");
        }
        if (input.status !== undefined) {
          changes.status = optionalEnum(input.status, profileStatuses, "status");
          if (!changes.status) fail(400, "Invalid status");
        }
        if (input.approvalStatus !== undefined || input.approval_status !== undefined) {
          changes.approval_status = optionalEnum(
            input.approvalStatus ?? input.approval_status,
            approvalStatuses,
            "approval status",
          );
          if (!changes.approval_status) fail(400, "Invalid approval status");
        }
        if (input.jurisdiction_id !== undefined || input.jurisdictionId !== undefined) {
          changes.jurisdiction_id = optionalUuid(
            input.jurisdiction_id !== undefined
              ? input.jurisdiction_id
              : input.jurisdictionId,
            "jurisdiction",
          );
        }
        if (!Object.keys(changes).length) fail(400, "No supported profile fields supplied");
        const userId = uuidPath(userMatch[1], "user ID");
        const existing = await store.getProfile(context, userId);
        const finalRole = changes.role || existing.role;
        const finalJurisdiction = changes.jurisdiction_id === undefined
          ? existing.jurisdiction_id
          : changes.jurisdiction_id;
        if (["LGU", "RESEARCHER"].includes(finalRole) && !finalJurisdiction)
          fail(400, "LGU and researcher accounts require a jurisdiction");
        return send(200, {
          user: await store.updateProfile(context, userId, changes),
        });
      }
      if (path === "/api/admin/jurisdictions" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        return send(200, { jurisdictions: await store.listJurisdictions(context) });
      }
      if (path === "/api/admin/jurisdictions" && req.method === "POST") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const name = string(input.name, "jurisdiction name", 200);
        const code = string(input.code, "jurisdiction code", 40);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(code))
          fail(400, "Invalid jurisdiction code");
        const level = optionalEnum(input.level, jurisdictionLevels, "jurisdiction level") || "LOCAL";
        const status = optionalEnum(input.status, profileStatuses, "jurisdiction status") || "ACTIVE";
        const metadata = input.metadata === undefined ? {} : input.metadata;
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
          fail(400, "Invalid jurisdiction metadata");
        return send(201, {
          jurisdiction: await store.createJurisdiction(context, {
            name, code, level, status, metadata,
          }),
        });
      }
      if (path === "/api/admin/reports" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        return send(200, { reports: await store.listReports(context) });
      }
      if (path === "/api/admin/reports" && req.method === "POST") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const jurisdictionId = optionalUuid(
          input.jurisdiction_id ?? input.jurisdictionId,
          "jurisdiction",
        );
        if (!jurisdictionId) fail(400, "Jurisdiction is required");
        const location = input.location === undefined ? {} : input.location;
        if (!location || typeof location !== "object" || Array.isArray(location))
          fail(400, "Invalid report location");
        const report = await store.createReport(context, {
          owner_id: currentProfile.id,
          jurisdiction_id: jurisdictionId,
          title: string(input.title, "report title", 200),
          description: string(input.description, "report description", 10000),
          location,
          status: "PENDING",
        });
        return send(201, { report });
      }
      const adminReportMatch = path.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if (adminReportMatch && req.method === "PATCH") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const changes = {};
        if (input.status !== undefined) {
          changes.status = optionalEnum(input.status, reportStatuses, "report status");
          if (!changes.status) fail(400, "Invalid report status");
        }
        if (input.assigned_to !== undefined || input.assignedTo !== undefined)
          changes.assigned_to = optionalUuid(
            input.assigned_to !== undefined ? input.assigned_to : input.assignedTo,
            "assignee",
          );
        if (!Object.keys(changes).length) fail(400, "No supported report fields supplied");
        return send(200, {
          report: await store.updateReport(
            context,
            uuidPath(adminReportMatch[1], "report ID"),
            changes,
          ),
        });
      }
      if (path === "/api/admin/datasets" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        return send(200, { datasets: await store.listDatasets(context) });
      }
      if (path === "/api/admin/audit-logs" && req.method === "GET") {
        role(currentProfile, ["ADMIN"]);
        return send(200, { logs: await store.listAuditLogs(context) });
      }
      if (path === "/api/reports" && req.method === "GET") {
        role(currentProfile, ["ADMIN", "LGU", "RESEARCHER", "RESIDENT"]);
        return send(200, { reports: await store.listReports(context) });
      }
      if (path === "/api/reports" && req.method === "POST") {
        role(currentProfile, ["RESIDENT"]);
        if (!currentProfile.jurisdiction_id)
          fail(403, "A jurisdiction must be assigned before filing a report");
        const input = await body(req);
        const location = input.location === undefined ? {} : input.location;
        if (!location || typeof location !== "object" || Array.isArray(location))
          fail(400, "Invalid report location");
        const report = await store.createReport(context, {
          owner_id: currentProfile.id,
          jurisdiction_id: currentProfile.jurisdiction_id,
          title: string(input.title, "report title", 200),
          description: string(input.description, "report description", 10000),
          location,
          status: "PENDING",
        });
        return send(201, { report });
      }
      const reportMatch = path.match(/^\/api\/reports\/([^/]+)$/);
      if (reportMatch && req.method === "PATCH") {
        role(currentProfile, ["ADMIN", "LGU"]);
        const input = await body(req);
        const changes = {};
        if (input.status !== undefined) {
          changes.status = optionalEnum(input.status, reportStatuses, "report status");
          if (!changes.status) fail(400, "Invalid report status");
        }
        if (input.assigned_to !== undefined || input.assignedTo !== undefined)
          changes.assigned_to = optionalUuid(
            input.assigned_to !== undefined ? input.assigned_to : input.assignedTo,
            "assignee",
          );
        if (!Object.keys(changes).length) fail(400, "No supported report fields supplied");
        return send(200, {
          report: await store.updateReport(
            context,
            uuidPath(reportMatch[1], "report ID"),
            changes,
          ),
        });
      }
      const adminActionPlans = path === "/api/admin/action-plans";
      if (
        (path === "/api/action-plans" || adminActionPlans) &&
        req.method === "GET"
      ) {
        role(currentProfile, adminActionPlans
          ? ["ADMIN"]
          : ["ADMIN", "LGU", "RESEARCHER"]);
        return send(200, { actionPlans: await store.listActionPlans(context) });
      }
      if (
        (path === "/api/action-plans" || adminActionPlans) &&
        req.method === "POST"
      ) {
        role(currentProfile, adminActionPlans ? ["ADMIN"] : ["ADMIN", "LGU"]);
        const input = await body(req);
        const jurisdictionId = optionalUuid(
          input.jurisdiction_id ?? input.jurisdictionId ??
            (currentProfile.role === "LGU" ? currentProfile.jurisdiction_id : undefined),
          "jurisdiction",
        );
        if (!jurisdictionId) fail(400, "Jurisdiction is required");
        const status = optionalEnum(
          input.status,
          ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"],
          "action plan status",
        ) || "DRAFT";
        const dueDate = input.due_date ?? null;
        if (dueDate !== null) {
          if (
            typeof dueDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
            Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)) ||
            new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate
          )
            fail(400, "Invalid due date");
        }
        return send(201, {
          actionPlan: await store.createActionPlan(context, {
            jurisdiction_id: jurisdictionId,
            created_by: currentProfile.id,
            title: string(input.title, "action plan title", 200),
            description: input.description === undefined
              ? ""
              : text(input.description, "action plan description", 10000),
            status,
            due_date: dueDate,
          }),
        });
      }
      const actionPlanMatch = path.match(/^\/api\/action-plans\/([^/]+)$/);
      if (actionPlanMatch && req.method === "PATCH") {
        role(currentProfile, ["ADMIN", "LGU"]);
        const input = await body(req);
        const status = optionalEnum(
          input.status,
          ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"],
          "action plan status",
        );
        if (!status) fail(400, "Action plan status is required");
        return send(200, {
          actionPlan: await store.updateActionPlan(
            context,
            uuidPath(actionPlanMatch[1], "action plan ID"),
            { status },
          ),
        });
      }
      if (path === "/api/publications" && req.method === "GET") {
        role(currentProfile, ["ADMIN", "LGU", "RESEARCHER", "RESIDENT"]);
        return send(200, { publications: await store.listPublications(context) });
      }
      if (path === "/api/admin/publications" && req.method === "POST") {
        role(currentProfile, ["ADMIN"]);
        const input = await body(req);
        const jurisdictionId = optionalUuid(
          input.jurisdiction_id ?? input.jurisdictionId,
          "jurisdiction",
        );
        const urlValue = string(input.url, "publication URL", 2000);
        let parsedUrl;
        try {
          parsedUrl = new URL(urlValue);
        } catch {
          fail(400, "Invalid publication URL");
        }
        if (!["http:", "https:"].includes(parsedUrl.protocol))
          fail(400, "Invalid publication URL");
        return send(201, {
          publication: await store.createPublication(context, {
            jurisdiction_id: jurisdictionId ?? null,
            created_by: currentProfile.id,
            title: string(input.title, "publication title", 200),
            summary: input.summary === undefined
              ? ""
              : text(input.summary, "publication summary", 10000),
            url: parsedUrl.toString(),
          }),
        });
      }
      if (req.method === "GET" && path === "/api/cctf/assessment") {
        const atmosphereRun = await store.currentAtmosphereRun(context);
        return send(200, buildCctfAssessment({ atmosphereRun }));
      }
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
