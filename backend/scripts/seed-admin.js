import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("The development admin seeder is disabled in production.");
  if (process.env.NODE_ENV !== "development" ||
      process.env.ENABLE_DEV_ADMIN_SEEDER !== "true")
    throw new Error(
      "Set NODE_ENV=development and ENABLE_DEV_ADMIN_SEEDER=true to enable this seeder.",
    );

  const url = required("SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("DEV_ADMIN_EMAIL");
  const password = required("DEV_ADMIN_PASSWORD");
  const name = process.env.DEV_ADMIN_NAME?.trim() || "Development Administrator";
  if (password.length < 8 || password.length > 1024)
    throw new Error("DEV_ADMIN_PASSWORD must contain between 8 and 1024 characters.");

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let user;
  for (let page = 1; ; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Could not check for an existing development account.");
    user = result.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );
    if (user || result.data.users.length < 1000) break;
  }
  if (!user) {
    const created = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (created.error) throw new Error("Could not create the development admin account.");
    user = created.data.user;
  }

  const profile = await supabase.from("cstar_profiles").upsert(
    {
      user_id: user.id,
      name,
      email: user.email || email,
      role: "ADMIN",
      status: "ACTIVE",
      approval_status: "APPROVED",
    },
    { onConflict: "user_id" },
  );
  if (profile.error)
    throw new Error("Could not assign the development admin profile; apply the portal migration.");
  console.log("Development admin account seeded.");
}

main().catch((error) => {
  console.error(error.message || "Development admin seeding failed.");
  process.exitCode = 1;
});
