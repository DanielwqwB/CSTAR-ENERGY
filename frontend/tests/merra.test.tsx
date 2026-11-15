import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseMerraManifest } from "../src/data/merra";

it("validates the generated MERRA-2 monthly area-mean dataset", () => {
  const manifestPath = resolve(
    process.cwd(),
    "public",
    "data",
    "merra",
    "manifest.json",
  );
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifest = parseMerraManifest(value);

  expect(manifest.months).toHaveLength(129);
  expect(manifest.months[0]).toBe("2016-01");
  expect(manifest.months[128]).toBe("2026-09");
  expect(manifest.records[0].validHourPairs).toBe(744);
  expect(manifest.scopeNote).toMatch(/not Bicol-specific or cell-level/i);
});

it("rejects a MERRA-2 manifest with mismatched month records", () => {
  const invalid = {
    formatVersion: 1,
    product: "MERRA-2",
    source: "NASA Giovanni",
    sourceCatalog: "https://giovanni.gsfc.nasa.gov/giovanni/",
    productMetadata: "https://disc.gsfc.nasa.gov/",
    sourceStart: "2016-01-01",
    sourceEnd: "2016-02-01",
    bounds: [116, 4, 127, 22],
    units: "m s-1",
    variables: { eastward: "U10M", northward: "V10M" },
    months: ["2016-01"],
    records: [],
    scopeNote: "Area average.",
  };
  expect(() => parseMerraManifest(invalid)).toThrow(
    "invalid regional records",
  );
});
