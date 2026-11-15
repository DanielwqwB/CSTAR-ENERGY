import type { FeatureCollection, Point } from "geojson";
import { fetchGzip } from "./fetchGzip";

export interface BlackMarbleCellProperties {
  gridIndex?: number;
  latitude: number;
  longitude: number;
  radiance: number;
  observationCount: number;
  increaseProbability?: number;
  isForecast?: boolean;
}

export type BlackMarbleCellCollection = FeatureCollection<
  Point,
  BlackMarbleCellProperties
>;

export interface BlackMarbleCell {
  gridIndex?: number;
  latitude: number;
  longitude: number;
  radiance: number;
  observationCount: number;
  increaseProbability?: number;
  isForecast?: boolean;
}

export interface BlackMarbleMonthlyManifest {
  formatVersion: number;
  region: string;
  bounds: [number, number, number, number];
  product: string;
  layer: string;
  units: string;
  quality: string;
  cellCount: number;
  months: string[];
  forecastMonths: string[];
  latestObservedMonth: string;
  futureForecastMonth: string;
  observedValueFormat: string;
  forecastValueFormat: string;
  gridValueFormat: string;
  model: string;
  metrics: {
    regression: { mae: number; rmse: number };
    direction: {
      accuracy: number;
      balanced_accuracy: number;
      precision: number;
      recall: number;
      f1: number;
      roc_auc: number | null;
    };
    test_samples: number;
    test_pairs: number;
    test_period: { start: string; end: string };
    target: string;
    feature_names: string[];
    disclaimer: string;
  };
  disclaimer: string;
}

const MANIFEST_URL = "/data/blackmarble/manifest.json";
const GRID_URL = "/data/blackmarble/grid.bin.gz";
let manifestRequest: Promise<BlackMarbleMonthlyManifest> | undefined;
let gridRequest: Promise<Float32Array> | undefined;
const observationsCache = new Map<
  string,
  Promise<BlackMarbleCellCollection>
>();
const forecastCache = new Map<string, Promise<BlackMarbleCellCollection>>();
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

function isManifest(value: unknown): value is BlackMarbleMonthlyManifest {
  if (!isRecord(value) || !isRecord(value.metrics)) return false;
  const { metrics } = value;
  if (
    !isRecord(metrics.regression) ||
    !isRecord(metrics.direction) ||
    !isRecord(metrics.test_period)
  )
    return false;
  const { regression, direction, test_period } = metrics;
  return (
    Number.isInteger(value.formatVersion) &&
    typeof value.region === "string" &&
    Array.isArray(value.bounds) &&
    value.bounds.length === 4 &&
    value.bounds.every(isFiniteNumber) &&
    typeof value.product === "string" &&
    typeof value.layer === "string" &&
    typeof value.units === "string" &&
    typeof value.quality === "string" &&
    Number.isInteger(value.cellCount) &&
    typeof value.cellCount === "number" &&
    value.cellCount > 0 &&
    Array.isArray(value.months) &&
    value.months.every(isMonth) &&
    Array.isArray(value.forecastMonths) &&
    value.forecastMonths.every(isMonth) &&
    typeof value.latestObservedMonth === "string" &&
    typeof value.futureForecastMonth === "string" &&
    typeof value.observedValueFormat === "string" &&
    typeof value.forecastValueFormat === "string" &&
    typeof value.gridValueFormat === "string" &&
    typeof value.model === "string" &&
    isFiniteNumber(regression.mae) &&
    isFiniteNumber(regression.rmse) &&
    isFiniteNumber(direction.accuracy) &&
    isFiniteNumber(direction.balanced_accuracy) &&
    isFiniteNumber(direction.precision) &&
    isFiniteNumber(direction.recall) &&
    isFiniteNumber(direction.f1) &&
    (direction.roc_auc === null || isFiniteNumber(direction.roc_auc)) &&
    Number.isInteger(metrics.test_samples) &&
    Number.isInteger(metrics.test_pairs) &&
    typeof test_period.start === "string" &&
    typeof test_period.end === "string" &&
    typeof metrics.target === "string" &&
    Array.isArray(metrics.feature_names) &&
    metrics.feature_names.every((item) => typeof item === "string") &&
    typeof metrics.disclaimer === "string" &&
    typeof value.disclaimer === "string"
  );
}

