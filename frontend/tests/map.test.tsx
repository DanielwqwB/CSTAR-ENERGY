import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TransitionMap } from "../src/components/TransitionMap";
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
      scrollZoom = { disable: vi.fn() };
      addControl = vi.fn();
      remove = vi.fn();
      resize = vi.fn();
      fitBounds = vi.fn();
      setLayoutProperty = vi.fn();
      addLayer = vi.fn();
      handlers: Record<string, () => void> = {};
      constructor(public options: any) {
        state.maps.push(this);
      }
      on(name: string, callback: () => void) {
        this.handlers[name] = callback;
        if (name === "load") queueMicrotask(callback);
      }
      addSource(name: string) {
        this.sources[name] = { setData: vi.fn() };
      }
      getSource(name: string) {
        return this.sources[name];
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
