import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvRow } from "./csv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "TROPOMI NO\u2082");
const outputDirectory = resolve(
  root,
  "frontend/public/data/tropomi/observations",
);
const blackMarblePath = resolve(
  root,
  "frontend/public/data/blackmarble/manifest.json",
);

function finiteNumber(value, column, month) {
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new Error(`Invalid ${column} value in TROPOMI month ${month}.`);
  return number;
}

async function loadMonthlyCells(month, bounds, sourceManifest) {
  const sourcePath = resolve(
    sourceDirectory,
    `tropomi_no2_${month}.csv.gz`,
  );
  const lines = createInterface({
    input: createReadStream(sourcePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let columns;
  const features = [];
  const seenCells = new Set();
  const halfCell = sourceManifest.output_grid_degrees / 2;
  const [west, south, east, north] = bounds;

  for await (const line of lines) {
    if (!columns) {
      columns = parseCsvRow(line);
      continue;
    }
    if (!line) continue;
    const values = parseCsvRow(line);
    if (values.length !== columns.length)
      throw new Error(`Invalid CSV row in TROPOMI month ${month}.`);
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    if (row.month !== month)
      throw new Error(`Unexpected month value in TROPOMI month ${month}.`);

    const longitude = finiteNumber(row.longitude, "longitude", month);
    const latitude = finiteNumber(row.latitude, "latitude", month);
    if (
      longitude < west ||
      longitude > east ||
      latitude < south ||
      latitude > north
    )
      continue;

    const cellId = row.cell_id;
    if (typeof cellId !== "string" || seenCells.has(cellId))
      throw new Error(`Duplicate or missing TROPOMI cell in ${month}.`);
    seenCells.add(cellId);
    const no2ColumnMolM2 = finiteNumber(
      row.tropospheric_no2_mean_mol_m2,
      "NO2 column",
      month,
    );
    const no2ColumnStdMolM2 = finiteNumber(
      row.tropospheric_no2_std_mol_m2,
      "NO2 standard deviation",
      month,
    );
    const qaMean = finiteNumber(row.qa_mean, "QA mean", month);
    const validPixelCount = finiteNumber(
      row.valid_pixel_count,
      "valid pixel count",
      month,
    );
    const validOrbitCount = finiteNumber(
      row.valid_orbit_count,
      "valid orbit count",
      month,
    );
    if (
      no2ColumnStdMolM2 < 0 ||
      qaMean < 0 ||
      qaMean > 1 ||
      !Number.isInteger(validPixelCount) ||
      validPixelCount < 1 ||
      !Number.isInteger(validOrbitCount) ||
      validOrbitCount < 1
    )
      throw new Error(`Invalid quality metadata in TROPOMI month ${month}.`);

    features.push({
      type: "Feature",
      properties: {
        month,
        cellId,
        longitude,
        latitude,
        no2ColumnMolM2,
        no2ColumnStdMolM2,
        qaMean,
        validPixelCount,
        validOrbitCount,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [longitude - halfCell, latitude - halfCell],
          [longitude + halfCell, latitude - halfCell],
          [longitude + halfCell, latitude + halfCell],
          [longitude - halfCell, latitude + halfCell],
          [longitude - halfCell, latitude - halfCell],
        ]],
      },
    });
  }

  if (!features.length)
    throw new Error(`No TROPOMI grid cells intersect ${month} and the study area.`);
  return features;
}

async function main() {
  const [blackMarbleText, sourceNames] = await Promise.all([
    readFile(blackMarblePath, "utf8"),
    readdir(sourceDirectory),
  ]);
  const blackMarbleManifest = JSON.parse(blackMarbleText);
  const months = sourceNames
    .map((name) => name.match(/^tropomi_no2_(\d{4}-\d{2})\.csv\.gz$/)?.[1])
    .filter((month) => month !== undefined)
    .sort();
  if (!months.length)
    throw new Error(`No monthly TROPOMI CSV files found in ${sourceDirectory}.`);

  await mkdir(outputDirectory, { recursive: true });
  const monthlyCellCounts = {};
  let totalCells = 0;
  let sourceMetadata;
  for (const month of months) {
    const sourceManifestPath = resolve(
      sourceDirectory,
      `tropomi_no2_${month}.manifest.json`,
    );
    const monthManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
    sourceMetadata ??= monthManifest;
    if (
      monthManifest.output_grid_degrees !== sourceMetadata.output_grid_degrees ||
      monthManifest.source_product !== sourceMetadata.source_product ||
      monthManifest.source_units !== sourceMetadata.source_units
    )
      throw new Error(`TROPOMI source metadata changed in ${month}.`);

    const features = await loadMonthlyCells(
      month,
      blackMarbleManifest.bounds,
      monthManifest,
    );
    const collection = { type: "FeatureCollection", features };
    const outputPath = resolve(outputDirectory, `${month}.geojson.gz`);
    await writeFile(
      outputPath,
      gzipSync(Buffer.from(JSON.stringify(collection)), { level: 9 }),
    );
    monthlyCellCounts[month] = features.length;
    totalCells += features.length;
  }

  const manifest = {
    formatVersion: 1,
    region: blackMarbleManifest.region,
    bounds: blackMarbleManifest.bounds,
    product: sourceMetadata.source_product,
    units: sourceMetadata.source_units,
    gridDegrees: sourceMetadata.output_grid_degrees,
    qaThreshold: sourceMetadata.qa_threshold,
    months,
    monthlyCellCounts,
    sourceCatalog: sourceMetadata.source_catalog,
    scopeNote:
      "Monthly QA-screened COG grid means are represented as 0.1-degree grid cells; these are not native Sentinel-5P pixel footprints.",
  };
  await writeFile(
    resolve(outputDirectory, "..", "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Prepared ${months.length} monthly TROPOMI assets with ${totalCells.toLocaleString()} Bicol grid cells.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
