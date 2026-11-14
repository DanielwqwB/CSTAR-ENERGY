import type { FeatureCollection, Point } from "geojson";

export interface BlackMarbleCellProperties {
  latitude: number;
  longitude: number;
  radiance: number;
  observationCount: number;
}

export type BlackMarbleCellCollection = FeatureCollection<
  Point,
  BlackMarbleCellProperties
>;

export interface BlackMarbleCell {
  latitude: number;
  longitude: number;
  radiance: number;
  observationCount: number;
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
