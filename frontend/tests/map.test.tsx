import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TransitionMap } from "../src/components/TransitionMap";
import {
  parseBlackMarbleCellCsv,
  parseBlackMarbleForecast,
  parseBlackMarbleGrid,
  parseBlackMarbleObservations,
} from "../src/data/blackMarble";
import seed from "../src/data/events.json";
import type { TransitionEvent } from "../src/types";

const state = vi.hoisted(() => ({
  maps: [] as any[],
  markers: [] as any[],
  supported: true,
}));
vi.mock("mapbox-gl", () => ({
  default: {
    supported: () => state.supported,
    Map: class {
      sources: Record<string, any> = {};
      scrollZoom = { disable: vi.fn(), enable: vi.fn() };
      addControl = vi.fn();
      remove = vi.fn();
      resize = vi.fn();
      fitBounds = vi.fn();
      setLayoutProperty = vi.fn();
      setPaintProperty = vi.fn();
      addLayer = vi.fn();
      handlers: Record<string, (event?: any) => void> = {};
      constructor(public options: any) {
        state.maps.push(this);
      }
      on(
        name: string,
        layerOrCallback: string | ((event?: any) => void),
        callback?: (event?: any) => void,
      ) {
        const layer = typeof layerOrCallback === "string" ? layerOrCallback : "";
        const handler =
          callback ??
          (typeof layerOrCallback === "function" ? layerOrCallback : () => {});
        this.handlers[layer ? `${name}:${layer}` : name] = handler;
        if (name === "load") queueMicrotask(handler);
      }
      addSource(name: string) {
        this.sources[name] = { setData: vi.fn() };
      }
      getSource(name: string) {
        return this.sources[name];
      }
      getCanvas() {
        return { style: { cursor: "" } };
      }
    },
    Marker: class {
      element: HTMLButtonElement;
      remove = vi.fn(() => this.element.remove());
      setLngLat = vi.fn(() => this);
      constructor({ element }: { element: HTMLButtonElement }) {
        this.element = element;
        state.markers.push(this);
      }
      addTo(map: any) {
        map.options.container.appendChild(this.element);
        return this;
      }
    },
    NavigationControl: class {},
    ScaleControl: class {},
    LngLatBounds: class {
      extend = vi.fn();
    },
  },
}));
const events = seed as TransitionEvent[];
beforeEach(() => {
  state.maps.length = 0;
  state.markers.length = 0;
  state.supported = true;
  vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "pk.test-only");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("keeps interactive markers in the map and updates layers without rebuilding it", async () => {
  const onSelect = vi.fn();
  const { rerender, unmount } = render(
    <TransitionMap events={events} onSelect={onSelect} />,
  );
  const marker = await screen.findByRole("button", {
    name: /Investigate DEMO-002/,
  });
  expect(marker.closest(".map-canvas")).not.toBeNull();
  expect(marker.querySelector(".map-event-number")?.textContent).toBe("02");
  expect(state.maps[0].options.style).toBe("mapbox://styles/mapbox/light-v11");
  fireEvent.click(marker);
  expect(onSelect).toHaveBeenCalledWith(events[1]);
  rerender(
    <TransitionMap
      events={[events[1]]}
      selected="DEMO-002"
      onSelect={onSelect}
      cells={false}
      plume={false}
      cellOpacity={0.7}
      plumeOpacity={0.4}
    />,
  );
  await waitFor(() =>
    expect(state.maps[0].setLayoutProperty).toHaveBeenCalledWith(
      "lighting-cells",
      "visibility",
      "none",
    ),
  );
  expect(state.maps[0].setLayoutProperty).toHaveBeenCalledWith(
    "atmospheric-footprints",
    "visibility",
    "none",
  );
  expect(state.maps[0].setPaintProperty).toHaveBeenCalledWith("lighting-cells", "fill-opacity", 0.7);
  expect(state.maps[0].setPaintProperty).toHaveBeenCalledWith("atmospheric-footprints", "fill-opacity", 0.4);
  expect(state.maps).toHaveLength(1);
  expect(
    screen
      .getByRole("button", { name: /Investigate DEMO-002/ })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.queryByRole("button", { name: /Investigate DEMO-001/ }),
  ).toBeNull();
  unmount();
  expect(state.maps[0].remove).toHaveBeenCalled();
});
it("retains selectable events when WebGL is unavailable", async () => {
  state.supported = false;
  const onSelect = vi.fn();
  render(<TransitionMap events={events} onSelect={onSelect} />);
  expect(await screen.findByText(/Mapbox could not start/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /DEMO-002 Eastport/ }));
  expect(onSelect).toHaveBeenCalledWith(events[1]);
});
it("shows configuration guidance without constructing a map if the token is absent", () => {
  vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
  render(<TransitionMap events={events} onSelect={() => {}} />);
  expect(screen.getByText(/Mapbox token is missing/)).toBeTruthy();
  expect(state.maps).toHaveLength(0);
});

