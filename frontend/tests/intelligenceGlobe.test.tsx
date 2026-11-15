import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntelligenceGlobe } from "../src/components/IntelligenceGlobe";

const state = vi.hoisted(() => ({
  maps: [] as any[],
  supported: true,
  manifest: {
    formatVersion: 1,
    region: "Bicol Region",
    bounds: [122.3, 11.4, 124.7, 14.6],
    product: "VNP46A3 Collection 2",
    layer: "AllAngle_Composite_Snow_Free",
    units: "nWatts/(cm^2 sr)",
    cellCount: 1,
    months: ["2026-09", "2026-10"],
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
  tropomiManifest: {
    formatVersion: 1,
    region: "Bicol Region",
    bounds: [122.3, 11.4, 124.7, 14.6],
    product: "Sentinel-5P TROPOMI L2 NO2",
    units: "mol m-2",
    gridDegrees: 0.1,
    qaThreshold: 0.75,
    months: ["2025-12"],
    monthlyCellCounts: { "2025-12": 1 },
    sourceCatalog: "https://registry.opendata.aws/sentinel5p/",
    scopeNote: "Monthly grid, not native footprints.",
  },
  merraManifest: {
    formatVersion: 1,
    product: "MERRA-2 M2T1NXSLV 5.12.4",
    source: "NASA Giovanni area-average time series",
    sourceCatalog: "https://giovanni.gsfc.nasa.gov/giovanni/",
    productMetadata:
      "https://disc.gsfc.nasa.gov/datasets/M2T1NXSLV_5.12.4/summary",
    sourceStart: "2016-01-01T00:00:00.000Z",
    sourceEnd: "2026-10-01T00:00:00.000Z",
    bounds: [116, 4, 127, 22],
    units: "m s-1",
    variables: { eastward: "U10M", northward: "V10M" },
    months: ["2025-12"],
    records: [
      {
        month: "2025-12",
        u10mMeanMps: -2.5,
        v10mMeanMps: 1.75,
        validHourPairs: 744,
        expectedHourCount: 744,
        completeMonth: true,
      },
    ],
    scopeNote: "Regional area average; not Bicol-cell-specific.",
  },
  tropomi: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          month: "2025-12",
          cellId: "x0000_y0000",
          longitude: 122.9,
          latitude: 14.5,
          no2ColumnMolM2: 1.25e-6,
          no2ColumnStdMolM2: 0.2e-6,
          qaMean: 0.985,
          validPixelCount: 42,
          validOrbitCount: 11,
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [122.85, 14.45],
            [122.95, 14.45],
            [122.95, 14.55],
            [122.85, 14.55],
            [122.85, 14.45],
          ]],
        },
      },
    ],
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
  previousObserved: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          gridIndex: 0,
          latitude: 14.5,
          longitude: 122.9,
          radiance: 1,
          observationCount: 3,
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
  loadBlackMarbleMonth: vi.fn((month: string) =>
    Promise.resolve(
      month === "2026-09" ? state.previousObserved : state.observed,
    ),
  ),
  loadBlackMarbleForecast: vi.fn(() => Promise.resolve(state.forecast)),
}));

vi.mock("../src/data/tropomi", () => ({
  loadTropomiManifest: vi.fn(() => Promise.resolve(state.tropomiManifest)),
  loadTropomiMonth: vi.fn(() => Promise.resolve(state.tropomi)),
}));

vi.mock("../src/data/merra", () => ({
  loadMerraManifest: vi.fn(() => Promise.resolve(state.merraManifest)),
}));

