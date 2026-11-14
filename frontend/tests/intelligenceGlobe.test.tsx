import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { IntelligenceGlobe } from "../src/components/IntelligenceGlobe";

const state = vi.hoisted(() => ({
  maps: [] as any[],
  supported: true,
  manifest: {
    formatVersion: 1,
    product: "VNP46A3 Collection 2",
    layer: "AllAngle_Composite_Snow_Free",
    units: "nWatts/(cm^2 sr)",
    cellCount: 1,
    months: ["2026-10"],
    forecastMonths: ["2026-11"],
    latestObservedMonth: "2026-10",
    futureForecastMonth: "2026-11",
    metrics: {
      regression: { mae: 0.1, rmse: 0.2 },
      direction: {
        accuracy: 0.72,
        balanced_accuracy: 0.67,
        precision: 0.18,
        recall: 0.62,
        f1: 0.28,
        roc_auc: 0.75,
      },
      test_samples: 180000,
      test_period: { start: "2024-09", end: "2026-10" },
      disclaimer: "Exploratory cell-level screening.",
    },
    disclaimer: "Exploratory cell-level screening.",
  },
  observed: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          gridIndex: 0,
          latitude: 14.5,
          longitude: 122.9,
          radiance: 1.25,
          observationCount: 4,
        },
        geometry: { type: "Point", coordinates: [122.9, 14.5] },
      },
    ],
  },
  forecast: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          gridIndex: 0,
          latitude: 14.5,
          longitude: 122.9,
          radiance: 1.75,
          observationCount: 0,
          increaseProbability: 0.8,
          isForecast: true,
        },
        geometry: { type: "Point", coordinates: [122.9, 14.5] },
      },
    ],
  },
}));

vi.mock("../src/data/blackMarble", () => ({
  loadBlackMarbleManifest: vi.fn(() => Promise.resolve(state.manifest)),
  loadBlackMarbleMonth: vi.fn(() => Promise.resolve(state.observed)),
  loadBlackMarbleForecast: vi.fn(() => Promise.resolve(state.forecast)),
}));

vi.mock("mapbox-gl", () => ({
  default: {
    supported: () => state.supported,
    Map: class {
      sources: Record<string, any> = {};
      scrollZoom = { enable: vi.fn() };
      handlers: Record<string, (event?: any) => void> = {};
      center = { lng: 123.3, lat: 13.05 };
      zoom = 1.65;
      addControl = vi.fn();
      addLayer = vi.fn();
      easeTo = vi.fn();
      remove = vi.fn();
      resize = vi.fn();
      constructor(public options: any) {
        state.maps.push(this);
      }
      on(
        name: string,
        layerOrCallback: string | ((event?: any) => void),
        callback?: (event?: any) => void,
      ) {
        const handler =
          callback ??
          (typeof layerOrCallback === "function" ? layerOrCallback : () => {});
        this.handlers[name] = handler;
        if (name === "load") queueMicrotask(handler);
      }
      addSource(name: string) {
        this.sources[name] = { setData: vi.fn() };
      }
      getSource(name: string) {
        return this.sources[name];
      }
      getCenter() {
        return this.center;
      }
      getZoom() {
        return this.zoom;
      }
      setCenter(center: [number, number]) {
        this.center = { lng: center[0], lat: center[1] };
        return this;
      }
    },
    NavigationControl: class {},
  },
}));

beforeEach(() => {
  state.maps.length = 0;
  state.supported = true;
  vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "pk.test-only");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ place_name: "Bicol Region, Philippines" }],
      }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("updates both side panels for the clicked Bicol grid cell and pauses", async () => {
  render(<IntelligenceGlobe />);
  await waitFor(() =>
    expect(state.maps[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "globe-blackmarble-glow" }),
    ),
  );

  act(() => {
    state.maps[0].handlers.click({
      lngLat: { lat: 14.5, lng: 122.9 },
    });
  });

  expect(await screen.findByText("Bicol Region, Philippines")).toBeTruthy();
  expect(screen.getByText("ROTATION PAUSED")).toBeTruthy();
  expect(screen.getByText("1.250 nWatts/(cm^2 sr)")).toBeTruthy();
  expect(screen.getByText("1.750 nWatts/(cm^2 sr)")).toBeTruthy();
  expect(screen.getByText("80.0%")).toBeTruthy();
  expect(state.maps[0].easeTo).toHaveBeenCalledWith(
    expect.objectContaining({
      center: [122.9, 14.5],
      zoom: 7.5,
    }),
  );
});
