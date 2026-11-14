import type { FeatureCollection, Polygon } from "geojson";
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
          return [
            lng + 0.015 + Math.cos(angle) * 0.025,
            lat + 0.008 + Math.sin(angle) * 0.012,
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
