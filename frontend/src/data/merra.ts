export interface MerraMonthlyRecord {
  month: string;
  u10mMeanMps: number;
  v10mMeanMps: number;
  validHourPairs: number;
  expectedHourCount: number;
  completeMonth: boolean;
}

export interface MerraManifest {
  formatVersion: number;
  product: string;
  source: string;
  sourceCatalog: string;
  productMetadata: string;
  sourceStart: string;
  sourceEnd: string;
  bounds: [number, number, number, number];
  units: string;
  variables: { eastward: string; northward: string };
  months: string[];
  records: MerraMonthlyRecord[];
  scopeNote: string;
}

const MANIFEST_URL = "/data/merra/manifest.json";
let manifestRequest: Promise<MerraManifest> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function isMonthlyRecord(value: unknown): value is MerraMonthlyRecord {
  if (!isRecord(value)) return false;
  return (
    isMonth(value.month) &&
    isFiniteNumber(value.u10mMeanMps) &&
    isFiniteNumber(value.v10mMeanMps) &&
    Number.isInteger(value.validHourPairs) &&
    Number(value.validHourPairs) > 0 &&
    Number.isInteger(value.expectedHourCount) &&
    Number(value.expectedHourCount) > 0 &&
    Number(value.validHourPairs) <= Number(value.expectedHourCount) &&
    typeof value.completeMonth === "boolean"
  );
}

export function parseMerraManifest(value: unknown): MerraManifest {
  if (!isRecord(value) || !isRecord(value.variables))
    throw new Error("MERRA-2 month index has an invalid structure.");
  const { variables } = value;
  if (!Array.isArray(value.bounds) || value.bounds.length !== 4)
    throw new Error("MERRA-2 month index contains invalid regional records.");
  const bounds: number[] = [];
  for (const bound of value.bounds) {
    if (!isFiniteNumber(bound))
      throw new Error("MERRA-2 month index contains invalid regional records.");
    bounds.push(bound);
  }
  if (!Array.isArray(value.months) || !Array.isArray(value.records))
    throw new Error("MERRA-2 month index contains invalid regional records.");

  const months: string[] = [];
  for (const month of value.months) {
    if (!isMonth(month))
      throw new Error("MERRA-2 month index contains invalid regional records.");
    months.push(month);
  }
  const records: MerraMonthlyRecord[] = [];
  for (const record of value.records) {
    if (!isMonthlyRecord(record))
      throw new Error("MERRA-2 month index contains invalid regional records.");
    records.push(record);
  }
  if (
    months.length !== records.length ||
    months.some((month, index) => month !== records[index].month)
  )
    throw new Error("MERRA-2 month index contains invalid regional records.");

  if (
    typeof value.formatVersion !== "number" ||
    !Number.isInteger(value.formatVersion) ||
    typeof value.product !== "string" ||
    typeof value.source !== "string" ||
    typeof value.sourceCatalog !== "string" ||
    typeof value.productMetadata !== "string" ||
    typeof value.sourceStart !== "string" ||
    typeof value.sourceEnd !== "string" ||
    typeof value.units !== "string" ||
    typeof variables.eastward !== "string" ||
    typeof variables.northward !== "string" ||
    typeof value.scopeNote !== "string"
  )
    throw new Error("MERRA-2 month index metadata is invalid.");

  return {
    formatVersion: value.formatVersion,
    product: value.product,
    source: value.source,
    sourceCatalog: value.sourceCatalog,
    productMetadata: value.productMetadata,
    sourceStart: value.sourceStart,
    sourceEnd: value.sourceEnd,
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    units: value.units,
    variables: {
      eastward: variables.eastward,
      northward: variables.northward,
    },
    months,
    records,
    scopeNote: value.scopeNote,
  };
}

export async function loadMerraManifest(): Promise<MerraManifest> {
  if (!manifestRequest) {
    manifestRequest = fetch(MANIFEST_URL)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `MERRA-2 month index could not be loaded (HTTP ${response.status}).`,
          );
        const value: unknown = await response.json();
        return parseMerraManifest(value);
      })
      .catch((error: unknown) => {
        manifestRequest = undefined;
        throw error;
      });
  }
  return manifestRequest;
}