vi.mock("mapbox-gl", () => ({
  default: {
    supported: () => state.supported,
    Map: class {
      sources: Record<string, any> = {};
      scrollZoom = { enable: vi.fn(), setWheelZoomRate: vi.fn() };
      handlers: Record<string, (event?: any) => void> = {};
      center = { lng: 123.3, lat: 13.05 };
      zoom = 1.65;
      addControl = vi.fn();
      addLayer = vi.fn();
      setFog = vi.fn();
      setPaintProperty = vi.fn();
      setLayoutProperty = vi.fn();
      easeTo = vi.fn();
      remove = vi.fn();
      resize = vi.fn();
      touchZoomRotate = { enable: vi.fn() };
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
      getStyle() {
        return {
          layers: [
            { id: "admin-1-boundary", type: "line" },
            { id: "place-label", type: "symbol" },
          ],
        };
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
  expect(state.maps[0].options.center).toEqual([123.5, 13]);

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
  expect(
    await screen.findByText(
      /Compared with 2026-09, measured radiance increased by 0\.250/,
    ),
  ).toBeTruthy();
  const insights = screen.getByRole("region", { name: "AI Insights" });
  expect(insights.textContent).toMatch(/Random Forest predicts 1\.750/);
  expect(insights.textContent).toMatch(/Possible explanations.*unverified/);
  expect(state.maps[0].setFog).toHaveBeenCalled();
  expect(state.maps[0].setPaintProperty).toHaveBeenCalledWith(
    "admin-1-boundary",
    "line-opacity",
    0.62,
  );
  expect(state.maps[0].easeTo).toHaveBeenCalledWith(
    expect.objectContaining({
      center: [122.9, 14.5],
      zoom: 7.5,
    }),
  );
});

it("pauses and reports when a click is outside the dataset bounds", async () => {
  render(<IntelligenceGlobe />);
  await waitFor(() =>
    expect(state.maps[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "globe-blackmarble-glow" }),
    ),
  );

  act(() => {
    state.maps[0].handlers.click({
      lngLat: { lat: 40.7, lng: -73.9 },
    });
  });

  expect(await screen.findByText("Outside data coverage")).toBeTruthy();
  expect(screen.getByText("ROTATION PAUSED")).toBeTruthy();
  expect(
    screen.getByText(/current Black Marble grid covers Bicol Region only/i),
  ).toBeTruthy();
});

it("pauses on globe gestures and filters mapped data from AI Analytics", async () => {
  const user = userEvent.setup();
  render(<IntelligenceGlobe />);
  await waitFor(() =>
    expect(state.maps[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "globe-rf-forecast-cells" }),
    ),
  );

  expect(state.maps[0].scrollZoom.enable).toHaveBeenCalled();
  expect(state.maps[0].scrollZoom.setWheelZoomRate).toHaveBeenCalledWith(
    1 / 120,
  );
  expect(state.maps[0].touchZoomRotate.enable).toHaveBeenCalled();
  act(() => state.maps[0].handlers.wheel());
  expect(screen.getByText("ROTATION PAUSED")).toBeTruthy();

  const blackMarble = screen.getByRole("checkbox", {
    name: /VIIRS \/ Black Marble/,
  });
  const randomForest = screen.getByRole("checkbox", {
    name: /Random Forest · Trained forecast/,
  });
  const unconnectedDataset = screen.getByRole("checkbox", {
    name: /MERRA-2/,
  });
  expect(blackMarble.checked).toBe(true);
  expect(randomForest.checked).toBe(false);
  expect(unconnectedDataset.disabled).toBe(true);

  await user.click(randomForest);
  expect(randomForest.checked).toBe(true);
  expect(state.maps[0].setLayoutProperty).toHaveBeenCalledWith(
    "globe-rf-forecast-cells",
    "visibility",
    "visible",
  );
  await user.click(blackMarble);
  expect(blackMarble.checked).toBe(false);
  expect(state.maps[0].setLayoutProperty).toHaveBeenCalledWith(
    "globe-blackmarble-cells",
    "visibility",
    "none",
  );
});

it("disables observed layers for forecast-only months", async () => {
  const user = userEvent.setup();
  render(<IntelligenceGlobe />);
  await screen.findByRole("option", { name: "2026-11 · forecast" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Globe map month" }),
    "2026-11",
  );

  const blackMarble = screen.getByRole("checkbox", {
    name: /VIIRS \/ Black Marble/,
  });
  const randomForest = screen.getByRole("checkbox", {
    name: /Random Forest · Trained forecast/,
  });
  await waitFor(() => expect(blackMarble.disabled).toBe(true));
  expect(blackMarble.checked).toBe(false);
  expect(randomForest.disabled).toBe(false);
});

it("loads the selected monthly TROPOMI grid and displays its real cell value", async () => {
  const user = userEvent.setup();
  render(<IntelligenceGlobe />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Globe map month" }),
    "2025-12",
  );

  const tropomi = screen.getByRole("checkbox", {
    name: /Sentinel-5P \(NO₂\)/,
  });
  await waitFor(() => expect(tropomi.disabled).toBe(false));
  await user.click(tropomi);

  await waitFor(() =>
    expect(state.maps[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "globe-tropomi-no2-grid",
        type: "fill",
        source: "globe-tropomi-no2",
      }),
    ),
  );
  await waitFor(() =>
    expect(state.maps[0].setLayoutProperty).toHaveBeenCalledWith(
      "globe-tropomi-no2-grid",
      "visibility",
      "visible",
    ),
  );

  act(() => {
    state.maps[0].handlers.click({
      lngLat: { lat: 14.5, lng: 122.9 },
    });
  });

  expect(await screen.findByText(/1\.25 µmol\/m²/)).toBeTruthy();
  expect(screen.getByText("0.985 / 42")).toBeTruthy();
  expect(
    state.maps[0].sources["globe-tropomi-no2"].setData,
  ).toHaveBeenCalledWith(state.tropomi);
});

it("shows MERRA-2 as regional context instead of drawing a false local layer", async () => {
  const user = userEvent.setup();
  render(<IntelligenceGlobe />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Globe map month" }),
    "2025-12",
  );

  const merra = screen.getByRole("checkbox", {
    name: /MERRA-2 \(Regional wind context\)/,
  });
  await waitFor(() => expect(merra.disabled).toBe(false));
  await user.click(merra);

  const context = screen.getByRole("region", {
    name: "MERRA-2 regional wind context",
  });
  expect(context.textContent).toContain("-2.50 m s-1");
  expect(context.textContent).toContain("1.75 m s-1");
  expect(context.textContent).toContain("744 / 744");
  expect(context.textContent).toMatch(/not Bicol-cell-specific/i);
  expect(
    state.maps[0].addLayer.mock.calls.some(
      ([layer]: [{ id: string }]) => layer.id === "globe-merra-wind",
    ),
  ).toBe(false);
});
