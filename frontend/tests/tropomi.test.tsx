import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import {
  loadTropomiManifest,
  parseTropomiCells,
} from "../src/data/tropomi";

const monthlyGrid = {
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
};

it("parses valid monthly grid cells without changing observed values", () => {
  const parsed = parseTropomiCells(monthlyGrid, "2025-12");
  expect(parsed.features).toHaveLength(1);
  expect(parsed.features[0].properties.no2ColumnMolM2).toBe(1.25e-6);
  expect(parsed.features[0].properties.validPixelCount).toBe(42);
});

it("parses the generated latest-month asset with real Bicol grid cells", () => {
  const assetPath = resolve(
    process.cwd(),
    "public",
    "data",
    "tropomi",
    "observations",
    "2025-12.geojson.gz",
  );
  const compressed = readFileSync(assetPath);
  const value = JSON.parse(gunzipSync(compressed).toString("utf8"));
  const parsed = parseTropomiCells(value, "2025-12");
  expect(parsed.features.length).toBeGreaterThan(0);
  expect(parsed.features[0].properties.validPixelCount).toBeGreaterThan(0);
});

it("loads and validates the generated TROPOMI manifest", async () => {
  const manifestPath = resolve(
    process.cwd(),
    "public",
    "data",
    "tropomi",
    "manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => manifest,
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const loaded = await loadTropomiManifest();
    expect(loaded.months).toHaveLength(84);
    expect(loaded.months[0]).toBe("2019-01");
    expect(loaded.months[83]).toBe("2025-12");
    expect(fetchMock).toHaveBeenCalledWith("/data/tropomi/manifest.json");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("rejects cells whose month or footprint is inconsistent", () => {
  expect(() => parseTropomiCells(monthlyGrid, "2025-11")).toThrow(
    "invalid cell",
  );
  const invalidRing = structuredClone(monthlyGrid);
  invalidRing.features[0].geometry.coordinates[0][4] = [122.8, 14.4];
  expect(() => parseTropomiCells(invalidRing, "2025-12")).toThrow(
    "invalid cell",
  );
});
