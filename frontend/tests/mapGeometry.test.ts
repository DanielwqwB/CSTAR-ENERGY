import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  demoPosition,
  lightingCells,
  atmosphericFootprints,
  plumeHeatPoints,
  illustrativeNightLights,
} from "../src/data/mapGeometry.ts";
import type { TransitionEvent } from "../src/types.ts";
const events = JSON.parse(
  readFileSync(new URL("../src/data/events.json", import.meta.url), "utf8"),
) as TransitionEvent[];
test("map geometry uses closed geographic polygons and respects event filters", () => {
  const cells = lightingCells(events);
  assert.equal(cells.features.length, 4);
  for (const feature of cells.features) {
    const ring = feature.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(
      ring.every(
        ([lng, lat]) => lng > 122 && lng < 124.6 && lat > 11.5 && lat < 14.6,
      ),
    );
  }
  assert.equal(atmosphericFootprints(events).features.length, 1);
  assert.equal(atmosphericFootprints([events[0]]).features.length, 0);
  assert.equal(plumeHeatPoints(events).features.length, 18);
  assert.equal(plumeHeatPoints([events[0]]).features.length, 0);
  const footprintRing = atmosphericFootprints(events).features[0].geometry.coordinates[0];
  const heat = plumeHeatPoints(events).features.map((feature) => feature.geometry.coordinates);
  const footprintLng = footprintRing.map(([lng]) => lng);
  const footprintLat = footprintRing.map(([, lat]) => lat);
  const lngMin = Math.min(...footprintLng) - 0.01;
  const lngMax = Math.max(...footprintLng) + 0.01;
  const latMin = Math.min(...footprintLat) - 0.01;
  const latMax = Math.max(...footprintLat) + 0.01;
  assert.ok(heat.every(([lng, lat]) => lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax));
  assert.ok(heat.at(-1)![0] > heat[0][0]);
  assert.ok(heat.at(-1)![1] > heat[0][1]);
  assert.equal(lightingCells([]).features.length, 0);
  assert.equal(demoPosition(events[0]).length, 2);
});

test("demonstration anchors stay separated at the regional scale", () => {
  const positions = events.map(demoPosition);
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      assert.ok(Math.hypot(positions[i][0] - positions[j][0], positions[i][1] - positions[j][1]) > 0.5);
    }
  }
});

test("illustrative night-light comparison changes intensity across years", () => {
  const baseline = illustrativeNightLights(2016);
  const comparison = illustrativeNightLights(2026);
  assert.equal(baseline.features.length, comparison.features.length);
  assert.ok(comparison.features[0].properties!.weight > baseline.features[0].properties!.weight);
});
