import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

const manifest = {
  formatVersion: 1,
  region: "Bicol Region",
  bounds: [122.3, 11.4, 124.7, 14.6] as [number, number, number, number],
  product: "VNP46A3 Collection 2",
  layer: "AllAngle_Composite_Snow_Free",
  units: "nWatts/(cm^2 sr)",
  quality: "Direct good-quality land/coastal cells with observations.",
  cellCount: 131440,
  months: ["2016-01", "2025-12", "2026-10"],
  forecastMonths: ["2025-12", "2026-11"],
  latestObservedMonth: "2026-10",
  futureForecastMonth: "2026-11",
  observedValueFormat: "float32 radiance and uint16 counts",
  forecastValueFormat: "float32 radiance and probability",
  gridValueFormat: "float32 longitude and latitude",
  model: "Random Forest cell-level one-calendar-month-ahead forecast",
  metrics: {
    regression: { mae: 0.1168, rmse: 0.3714 },
    direction: {
      accuracy: 0.7189,
      balanced_accuracy: 0.6728,
      precision: 0.178,
      recall: 0.617,
      f1: 0.2763,
      roc_auc: 0.7501,
    },
    test_samples: 180000,
    test_pairs: 15,
    test_period: { start: "2024-09", end: "2026-10" },
    target: "one-calendar-month-ahead cell radiance and direction",
    feature_names: [
      "longitude",
      "latitude",
      "previous_month_radiance",
      "target_month_sin",
      "target_month_cos",
    ],
    disclaimer: "Exploratory cell-level radiance screening.",
  },
  disclaimer: "Predictions do not establish causal impact.",
};

const emptyCells = { type: "FeatureCollection", features: [] };
const workspace = {
  events: [],
  records: [],
  region: "Bicol Region",
  profile: { name: "Test Analyst", email: "analyst@example.test" },
  version: 1,
};
const account = (role: "ADMIN" | "RESEARCHER" = "RESEARCHER") => ({
  profile: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Test Analyst",
    email: "analyst@example.test",
    role,
    status: "ACTIVE",
    approval_status: "NOT_REQUIRED",
    jurisdiction_id: null,
  },
});

function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

vi.mock("../src/data/blackMarble", () => ({
  loadBlackMarbleManifest: vi.fn(async () => manifest),
  loadBlackMarbleMonth: vi.fn(async () => emptyCells),
  loadBlackMarbleForecast: vi.fn(async () => emptyCells),
}));

vi.mock("mapbox-gl", () => ({ default: { supported: () => false } }));

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
    String(input) === "/api/me" ? response(account()) : response(workspace),
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPage(name: string) {
  const user = userEvent.setup();
  render(<App />);
  const navigation = await screen.findByRole("navigation", {
    name: "Dataset workspace navigation",
  });
  await user.click(within(navigation).getByRole("button", { name }));
  return user;
}

describe("dataset workspace", () => {
  it("signs out and returns to sign-in so another account can be used", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return response({ ok: true });
      return String(input) === "/api/me" ? response(account()) : response(workspace);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("navigation", {
      name: "Dataset workspace navigation",
    });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: /Beyond monitoring/ })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) =>
      input === "/api/session" && init?.method === "DELETE",
    )).toBe(true);
  });

  it("denies non-admin accounts that visit an admin route", async () => {
    window.history.replaceState(null, "", "/admin/dashboard");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  });

  it("routes administrator accounts to the real platform dashboard", async () => {
    const dashboard = {
      metrics: {
        totalUsers: 12,
        activeLgus: 3,
        activeResearchers: 2,
        registeredResidents: 7,
        pendingApprovals: 1,
        activeJurisdictions: 4,
        pendingReports: 2,
        failedJobs: null,
      },
      activity: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/me") return response(account("ADMIN"));
      if (path === "/api/admin/dashboard") return response(dashboard);
      if (path === "/api/health") {
        return response({
          status: "ok",
          service: "ok",
          databaseStatus: "configured",
          databaseReachable: null,
        });
      }
      if (path === "/api/admin/users") return response({ users: [] });
      if (path === "/api/admin/jurisdictions") return response({ jurisdictions: [] });
      return response(workspace);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Platform operations" })).toBeTruthy();
    expect(await screen.findByText("12")).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    await user.click(within(navigation).getByRole("button", { name: "User Management" }));
    expect(await screen.findByRole("heading", { name: "User management" })).toBeTruthy();
    expect(screen.getByText("No accounts match these filters.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/admin/users")).toBe(true);
  });

  it("renders overview values from the generated manifest", async () => {
    const { container } = render(<App />);
    expect(await screen.findByRole("heading", { name: "Black Marble Intelligence Globe" })).toBeTruthy();
    expect(container.querySelector(".hud-contextbar")).toBeNull();
    expect(container.querySelector(".hud-topbar-status")).toBeNull();
    expect(container.querySelector(".hud-footer")).toBeNull();
    expect(container.querySelector(".intelligence-globe-map-caption")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Regional radiance intelligence" })).toBeNull();
    const sourceSummary = await screen.findByText(/131,440 cells/);
    expect(sourceSummary.textContent).toContain("131,440 cells");
    expect(screen.getAllByText("71.9%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Aurelia|synthetic candidate/i)).toBeNull();
  });

  it("opens the regional transition map", async () => {
    await openPage("Transition map");
    expect(await screen.findByRole("heading", { name: "Regional Black Marble transition map" })).toBeTruthy();
    expect(screen.getByText("OBSERVED · 2016-01")).toBeTruthy();
    expect(screen.getByText("OBSERVED · 2026-10")).toBeTruthy();
    const sidebar = screen.getByRole("complementary", { name: "Transition map details" });
    expect(within(sidebar).getByRole("region", { name: "Chronological Random Forest validation" })).toBeTruthy();
    expect(within(sidebar).getByText("Lower measured / predicted radiance")).toBeTruthy();
    expect(within(sidebar).getByText("Click a cell on either map to inspect its available data.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Regional radiance intelligence" })).toBeNull();
  });

  it("derives observation coverage from available months", async () => {
    await openPage("Coverage");
    expect(screen.getByRole("heading", { name: "Observed VNP46A3 coverage" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Observed month coverage by year" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2026-11")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Observation coverage" })).toBeNull();
  });

  it("shows trained-model metrics without changing their values", async () => {
    await openPage("Evaluation");
    expect(screen.getByRole("heading", { name: "Held-out screening metrics" })).toBeTruthy();
    expect(screen.getByText("71.9%")).toBeTruthy();
    expect(screen.getByText("67.3%")).toBeTruthy();
    expect(screen.getByText("0.1168")).toBeTruthy();
    expect(screen.getByText("180,000")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Chronological model evaluation" })).toBeNull();
  });

  it("shows dataset and model provenance from the same manifest", async () => {
    await openPage("Provenance");
    expect(screen.getByRole("heading", { name: "Black Marble spatial asset" })).toBeTruthy();
    expect(screen.getByText("122.3, 11.4, 124.7, 14.6")).toBeTruthy();
    expect(screen.getByText("previous month radiance")).toBeTruthy();
    expect(screen.getByText("Direct good-quality land/coastal cells with observations.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Data and model provenance" })).toBeNull();
  });
});
