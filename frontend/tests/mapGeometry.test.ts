import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  demoPosition,
  lightingCells,
  atmosphericFootprints,
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
