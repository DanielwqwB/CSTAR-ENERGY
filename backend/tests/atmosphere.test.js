import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { createSupabaseStore } from "../src/supabase.js";
import { supabaseFixture } from "./supabase-fixture.js";

const run = {
  run_id: "a".repeat(64),
  status: "published",
  model_name: "spatial_seasonal_climatology",
  anomaly_interpretation: "climatology residual",
  start_month: "2025-01-01",
  end_month: "2025-12-01",
  total_cell_months: 3,
  published_at: "2026-11-14T00:00:00Z",
  manifest: { format_version: 1, valid_observations: 2 },
};
const rows = [
  {
    run_id: run.run_id,
    month: "2025-01-01",
    cell_id: "x0001",
    observation_status: "valid",
    expected_no2_umol_m2: 10,
    observed_no2_umol_m2: 12,
    anomaly_umol_m2: 2,
    significant_anomaly: false,
  },
  {
    run_id: run.run_id,
    month: "2025-01-01",
    cell_id: "x0002",
    observation_status: "no_observation",
    expected_no2_umol_m2: 8,
    observed_no2_umol_m2: null,
    anomaly_umol_m2: null,
    significant_anomaly: null,
  },
  {
    run_id: run.run_id,
    month: "2025-01-01",
    cell_id: "x0003",
    observation_status: "valid",
    expected_no2_umol_m2: 11,
    observed_no2_umol_m2: 9,
    anomaly_umol_m2: -2,
    significant_anomaly: true,
  },
];

async function start(atmosphere) {
  const fixture = supabaseFixture({ atmosphere });
  const store = createSupabaseStore({
    url: "http://supabase.test",
    key: "publishable-test-key",
    fetch: fixture.fetch,
  });
  const app = createApp({ store });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  let cookies = "";
  return {
    close: () => new Promise((resolve, reject) =>
      app.close((error) => error ? reject(error) : resolve())
    ),
    async request(path, method = "GET", body) {
      const response = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, {
        method,
        headers: {
          Cookie: cookies,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length) cookies = setCookies
        .map((item) => item.split(";", 1)[0]).join("; ");
      return { status: response.status, data: await response.json() };
    },
  };
}

test("atmosphere endpoints require authentication and page only published rows", async () => {
  const client = await start({ run, rows });
  try {
    assert.equal((await client.request("/atmosphere/manifest")).status, 401);
    const login = await client.request("/session", "POST", {
      email: "analyst@example.com", password: "test-password",
    });
    assert.equal(login.status, 200);
    const manifest = await client.request("/atmosphere/manifest");
    assert.equal(manifest.status, 200);
    assert.equal(manifest.data.run_id, run.run_id);
    assert.equal(manifest.data.anomaly_interpretation, "climatology residual");
    const first = await client.request("/atmosphere/no2?month=2025-01&limit=1");
    assert.equal(first.status, 200);
    assert.equal(first.data.total, 3);
    assert.equal(first.data.rows.length, 1);
    assert.equal(first.data.rows[0].cell_id, "x0001");
    const missing = await client.request("/atmosphere/no2?month=2025-01&limit=1&offset=1");
    assert.equal(missing.data.rows[0].observation_status, "no_observation");
    assert.equal(missing.data.rows[0].anomaly_umol_m2, null);
    const valid = await client.request("/atmosphere/no2?month=2025-01&status=valid");
    assert.equal(valid.data.total, 2);
    assert.equal(valid.data.rows.length, 2);
    assert.equal((await client.request("/atmosphere/no2?month=2025-01&limit=1001")).status, 400);
    assert.equal((await client.request("/atmosphere/no2?month=2025-13")).status, 400);
    assert.equal((await client.request("/atmosphere/no2?month=2024-12")).status, 400);
    assert.equal((await client.request("/atmosphere/no2?month=2025-01&status=invalid")).status, 400);
  } finally {
    await client.close();
  }
});

test("an authenticated request reports an unpublished atmospheric dataset", async () => {
  const client = await start(null);
  try {
    assert.equal((await client.request("/session", "POST", {
      email: "analyst@example.com", password: "test-password",
    })).status, 200);
    const response = await client.request("/atmosphere/manifest");
    assert.equal(response.status, 503);
    assert.match(response.data.error, /No published/);
  } finally {
    await client.close();
  }
});