function readFloat32View(buffer: ArrayBuffer, count: number): Float32Array {
  if (buffer.byteLength !== count * Float32Array.BYTES_PER_ELEMENT)
    throw new Error("Black Marble grid data has an unexpected size.");
  const values = new Float32Array(count);
  const view = new DataView(buffer);
  for (let index = 0; index < count; index += 1)
    values[index] = view.getFloat32(index * 4, true);
  return values;
}

export function parseBlackMarbleGrid(
  buffer: ArrayBuffer,
  cellCount: number,
): Float32Array {
  if (!Number.isInteger(cellCount) || cellCount < 1)
    throw new Error("Black Marble grid cell count is invalid.");
  const expectedLength = cellCount * 2 * Float32Array.BYTES_PER_ELEMENT;
  if (buffer.byteLength !== expectedLength)
    throw new Error("Black Marble grid data has an unexpected size.");
  const coordinates = new Float32Array(cellCount * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < cellCount; index += 1) {
    const longitude = view.getFloat32(index * 8, true);
    const latitude = view.getFloat32(index * 8 + 4, true);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    )
      throw new Error(`Invalid coordinate in Black Marble grid cell ${index}.`);
    coordinates[index * 2] = longitude;
    coordinates[index * 2 + 1] = latitude;
  }
  return coordinates;
}

function collectionFromValues(
  coordinates: Float32Array,
  radiance: Float32Array,
  observationCount: Uint16Array,
  increaseProbability?: Float32Array,
): BlackMarbleCellCollection {
  if (
    coordinates.length !== radiance.length * 2 ||
    observationCount.length !== radiance.length ||
    (increaseProbability && increaseProbability.length !== radiance.length)
  )
    throw new Error("Black Marble cell data does not match the grid.");

  const features: BlackMarbleCellCollection["features"] = [];
  for (let index = 0; index < radiance.length; index += 1) {
    const value = radiance[index];
    const count = observationCount[index];
    if (!Number.isFinite(value) || (!increaseProbability && count < 1)) continue;
    const probability = increaseProbability?.[index];
    if (
      probability !== undefined &&
      (!Number.isFinite(probability) || probability < 0 || probability > 1)
    )
      continue;
    const longitude = coordinates[index * 2];
    const latitude = coordinates[index * 2 + 1];
    features.push({
      type: "Feature",
      properties: {
        gridIndex: index,
        latitude,
        longitude,
        radiance: value,
        observationCount: count,
        ...(probability !== undefined
          ? { increaseProbability: probability, isForecast: true }
          : {}),
      },
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
    });
  }
  if (!features.length)
    throw new Error("Black Marble cell data contains no valid cells.");
  return { type: "FeatureCollection", features };
}

export function parseBlackMarbleObservations(
  buffer: ArrayBuffer,
  coordinates: Float32Array,
): BlackMarbleCellCollection {
  const cellCount = coordinates.length / 2;
  if (!Number.isInteger(cellCount) || buffer.byteLength !== cellCount * 6)
    throw new Error("Black Marble observation data has an unexpected size.");
  const radiance = new Float32Array(cellCount);
  const observationCount = new Uint16Array(cellCount);
  const view = new DataView(buffer);
  for (let index = 0; index < cellCount; index += 1) {
    radiance[index] = view.getFloat32(index * 4, true);
    observationCount[index] = view.getUint16(cellCount * 4 + index * 2, true);
  }
  return collectionFromValues(coordinates, radiance, observationCount);
}

