import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterEvents, toCsv } from "../src/utils/events.ts";
import type { TransitionEvent } from "../src/types.ts";

const events = JSON.parse(
  readFileSync(new URL("../src/data/events.json", import.meta.url), "utf8"),
) as TransitionEvent[];
test("catalogue search matches locations, identifiers, and mechanisms without case sensitivity", () => {
  assert.deepEqual(
    filterEvents(events, "eastPORT").map((e) => e.id),
    ["DEMO-002"],
  );
  assert.deepEqual(
    filterEvents(events, "demo-001").map((e) => e.id),
    ["DEMO-001"],
  );
  assert.equal(filterEvents(events, "modernization").length, 1);
  assert.equal(filterEvents(events, "missing location").length, 0);
});
test("type, review status, and study-region filters compose", () => {
  assert.equal(
    filterEvents(
      events,
      "",
      "Industrial",
      "Under Investigation",
      "Eastport Study Area",
    ).length,
    1,
  );
  assert.equal(
    filterEvents(
      events,
      "",
      "Lighting",
      "Under Investigation",
      "Eastport Study Area",
    ).length,
    0,
  );
  assert.deepEqual(
    filterEvents(events, "", undefined, undefined, "North District Subset").map(
      (e) => e.id,
    ),
    ["DEMO-001"],
  );
  assert.equal(filterEvents(events, "").length, 4);
});
test("review changes remove an event from its previous review queue", () => {
  const reviewed = events.map((e) =>
    e.id === "DEMO-002" ? { ...e, status: "Reviewed" as const } : e,
  );
  assert.equal(
    filterEvents(reviewed, "DEMO-002", undefined, "Under Investigation").length,
    0,
  );
  assert.equal(
    filterEvents(reviewed, "DEMO-002", undefined, "Reviewed").length,
    1,
  );
  assert.equal(events[1].status, "Under Investigation");
});
test("CSV preserves quotes, commas, and line breaks in analyst notes", () => {
  const csv = toCsv([{ ...events[0], notes: 'Check "fixture", then\nverify' }]);
  assert.ok(csv.includes('"Check ""fixture"", then\nverify"'));
  assert.equal(toCsv([]), "id,location,mechanism,onset,adequacy,status,notes");
});
test("CSV neutralizes spreadsheet formulas in user-authored values", () => {
  const csv = toCsv([{ ...events[0], notes: "=1+1" }]);
  assert.ok(csv.endsWith('"\'=1+1"'));
});
