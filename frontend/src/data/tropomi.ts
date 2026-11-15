import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import { fetchGzip } from "./fetchGzip";

export interface TropomiCellProperties {
  month: string;
  cellId: string;
  longitude: number;
  latitude: number;
  no2ColumnMolM2: number;
  no2ColumnStdMolM2: number;
  qaMean: number;
  validPixelCount: number;
  validOrbitCount: number;
}

export type TropomiCellCollection = FeatureCollection<
  Polygon,
  TropomiCellProperties
>;

export interface TropomiManifest {
  formatVersion: number;
  region: string;
  bounds: [number, number, number, number];
  product: string;
  units: string;
  gridDegrees: number;
  qaThreshold: number;
  months: string[];
  monthlyCellCounts: Record<string, number>;
  sourceCatalog: string;
  scopeNote: string;
}

const MANIFEST_URL = "/data/tropomi/manifest.json";
let manifestRequest: Promise<TropomiManifest> | undefined;
const monthRequests = new Map<string, Promise<TropomiCellCollection>>();
const MAX_CACHED_MONTHS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function isManifest(value: unknown): value is TropomiManifest {
  if (!isRecord(value) || !isRecord(value.monthlyCellCounts)) return false;
  const counts = value.monthlyCellCounts;
  return (
    Number.isInteger(value.formatVersion) &&
    typeof value.region === "string" &&
    Array.isArray(value.bounds) &&
    value.bounds.length === 4 &&
    value.bounds.every(isFiniteNumber) &&
    typeof value.product === "string" &&
    typeof value.units === "string" &&
    isFiniteNumber(value.gridDegrees) &&
    value.gridDegrees > 0 &&
    isFiniteNumber(value.qaThreshold) &&
    Array.isArray(value.months) &&
    value.months.length > 0 &&
    value.months.every(isMonth) &&
    value.months.every(
      (month) => Number.isInteger(counts[month]) && Number(counts[month]) > 0,
    ) &&
    typeof value.sourceCatalog === "string" &&
    typeof value.scopeNote === "string"
  );
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function isRing(value: unknown): value is Position[] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition))
    return false;
  const first = value[0];
  const last = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isTropomiFeature(
  value: unknown,
  month: string,
): value is Feature<Polygon, TropomiCellProperties> {
  if (!isRecord(value) || value.type !== "Feature") return false;
  const properties = value.properties;
  const geometry = value.geometry;
  if (
    !isRecord(properties) ||
    !isRecord(geometry) ||
    geometry.type !== "Polygon" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length !== 1 ||
    !isRing(geometry.coordinates[0])
  )
    return false;
  return (
    properties.month === month &&
    typeof properties.cellId === "string" &&
    isFiniteNumber(properties.longitude) &&
    isFiniteNumber(properties.latitude) &&
    properties.longitude >= -180 &&
    properties.longitude <= 180 &&
    properties.latitude >= -90 &&
    properties.latitude <= 90 &&
    isFiniteNumber(properties.no2ColumnMolM2) &&
    isFiniteNumber(properties.no2ColumnStdMolM2) &&
    properties.no2ColumnStdMolM2 >= 0 &&
    isFiniteNumber(properties.qaMean) &&
    properties.qaMean >= 0 &&
    properties.qaMean <= 1 &&
    Number.isInteger(properties.validPixelCount) &&
    Number(properties.validPixelCount) > 0 &&
    Number.isInteger(properties.validOrbitCount) &&
    Number(properties.validOrbitCount) > 0
  );
}

export function parseTropomiCells(
  value: unknown,
  month: string,
): TropomiCellCollection {
  if (
    !isRecord(value) ||
    value.type !== "FeatureCollection" ||
    !Array.isArray(value.features)
  )
    throw new Error("TROPOMI monthly grid has an invalid GeoJSON structure.");

  const features: TropomiCellCollection["features"] = [];
  for (const feature of value.features) {
    if (!isTropomiFeature(feature, month))
      throw new Error("TROPOMI monthly grid contains an invalid cell.");
    features.push(feature);
  }
  if (!features.length)
    throw new Error(`No valid TROPOMI grid cells are available for ${month}.`);
  return { type: "FeatureCollection", features };
}

export async function loadTropomiManifest(): Promise<TropomiManifest> {
  if (!manifestRequest) {
    manifestRequest = fetch(MANIFEST_URL)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `TROPOMI month index could not be loaded (HTTP ${response.status}).`,
          );
        const value: unknown = await response.json();
        if (!isManifest(value))
          throw new Error("TROPOMI month index is invalid.");
        return value;
      })
      .catch((error: unknown) => {
        manifestRequest = undefined;
        throw error;
      });
  }
  return manifestRequest;
}

export async function loadTropomiMonth(
  month: string,
): Promise<TropomiCellCollection> {
  const manifest = await loadTropomiManifest();
  if (!manifest.months.includes(month))
    throw new Error(`No TROPOMI monthly grid is available for ${month}.`);
  const cached = monthRequests.get(month);
  if (cached) return cached;

  const request = fetchGzip(
    `/data/tropomi/observations/${month}.geojson.gz`,
  )
    .then((buffer) => {
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(buffer));
      } catch {
        throw new Error(`TROPOMI grid data for ${month} is not valid JSON.`);
      }
      return parseTropomiCells(value, month);
    })
    .catch((error: unknown) => {
      monthRequests.delete(month);
      throw error;
    });
  monthRequests.set(month, request);
  while (monthRequests.size > MAX_CACHED_MONTHS) {
    const oldest = monthRequests.keys().next().value;
    if (oldest === undefined) break;
    monthRequests.delete(oldest);
  }
  return request;
}
