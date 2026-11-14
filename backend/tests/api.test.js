import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { createSupabaseStore } from "../src/supabase.js";
import { supabaseFixture } from "./supabase-fixture.js";

async function start(fixture, options = {}) {
  const store = createSupabaseStore({
    url: "http://supabase.test",
    key: "publishable-test-key",
    fetch: fixture.fetch,
  });
  const app = createApp({ store, demo: true, ...options });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const cookies = new Map();
  return {
    cookies,
    close: () =>
      new Promise((resolve, reject) =>
        app.close((error) => (error ? reject(error) : resolve())),
      ),
    async request(path, method = "GET", body, headers = {}) {
      const response = await fetch(
        `http://127.0.0.1:${app.address().port}/api${path}`,
        {
          method,
          headers: {
            Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(";")[0].split("=");
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      return {
        status: response.status,
        headers: response.headers,
        data: await response.json(),
      };
    },
  };
}
const credentials = {
  email: "analyst@example.com",
  password: "test-password",
  remember: true,
};
test("signup validates input and seeds a named workspace when confirmation is disabled", async () => {
  const client = await start(supabaseFixture());
  try {
    const input = {
      name: "New Analyst",
      email: "new@example.com",
      password: "test-password",
      remember: true,
    };
    assert.equal(
      (await client.request("/signup", "POST", { ...input, password: "short" }))
        .status,
      400,
    );
    assert.equal(
      (await client.request("/signup", "POST", { ...input, email: "invalid" }))
        .status,
      400,
    );
    const created = await client.request("/signup", "POST", input);
    assert.equal(created.status, 201);
    assert.equal(created.data.confirmationRequired, false);
    assert.equal(created.data.workspace.profile.name, input.name);
    assert.equal(
      (await client.request("/workspace")).data.profile.email,
      input.email,
    );
    await client.request("/session", "DELETE");
    assert.equal((await client.request("/workspace")).status, 401);
  } finally {
    await client.close();
  }
});
test("signup awaiting email confirmation does not authenticate or create a workspace", async () => {
  const client = await start(supabaseFixture({ confirmationRequired: true }));
  try {
    const result = await client.request("/signup", "POST", {
      name: "New Analyst",
      email: "new@example.com",
      password: "test-password",
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.confirmationRequired, true);
    assert.equal(client.cookies.size, 0);
    assert.equal((await client.request("/workspace")).status, 401);
  } finally {
    await client.close();
  }
});
test("Supabase SDK auth, workspace saves, validation, conflicts, and reloads", async () => {
  const fixture = supabaseFixture();
  let client = await start(fixture);
  try {
    assert.equal((await client.request("/workspace")).status, 401);
    assert.equal((await client.request("/health")).data.database, "supabase");
    assert.equal(
      (
        await client.request("/session", "POST", credentials, {
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    const login = await client.request("/session", "POST", credentials);
    assert.equal(login.status, 200);
    assert.match(login.headers.getSetCookie().join(";"), /HttpOnly/);
    assert.match(login.headers.getSetCookie().join(";"), /Max-Age=604800/);
    assert.equal(login.data.events.length, 4);
    const data = structuredClone(login.data);
    data.events[0].notes = "Verify the commissioning date.";
    data.events[0].status = "Reviewed";
    data.events[0].mechanism = "Unresolved";
    data.records.push({
      id: "TEST-1",
      name: "Field report",
      eventId: data.events[0].id,
      level: "Level A — Primary record",
    });
    data.profile = { name: "Test Analyst", email: "test@example.com" };
    assert.equal(
      (await client.request("/workspace", "PUT", { ...data, events: [] }))
        .status,
      400,
    );
    assert.equal((await client.request("/workspace", "PUT", null)).status, 400);
    assert.equal(
      (await client.request("/workspace", "PUT", { ...data, records: [null] }))
        .status,
      400,
    );
    const invalid = structuredClone(data);
    invalid.events[0].status = "Made up";
    assert.equal(
      (await client.request("/workspace", "PUT", invalid)).status,
      400,
    );
    assert.equal((await client.request("/workspace", "PUT", data)).status, 200);
    assert.equal((await client.request("/workspace", "PUT", data)).status, 409);
    assert.equal(
      (await client.request("/events?status=Reviewed")).data.length,
      1,
    );
    assert.equal(
      (await client.request("/events/DEMO-001")).data.notes,
      data.events[0].notes,
    );
    assert.equal((await client.request("/events/missing")).status, 404);
    assert.equal((await client.request("/datasets")).data.length, 5);
    assert.equal((await client.request("/session", "DELETE")).status, 200);
    assert.equal(client.cookies.size, 0);
    assert.equal((await client.request("/workspace")).status, 401);
    await client.close();
    client = await start(fixture);
    const restored = await client.request("/session", "POST", credentials);
    assert.equal(restored.data.events[0].notes, data.events[0].notes);
    assert.equal(restored.data.records[0].name, "Field report");
    assert.equal(restored.data.profile.name, "Test Analyst");
    assert.equal(restored.data.version, 1);
  } finally {
    await client.close();
  }
});
test("separate users, anonymous workspaces, refresh rotation, rejected credentials, and disabled demo", async () => {
  const fixture = supabaseFixture();
  const first = await start(fixture);
  const second = await start(fixture, { demo: false });
  try {
    assert.equal(
      (await second.request("/session", "POST", { demo: "true" })).status,
      400,
    );
    assert.equal(
      (await second.request("/session", "POST", { demo: true })).status,
      403,
    );
    assert.equal(
      (
        await second.request("/session", "POST", {
          ...credentials,
          password: "wrong",
        })
      ).status,
      401,
    );
    const a = await first.request("/session", "POST", credentials);
    const b = await second.request("/session", "POST", {
      ...credentials,
      email: "other@example.com",
    });
    const change = structuredClone(a.data);
    change.events[0].notes = "Private to first user";
    await first.request("/workspace", "PUT", change);
    assert.equal(
      (await second.request("/workspace")).data.events[0].notes,
      undefined,
    );
    assert.equal(b.data.version, 0);
    const oldRefresh = first.cookies.get("cstar_refresh");
    first.cookies.set("cstar_access", fixture.expiredToken());
    assert.equal((await first.request("/workspace")).status, 200);
    assert.notEqual(first.cookies.get("cstar_refresh"), oldRefresh);
    await first.request("/session", "DELETE");
    const anonymous = await first.request("/session", "POST", { demo: true });
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.data.profile.name, "Demo Analyst");
    assert.equal(anonymous.data.events[0].notes, undefined);
  } finally {
    await first.close();
    await second.close();
  }
});
test("missing Supabase configuration fails clearly", async () => {
  const client = await start(supabaseFixture(), {
    store: createSupabaseStore({ url: "", key: "" }),
  });
  try {
    assert.equal((await client.request("/health")).status, 503);
    const result = await client.request("/session", "POST", credentials);
    assert.equal(result.status, 503);
    assert.match(result.data.error, /SUPABASE_URL/);
  } finally {
    await client.close();
  }
});