export function parseBlackMarbleForecast(
  buffer: ArrayBuffer,
  coordinates: Float32Array,
): BlackMarbleCellCollection {
  const cellCount = coordinates.length / 2;
  if (!Number.isInteger(cellCount) || buffer.byteLength !== cellCount * 8)
    throw new Error("Black Marble forecast data has an unexpected size.");
  const radiance = readFloat32View(buffer.slice(0, cellCount * 4), cellCount);
  const probability = readFloat32View(
    buffer.slice(cellCount * 4),
    cellCount,
  );
  return collectionFromValues(
    coordinates,
    radiance,
    new Uint16Array(cellCount),
    probability,
  );
}

export async function loadBlackMarbleManifest(): Promise<BlackMarbleMonthlyManifest> {
  if (!manifestRequest) {
    manifestRequest = fetch(MANIFEST_URL)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Black Marble month index could not be loaded (HTTP ${response.status}).`,
          );
        const value: unknown = await response.json();
        if (!isManifest(value))
          throw new Error("Black Marble month index is invalid.");
        return value;
      })
      .catch((error: unknown) => {
        manifestRequest = undefined;
        throw error;
      });
  }
  return manifestRequest;
}

async function loadGrid(): Promise<Float32Array> {
  if (!gridRequest) {
    gridRequest = loadBlackMarbleManifest()
      .then(async (manifest) => {
        const buffer = await fetchGzip(GRID_URL);
        return parseBlackMarbleGrid(buffer, manifest.cellCount);
      })
      .catch((error: unknown) => {
        gridRequest = undefined;
        throw error;
      });
  }
  return gridRequest;
}

function trimCache(cache: Map<string, Promise<BlackMarbleCellCollection>>) {
  while (cache.size > MAX_CACHED_MONTHS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

export async function loadBlackMarbleMonth(
  month: string,
): Promise<BlackMarbleCellCollection> {
  const manifest = await loadBlackMarbleManifest();
  if (!manifest.months.includes(month))
    throw new Error(`No observed Black Marble grid is available for ${month}.`);
  const cached = observationsCache.get(month);
  if (cached) return cached;
  const request = Promise.all([
    loadGrid(),
    fetchGzip(`/data/blackmarble/observations/${month}.bin.gz`),
  ])
    .then(([coordinates, buffer]) =>
      parseBlackMarbleObservations(buffer, coordinates),
    )
    .catch((error: unknown) => {
      observationsCache.delete(month);
      throw error;
    });
  observationsCache.set(month, request);
  trimCache(observationsCache);
  return request;
}

export async function loadBlackMarbleForecast(
  month: string,
): Promise<BlackMarbleCellCollection> {
  const manifest = await loadBlackMarbleManifest();
  if (!manifest.forecastMonths.includes(month))
    throw new Error(`No Random Forest forecast is available for ${month}.`);
  const cached = forecastCache.get(month);
  if (cached) return cached;
  const request = Promise.all([
    loadGrid(),
    fetchGzip(`/data/blackmarble/forecasts/${month}.bin.gz`),
  ])
    .then(([coordinates, buffer]) => parseBlackMarbleForecast(buffer, coordinates))
    .catch((error: unknown) => {
      forecastCache.delete(month);
      throw error;
    });
  forecastCache.set(month, request);
  trimCache(forecastCache);
  return request;
}

export function parseBlackMarbleCellCsv(
  csv: string,
): BlackMarbleCellCollection {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== "latitude,longitude,radiance,observation_count")
    throw new Error("Unexpected Black Marble cell data format.");

  const features = lines
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const values = line.split(",");
      if (values.length !== 4)
        throw new Error(`Invalid Black Marble cell row ${index + 2}.`);
      const [latitude, longitude, radiance, observationCount] =
        values.map(Number);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(radiance) ||
        !Number.isInteger(observationCount) ||
        observationCount < 1 ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        radiance < 0
      )
        throw new Error(`Invalid Black Marble cell row ${index + 2}.`);

      return {
        type: "Feature" as const,
        properties: {
          latitude,
          longitude,
          radiance,
          observationCount,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude] as [number, number],
        },
      };
    });

  if (features.length === 0)
    throw new Error("Black Marble cell data contains no mapped cells.");

  return { type: "FeatureCollection", features };
}
