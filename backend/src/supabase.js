import { createClient } from "@supabase/supabase-js";

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function databaseError(error) {
  if (!error) return;
  console.error("Supabase database error:", error.code || "unknown");
  fail(
    503,
    "Supabase workspace storage is unavailable. Check the connection and run the SQL migration.",
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
