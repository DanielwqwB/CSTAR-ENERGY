import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvRow } from "./csv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "Giovani");
const outputDirectory = resolve(root, "frontend/public/data/merra");
const variables = ["U10M", "V10M"];
const sourceCatalog = "https://giovanni.gsfc.nasa.gov/giovanni/";

function parseBounds(value) {
  const bounds = value.split(",").map((item) => Number(item.trim()));
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    throw new Error("MERRA-2 source bounding box is invalid.");
  return bounds;
}

async function loadComponent(path, variable) {
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  const metadata = {};
  const values = new Map();
  let columns;

  for await (const line of lines) {
    if (!columns) {
      const fields = parseCsvRow(line);
      if (fields[0] === "time") {
        columns = fields;
        if (
          columns.length !== 2 ||
          columns[1] !== `mean_M2T1NXSLV_5_12_4_${variable}`
        )
          throw new Error(`Unexpected MERRA-2 ${variable} CSV header.`);
      } else if (fields.length >= 2 && fields[0]) {
        metadata[fields[0].replace(/:$/, "")] = fields[1];
      }
      continue;
    }
    if (!line) continue;

    const [timestamp, rawValue] = parseCsvRow(line);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp))
      throw new Error(`Invalid timestamp in MERRA-2 ${variable} export.`);
    const value = Number(rawValue);
    if (!Number.isFinite(value))
      throw new Error(`Invalid MERRA-2 ${variable} value at ${timestamp}.`);
    const fillValue = Number(metadata["Fill Value"]);
    if (value === fillValue) continue;
    if (values.has(timestamp))
      throw new Error(`Duplicate MERRA-2 ${variable} timestamp ${timestamp}.`);
    values.set(timestamp, value);
  }

  if (!columns || !values.size)
    throw new Error(`MERRA-2 ${variable} export contains no usable values.`);
  const bounds = parseBounds(metadata["User Bounding Box"] ?? "");
  if (!metadata["User Start Date"] || !metadata["User End Date"])
    throw new Error(`MERRA-2 ${variable} export has no temporal metadata.`);
  return {
    bounds,
    start: metadata["User Start Date"],
    end: metadata["User End Date"],
    values,
  };
}

function expectedHours(month) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate() * 24;
}

async function main() {
  const names = await readdir(sourceDirectory);
  const components = {};
  for (const variable of variables) {
    const match = names.find(
      (name) =>
        name.includes("M2T1NXSLV_5_12_4_") &&
        name.includes(`_${variable}.`) &&
        name.endsWith(".csv"),
    );
    if (!match)
      throw new Error(`NASA Giovanni export for MERRA-2 ${variable} is missing.`);
    components[variable] = await loadComponent(
      resolve(sourceDirectory, match),
      variable,
    );
  }

  const eastward = components.U10M;
  const northward = components.V10M;
  if (
    eastward.start !== northward.start ||
    eastward.end !== northward.end ||
    eastward.bounds.some((value, index) => value !== northward.bounds[index])
  )
    throw new Error("MERRA-2 wind components do not share the same coverage.");

  const monthlySums = new Map();
  for (const [timestamp, u10m] of eastward.values) {
    const v10m = northward.values.get(timestamp);
    if (v10m === undefined) continue;
    const month = timestamp.slice(0, 7);
    const current = monthlySums.get(month) ?? {
      u10mSum: 0,
      v10mSum: 0,
      validHourPairs: 0,
    };
    current.u10mSum += u10m;
    current.v10mSum += v10m;
    current.validHourPairs += 1;
    monthlySums.set(month, current);
  }

  const records = Array.from(monthlySums, ([month, sums]) => {
    const expectedHourCount = expectedHours(month);
    return {
      month,
      u10mMeanMps: sums.u10mSum / sums.validHourPairs,
      v10mMeanMps: sums.v10mSum / sums.validHourPairs,
      validHourPairs: sums.validHourPairs,
      expectedHourCount,
      completeMonth: sums.validHourPairs === expectedHourCount,
    };
  }).sort((left, right) => left.month.localeCompare(right.month));
  if (!records.length)
    throw new Error("MERRA-2 exports have no matching hourly wind samples.");

  const manifest = {
    formatVersion: 1,
    product: "MERRA-2 M2T1NXSLV 5.12.4",
    source: "NASA Giovanni area-average time series",
    sourceCatalog,
    productMetadata:
      "https://disc.gsfc.nasa.gov/datasets/M2T1NXSLV_5.12.4/summary",
    sourceStart: eastward.start,
    sourceEnd: eastward.end,
    bounds: eastward.bounds,
    units: "m s-1",
    variables: {
      eastward: "U10M",
      northward: "V10M",
    },
    months: records.map((record) => record.month),
    records,
    scopeNote:
      "Monthly means of matched hourly 10 m wind-component area averages over the source bounding box. These are regional context values, not Bicol-specific or cell-level measurements.",
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Prepared ${records.length} monthly MERRA-2 regional wind summaries from ${eastward.values.size.toLocaleString()} eastward and ${northward.values.size.toLocaleString()} northward hourly values.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