it("parses Black Marble coordinates into longitude-latitude map points", () => {
  const cells = parseBlackMarbleCellCsv(
    "latitude,longitude,radiance,observation_count\r\n14.5,122.9,1.25,4\r\n",
  );
  expect(cells.features).toHaveLength(1);
  expect(cells.features[0].geometry.coordinates).toEqual([122.9, 14.5]);
  expect(cells.features[0].properties).toEqual({
    latitude: 14.5,
    longitude: 122.9,
    radiance: 1.25,
    observationCount: 4,
  });
  expect(() =>
    parseBlackMarbleCellCsv(
      "latitude,longitude,radiance,observation_count\nnot-a-number,122.9,1.25,4",
    ),
  ).toThrow(/Invalid Black Marble cell row/);
});

it("parses fixed-grid observations and forecast probabilities", () => {
  const gridBuffer = new ArrayBuffer(16);
  const gridView = new DataView(gridBuffer);
  [122.9, 14.5, 123, 14.6].forEach((value, index) =>
    gridView.setFloat32(index * 4, value, true),
  );
  const coordinates = parseBlackMarbleGrid(gridBuffer, 2);

  const observationBuffer = new ArrayBuffer(12);
  const observationView = new DataView(observationBuffer);
  observationView.setFloat32(0, 1.25, true);
  observationView.setFloat32(4, Number.NaN, true);
  observationView.setUint16(8, 4, true);
  observationView.setUint16(10, 0, true);
  const observed = parseBlackMarbleObservations(
    observationBuffer,
    coordinates,
  );
  expect(observed.features).toHaveLength(1);
  expect(observed.features[0].properties).toMatchObject({
    gridIndex: 0,
    latitude: 14.5,
    radiance: 1.25,
    observationCount: 4,
  });
  expect(observed.features[0].properties.longitude).toBeCloseTo(122.9, 5);

  const forecastBuffer = new ArrayBuffer(16);
  const forecastView = new DataView(forecastBuffer);
  forecastView.setFloat32(0, 1.5, true);
  forecastView.setFloat32(4, Number.NaN, true);
  forecastView.setFloat32(8, 0.75, true);
  forecastView.setFloat32(12, Number.NaN, true);
  const forecast = parseBlackMarbleForecast(forecastBuffer, coordinates);
  expect(forecast.features).toHaveLength(1);
  expect(forecast.features[0].properties).toMatchObject({
    gridIndex: 0,
    radiance: 1.5,
    increaseProbability: 0.75,
    isForecast: true,
  });
  expect(() => parseBlackMarbleGrid(gridBuffer, 3)).toThrow(
    /unexpected size/,
  );
});

it("renders observed Black Marble cells and reports the clicked cell", async () => {
  const cells = parseBlackMarbleCellCsv(
    "latitude,longitude,radiance,observation_count\n14.5,122.9,1.25,4",
  );
  const onObservedCellSelect = vi.fn();
  render(
    <TransitionMap
      events={[]}
      onSelect={() => {}}
      observedRadianceCells={cells}
      showObservedRadianceCells
      onObservedCellSelect={onObservedCellSelect}
      mapCaption="BICOL REGION · BLACK MARBLE · 2026-06"
      disclaimerText="Observed cells."
    />,
  );
  await waitFor(() =>
    expect(state.maps[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "blackmarble-radiance-cells" }),
    ),
  );
  state.maps[0].handlers.click({
    lngLat: { lat: 14.5, lng: 122.9 },
  });
  expect(onObservedCellSelect).toHaveBeenCalledWith({
    latitude: 14.5,
    longitude: 122.9,
    radiance: 1.25,
    observationCount: 4,
  });
  expect(state.maps[0].scrollZoom.enable).toHaveBeenCalledOnce();
});
