import { createClient } from "@supabase/supabase-js";

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function databaseError(error, resource = "workspace storage") {
  if (!error) return;
  console.error("Supabase database error:", error.code || "unknown");
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
  return {
    configured,
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
