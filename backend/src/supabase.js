import { createClient } from "@supabase/supabase-js";

const reportTransitions = {
  PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["ACTION_PLANNED", "RESOLVED", "REJECTED"],
  ACTION_PLANNED: ["UNDER_REVIEW", "RESOLVED"],
  RESOLVED: [],
  REJECTED: [],
};

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function databaseError(error, resource = "workspace storage") {
  if (!error) return;
  console.error("Supabase database error:", error.code || "unknown");
  if (["23502", "23503", "23514", "P0001", "22001", "22003", "22P02"].includes(error.code))
    fail(400, `Invalid ${resource} data`);
  if (error.code === "23505") fail(409, `Conflicting ${resource} already exists`);
  if (error.code === "42501") fail(403, `Not permitted to access ${resource}`);
  fail(
    503,
    `Supabase ${resource} is unavailable. Check the connection and run the SQL migration.`,
  );
}

export function createSupabaseStore({
  url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
  fetch: customFetch = globalThis.fetch,
} = {}) {
  const configured = Boolean(
    url && key && !url.includes("YOUR_PROJECT") && !key.startsWith("YOUR_"),
  );
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  function client() {
    if (!configured)
      fail(
        503,
        "Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in backend/.env.",
      );
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: customFetch },
    });
  }
  function adminClient() {
    if (!configured || !serviceRoleKey)
      fail(503, "User creation requires the backend SUPABASE_SERVICE_ROLE_KEY.");
    return createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: customFetch },
    });
  }
  const portalError = (result, resource) => databaseError(result.error, resource);
  const portalProfileFields =
    "user_id,name,email,role,status,approval_status,jurisdiction_id,created_at,updated_at";
  return {
    configured,
    async getProfile(context, userId = context.user.id) {
      const result = await context.supabase
        .from("cstar_profiles")
        .select(portalProfileFields)
        .eq("user_id", userId)
        .maybeSingle();
      portalError(result, "account profile");
      if (!result.data) {
        if (userId === context.user.id)
          fail(403, "Account profile is unavailable. Apply the portal migration.");
        fail(404, "User not found");
      }
      const { user_id, ...profile } = result.data;
      return { id: user_id, ...profile };
    },
    async listAdminUsers(context, { query, role, status }) {
      const request = () => {
        let builder = context.supabase
          .from("cstar_profiles")
          .select(portalProfileFields)
          .order("created_at", { ascending: false });
        if (role) builder = builder.eq("role", role);
        if (status) builder = builder.eq("status", status);
        return builder;
      };
      if (query) {
        const pattern = `%${query}%`;
        const [names, emails] = await Promise.all([
          request().ilike("name", pattern).limit(1000),
          request().ilike("email", pattern).limit(1000),
        ]);
        portalError(names, "user directory");
        portalError(emails, "user directory");
        const combined = new Map(
          [...(names.data || []), ...(emails.data || [])].map((row) => [row.user_id, row]),
        );
        return [...combined.values()].map(({ user_id, ...profile }) => ({
          id: user_id,
          ...profile,
        }));
      }
      const result = await request().limit(1000);
      portalError(result, "user directory");
      return (result.data || []).map(({ user_id, ...profile }) => ({
        id: user_id,
        ...profile,
      }));
    },
    async createAuthUser({ email, password, name }) {
      const { data, error } = await adminClient().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error) {
        console.error("Supabase Auth admin create failed:", {
          code: error.code || "unknown",
          status: error.status ?? null,
        });
        if (error.code === "email_exists" || error.status === 422)
          fail(409, "An account with that email already exists");
        if (!error.status || error.status >= 500)
          fail(503, "Account creation is temporarily unavailable");
        fail(400, "Unable to create account with the supplied details");
      }
      return data.user;
    },
    async updateProfile(context, userId, changes) {
      const result = await context.supabase
        .from("cstar_profiles")
        .update(changes)
        .eq("user_id", userId)
        .select(portalProfileFields)
        .maybeSingle();
      portalError(result, "account profile");
      if (!result.data) fail(404, "User not found");
      const { user_id, ...profile } = result.data;
      return { id: user_id, ...profile };
    },
    async dashboard(context) {
      const count = (table, column, filters = []) => {
        let query = context.supabase.from(table).select(column, { count: "exact", head: true });
        for (const [field, value] of filters) query = query.eq(field, value);
        return query;
      };
      const [
        users, lgu, researchers, residents, approvals, jurisdictions, reports, activity,
      ] = await Promise.all([
        count("cstar_profiles", "user_id"),
        count("cstar_profiles", "user_id", [["role", "LGU"], ["status", "ACTIVE"]]),
        count("cstar_profiles", "user_id", [["role", "RESEARCHER"], ["status", "ACTIVE"]]),
        count("cstar_profiles", "user_id", [["role", "RESIDENT"]]),
        count("cstar_profiles", "user_id", [["approval_status", "PENDING"]]),
        count("cstar_jurisdictions", "id", [["status", "ACTIVE"]]),
        count("cstar_community_reports", "id", [["status", "PENDING"]]),
        context.supabase
          .from("cstar_audit_log")
          .select("id,actor_id,action,resource_type,resource_id,before_data,after_data,created_at")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      for (const [result, resource] of [
        [users, "dashboard metrics"], [lgu, "dashboard metrics"],
        [researchers, "dashboard metrics"], [residents, "dashboard metrics"],
        [approvals, "dashboard metrics"], [jurisdictions, "dashboard metrics"],
        [reports, "dashboard metrics"], [activity, "audit log"],
      ]) portalError(result, resource);
      return {
        metrics: {
          totalUsers: users.count ?? 0,
          activeLgus: lgu.count ?? 0,
          activeResearchers: researchers.count ?? 0,
          registeredResidents: residents.count ?? 0,
          pendingApprovals: approvals.count ?? 0,
          activeJurisdictions: jurisdictions.count ?? 0,
          pendingReports: reports.count ?? 0,
          failedJobs: null,
        },
        activity: activity.data || [],
      };
    },
    async listJurisdictions(context) {
      const result = await context.supabase
        .from("cstar_jurisdictions")
        .select("id,name,code,level,status,metadata,created_at,updated_at")
        .order("name", { ascending: true });
      portalError(result, "jurisdictions");
      return result.data || [];
    },
    async createJurisdiction(context, data) {
      const result = await context.supabase
        .from("cstar_jurisdictions")
        .insert(data)
        .select("id,name,code,level,status,metadata,created_at,updated_at")
        .single();
      portalError(result, "jurisdiction");
      return result.data;
    },
    async listReports(context) {
      const result = await context.supabase
        .from("cstar_community_reports")
        .select("id,owner_id,jurisdiction_id,assigned_to,title,description,location,status,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      portalError(result, "community reports");
      return result.data || [];
    },
    async createReport(context, data) {
      const result = await context.supabase
        .from("cstar_community_reports")
        .insert(data)
        .select("id,owner_id,jurisdiction_id,assigned_to,title,description,location,status,created_at,updated_at")
        .single();
      portalError(result, "community report");
      return result.data;
    },
    async updateReport(context, reportId, changes) {
      const current = await context.supabase
        .from("cstar_community_reports")
        .select("status")
        .eq("id", reportId)
        .maybeSingle();
      portalError(current, "community report");
      if (!current.data) fail(404, "Community report not found");
      if (
        changes.status &&
        changes.status !== current.data.status &&
        !reportTransitions[current.data.status]?.includes(changes.status)
      )
        fail(400, "Invalid community report status transition");
      const result = await context.supabase
        .from("cstar_community_reports")
        .update(changes)
        .eq("id", reportId)
        .select("id,owner_id,jurisdiction_id,assigned_to,title,description,location,status,created_at,updated_at")
        .maybeSingle();
      portalError(result, "community report");
      if (!result.data) fail(404, "Community report not found");
      return result.data;
    },
    async listDatasets(context) {
      const result = await context.supabase
        .from("cstar_demo_dataset_catalog")
        .select("dataset_id,name,product,scale,status,description,classification")
        .order("sort_order", { ascending: true });
      portalError(result, "dataset catalog");
      return result.data || [];
    },
    async listAuditLogs(context) {
      const result = await context.supabase
        .from("cstar_audit_log")
        .select("id,actor_id,action,resource_type,resource_id,before_data,after_data,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      portalError(result, "audit log");
      return result.data || [];
    },
    async listActionPlans(context) {
      const result = await context.supabase
        .from("cstar_action_plans")
        .select("id,jurisdiction_id,created_by,title,description,status,due_date,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      portalError(result, "action plans");
      return result.data || [];
    },
    async createActionPlan(context, data) {
      const result = await context.supabase
        .from("cstar_action_plans")
        .insert(data)
        .select("id,jurisdiction_id,created_by,title,description,status,due_date,created_at,updated_at")
        .single();
      portalError(result, "action plan");
      return result.data;
    },
    async updateActionPlan(context, planId, changes) {
      const result = await context.supabase
        .from("cstar_action_plans")
        .update(changes)
        .eq("id", planId)
        .select("id,jurisdiction_id,created_by,title,description,status,due_date,created_at,updated_at")
        .maybeSingle();
      portalError(result, "action plan");
      if (!result.data) fail(404, "Action plan not found");
      return result.data;
    },
    async listPublications(context) {
      const result = await context.supabase
        .from("cstar_publications")
        .select("id,jurisdiction_id,created_by,title,summary,url,published_at,created_at,updated_at")
        .order("published_at", { ascending: false })
        .limit(1000);
      portalError(result, "publications");
      return result.data || [];
    },
    async createPublication(context, data) {
      const result = await context.supabase
        .from("cstar_publications")
        .insert(data)
        .select("id,jurisdiction_id,created_by,title,summary,url,published_at,created_at,updated_at")
        .single();
      portalError(result, "publication");
      return result.data;
    },
    async signup(input) {
      const supabase = client();
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { full_name: input.name },
          emailRedirectTo: input.redirectTo,
        },
      });
      if (error) {
        console.error("Supabase Auth signup failed:", {
          status: error.status ?? null,
          code: error.code || "unknown",
        });
        if (error.status === 429)
          fail(429, "Too many signup requests. Please try again later.");
        if (!error.status || error.status >= 500)
          fail(
            503,
            "Account registration is unavailable. Please try again later.",
          );
        fail(
          400,
          "Unable to create an account. Check your details and the project signup settings.",
        );
      }
      return { supabase, user: data.user, session: data.session };
    },
    async login(input) {
      const supabase = client();
      const { data, error } = input.demo
        ? await supabase.auth.signInAnonymously()
        : await supabase.auth.signInWithPassword({
            email: input.email,
            password: input.password,
          });
      if (error || !data.session || !data.user) {
        if (error && (!error.status || error.status >= 500))
          fail(
            503,
            "Supabase Auth is unavailable. Check your project URL and connection.",
          );
        if (error?.status === 429)
          fail(429, "Supabase sign-in rate limit reached. Try again later.");
        if (input.demo)
          fail(
            403,
            "Demo access requires Anonymous Sign-Ins to be enabled in Supabase Auth.",
          );
        fail(
          401,
          "Invalid email or password, or the email has not been confirmed.",
        );
      }
      return { supabase, user: data.user, session: data.session };
    },
    async authenticate(cookies) {
      if (!cookies.cstar_refresh) fail(401, "Sign in to continue");
      const supabase = client();
      // Each request gets its own client; user sessions are never shared across requests.
      const { data, error } = cookies.cstar_access
        ? await supabase.auth.setSession({
            access_token: cookies.cstar_access || "",
            refresh_token: cookies.cstar_refresh,
          })
        : await supabase.auth.refreshSession({
            refresh_token: cookies.cstar_refresh,
          });
      if (error || !data.session) fail(401, "Session expired. Sign in again.");
      const verified = await supabase.auth.getUser();
      if (verified.error || !verified.data.user)
        fail(401, "Session expired. Sign in again.");
      return { supabase, user: verified.data.user, session: data.session };
    },
    async logout(context) {
      const { error } = await context.supabase.auth.signOut({ scope: "local" });
      if (error) fail(503, "Could not sign out of Supabase. Try again.");
    },
    async currentAtmosphereRun(context) {
      const result = await context.supabase
        .from("cstar_atmosphere_runs")
        .select("run_id,model_name,anomaly_interpretation,start_month,end_month,total_cell_months,published_at,manifest")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      databaseError(result.error, "atmospheric data");
      return result.data;
    },
    async listDemoDatasets(context) {
      const result = await context.supabase
        .from("cstar_demo_dataset_catalog")
        .select("name,product,scale,status,description")
        .order("sort_order", { ascending: true });
      databaseError(result.error, "sample dataset catalog");
      return result.data.map(({ name, product, scale, status, description }) => [
        name,
        product,
        scale,
        status,
        description,
      ]);
    },
    async listDemoSeries(context) {
      const result = await context.supabase
        .from("cstar_demo_monthly_series")
        .select("period_start,radiance,adjusted,no2,counter")
        .order("period_start", { ascending: true });
      databaseError(result.error, "sample chart series");
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return result.data.map((row) => ({
        month: months[Number(row.period_start.slice(5, 7)) - 1],
        radiance: row.radiance,
        adjusted: row.adjusted,
        no2: row.no2,
        counter: row.counter,
      }));
    },
    async listAtmosphereCells(context, { runId, month, limit, offset, status }) {
      let query = context.supabase
        .from("cstar_atmosphere_cells")
        .select(
          "month,cell_id,latitude,longitude,observation_status,qa_mean,valid_orbit_count,valid_pixel_count,coverage_fraction,source_product,expected_no2_umol_m2,observed_no2_umol_m2,anomaly_umol_m2,interval_lower_umol_m2,interval_upper_umol_m2,significant_anomaly",
          { count: "exact" },
        )
        .eq("run_id", runId)
        .eq("month", month);
      if (status) query = query.eq("observation_status", status);
      const result = await query
        .order("cell_id", { ascending: true })
        .range(offset, offset + limit - 1);
      databaseError(result.error, "atmospheric data");
      return { rows: result.data || [], total: result.count ?? 0 };
    },
    async load(context, initial) {
      const table = () => context.supabase.from("cstar_workspaces");
      let result = await table()
        .select("data,version")
        .eq("user_id", context.user.id)
        .maybeSingle();
      databaseError(result.error);
      if (!result.data) {
        // Ignore a concurrent first-load insert without overwriting the existing workspace.
        const created = await table().upsert(
          { user_id: context.user.id, data: initial, version: 0 },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
        databaseError(created.error);
        result = await table()
          .select("data,version")
          .eq("user_id", context.user.id)
          .single();
        databaseError(result.error);
      }
      return { ...result.data.data, version: result.data.version };
    },
    async save(context, data, version) {
      const result = await context.supabase
        .from("cstar_workspaces")
        .update({ data, version: version + 1 })
        .eq("user_id", context.user.id)
        .eq("version", version)
        .select("version")
        .maybeSingle();
      databaseError(result.error);
      if (!result.data)
        fail(409, "Workspace changed in another tab. Reload before saving.");
      return { ...data, version: result.data.version };
    },
  };
}
