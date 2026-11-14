import type { FeatureCollection, Point, Polygon } from "geojson";
import type { TransitionEvent } from "../types";

// Fictional demonstration positions in Bicol, not verified event locations.
export const DEMO_CENTER: [number, number] = [123.4, 13.3];
// Regional viewing extent, not an administrative boundary polygon.
export const BICOL_VIEW_BOUNDS: [[number, number], [number, number]] = [
  [122.0, 11.5],
  [124.6, 14.6],
];
export function demoPosition(event: TransitionEvent): [number, number] {
  // Spread fictional samples across the regional view so pins do not overlap.
  // These are demonstration anchors, not the locations of real observations.
  const anchors: Record<string, [number, number]> = {
    "DEMO-001": [122.95, 14.11],
    "DEMO-002": [123.74, 13.14],
    "DEMO-003": [123.19, 13.62],
    "DEMO-004": [123.62, 12.37],
  };
  if (anchors[event.id]) return anchors[event.id];
  return [
    DEMO_CENTER[0] + (event.coords[0] - 50) * 0.002,
    DEMO_CENTER[1] - (event.coords[1] - 50) * 0.002,
  ];
}
export function lightingCells(
  events: TransitionEvent[],
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: events.map((event) => {
      const [lng, lat] = demoPosition(event);
      const dy = 0.25 / 111.32;
      const dx = dy / Math.cos((lat * Math.PI) / 180);
      return {
        type: "Feature",
        properties: { id: event.id, color: event.color },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng - dx, lat - dy],
              [lng + dx, lat - dy],
              [lng + dx, lat + dy],
              [lng - dx, lat + dy],
              [lng - dx, lat - dy],
            ],
          ],
        },
      };
    }),
  };
}

// The screening illustration uses a declared NE wind direction. Keep the
// polygon and heat points in the same local coordinate system so they remain
// aligned when the map is zoomed or panned.
const PLUME_BEARING = Math.PI / 4;
const PLUME_OFFSET: [number, number] = [0.012, 0.008];
function plumeCoordinate(
  longitude: number,
  latitude: number,
  along: number,
  cross = 0,
): [number, number] {
  const dx = Math.cos(PLUME_BEARING);
  const dy = Math.sin(PLUME_BEARING);
  return [
    longitude + PLUME_OFFSET[0] + along * dx - cross * dy,
    latitude + PLUME_OFFSET[1] + along * dy + cross * dx,
  ];
}

export function atmosphericFootprints(
  events: TransitionEvent[],
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: events
      .filter((e) => e.shortType === "Industrial")
      .map((event) => {
        const [lng, lat] = demoPosition(event);
        const ring = Array.from({ length: 49 }, (_, i) => {
          const angle = ((i % 48) / 48) * 2 * Math.PI;
          const along = 0.022 + Math.cos(angle) * 0.028;
          const cross = Math.sin(angle) * 0.012;
          return [
            ...plumeCoordinate(lng, lat, along, cross),
          ];
        });
        return {
          type: "Feature",
          properties: { id: event.id },
          geometry: { type: "Polygon", coordinates: [ring] },
        };
      }),
  };
}

// Broad synthetic plume samples for the screening illustration. These points
// are intentionally not derived from satellite observations or facility data.
export function plumeHeatPoints(events: TransitionEvent[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: events.filter(event => event.shortType === "Industrial").flatMap(event => {
      const [lng, lat] = demoPosition(event);
      return Array.from({ length: 18 }, (_, index) => {
        const progress = index / 17;
        const along = -0.008 + progress * 0.058;
        const cross = Math.sin(index / 2.2) * (0.002 + progress * 0.006);
        return {
        type: "Feature" as const,
        properties: { id: event.id, weight: 1 - index / 25 },
        geometry: {
          type: "Point" as const,
          coordinates: plumeCoordinate(lng, lat, along, cross),
        },
        };
      });
    }),
  };
}

// Deterministic sample lights for the regional year-comparison UI. The year
// changes an illustration, not a real VIIRS/Black Marble observation.
export function illustrativeNightLights(year: number): FeatureCollection<Point> {
  const progress = Math.max(0, Math.min(1, (year - 2016) / 10));
  const hubs: [number, number, number][] = [
    [123.19, 13.62, 1], [123.74, 13.14, .82], [123.33, 13.16, .7],
    [123.49, 13.31, .6], [122.95, 14.11, .48], [123.62, 12.37, .58],
  ];
  const features = hubs.flatMap(([lng, lat, size], hub) =>
    Array.from({ length: 32 }, (_, index) => {
      const angle = index * 2.39996 + hub;
      const radius = Math.sqrt((index + .5) / 32) * (.18 + progress * .09) * size;
      const weight = Math.max(.12, Math.min(1, (.42 + progress * .44) * size + (index % 7) * .045));
      return {
        type: "Feature" as const,
        properties: { weight },
        geometry: { type: "Point" as const, coordinates: [lng + Math.cos(angle) * radius, lat + Math.sin(angle) * radius * .7] },
      };
    }),
  );
  return { type: "FeatureCollection", features };
}
