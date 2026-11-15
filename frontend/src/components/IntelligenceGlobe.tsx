import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Crosshair,
  Globe2,
  MapPin,
  Pause,
  Play,
} from "lucide-react";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
} from "geojson";
import type { GeoJSONSource, Map as MapInstance } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  loadBlackMarbleForecast,
  loadBlackMarbleManifest,
  loadBlackMarbleMonth,
  type BlackMarbleCell,
  type BlackMarbleCellCollection,
  type BlackMarbleMonthlyManifest,
} from "../data/blackMarble";
import {
  loadTropomiManifest,
  loadTropomiMonth,
  type TropomiCellCollection,
  type TropomiCellProperties,
  type TropomiManifest,
} from "../data/tropomi";
import {
  loadMerraManifest,
  type MerraManifest,
} from "../data/merra";
import { AIAnalyticsChecklist } from "./AIAnalyticsChecklist";

type GlobeMode = "observed" | "forecast";
type Location = { latitude: number; longitude: number };
type RegionBounds = BlackMarbleMonthlyManifest["bounds"];

function centerOfBounds([west, south, east, north]: RegionBounds): [number, number] {
  return [(west + east) / 2, (south + north) / 2];
}

const EMPTY_CELLS: BlackMarbleCellCollection = {
  type: "FeatureCollection",
  features: [],
};
const EMPTY_TROPOMI_CELLS: TropomiCellCollection = {
  type: "FeatureCollection",
  features: [],
};
const GRATICULE: FeatureCollection<LineString> = createGraticule();

function createGraticule(): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let longitude = -180; longitude < 180; longitude += 30) {
    const coordinates: [number, number][] = [];
    for (let latitude = -80; latitude <= 80; latitude += 5)
      coordinates.push([longitude, latitude]);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    });
  }
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const coordinates: [number, number][] = [];
    for (let longitude = -180; longitude <= 180; longitude += 5)
      coordinates.push([longitude, latitude]);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return value === 12
    ? `${year + 1}-01`
    : `${year}-${String(value + 1).padStart(2, "0")}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function collectionByGridIndex(
  collection: BlackMarbleCellCollection | undefined,
) {
  const cells = new Map<number, BlackMarbleCell>();
  for (const feature of collection?.features ?? []) {
    const { gridIndex } = feature.properties;
    if (gridIndex !== undefined) cells.set(gridIndex, feature.properties);
  }
  return cells;
}

function nearestCell(
  cells: BlackMarbleCellCollection,
  location: Location,
) {
  let closest: BlackMarbleCell | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  const longitudeScale = Math.cos((location.latitude * Math.PI) / 180);
  for (const feature of cells.features) {
    const { longitude, latitude } = feature.properties;
    const dx = (longitude - location.longitude) * longitudeScale;
    const dy = latitude - location.latitude;
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closest = feature.properties;
      closestDistance = distance;
    }
  }
  return closest;
}

function nearestTropomiCell(
  cells: TropomiCellCollection | undefined,
  location: Location,
): TropomiCellProperties | undefined {
  let closest: TropomiCellProperties | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  const longitudeScale = Math.cos((location.latitude * Math.PI) / 180);
  for (const feature of cells?.features ?? []) {
    const { longitude, latitude } = feature.properties;
    const dx = (longitude - location.longitude) * longitudeScale;
    const dy = latitude - location.latitude;
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closest = feature.properties;
      closestDistance = distance;
    }
  }
  return closest;
}

function isWithinBounds(
  location: Location,
  [west, south, east, north]: RegionBounds,
) {
  return (
    location.longitude >= west &&
    location.longitude <= east &&
    location.latitude >= south &&
    location.latitude <= north
  );
}

function selectedCellCollection(
  cell: BlackMarbleCell | undefined,
): BlackMarbleCellCollection {
  if (!cell) return EMPTY_CELLS;
  const feature: Feature<Point, BlackMarbleCell> = {
    type: "Feature",
    properties: cell,
    geometry: {
      type: "Point",
      coordinates: [cell.longitude, cell.latitude],
    },
  };
  return { type: "FeatureCollection", features: [feature] };
}

function positiveRadianceCells(
  cells: BlackMarbleCellCollection | undefined,
): BlackMarbleCellCollection {
  return cells
    ? {
        type: "FeatureCollection",
        features: cells.features.filter(
          (feature) => feature.properties.radiance > 0,
        ),
      }
    : EMPTY_CELLS;
}

export function IntelligenceGlobe({
  onOpenMap,
}: {
  onOpenMap?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const activeCellsRef = useRef<BlackMarbleCellCollection>(EMPTY_CELLS);
  const observedCellsRef = useRef<BlackMarbleCellCollection>(EMPTY_CELLS);
  const forecastCellsRef = useRef<BlackMarbleCellCollection>(EMPTY_CELLS);
  const tropomiCellsRef = useRef<TropomiCellCollection>(EMPTY_TROPOMI_CELLS);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [manifest, setManifest] = useState<BlackMarbleMonthlyManifest>();
  const [tropomiManifest, setTropomiManifest] = useState<TropomiManifest>();
  const [merraManifest, setMerraManifest] = useState<MerraManifest>();
  const [manifestError, setManifestError] = useState("");
  const [dataError, setDataError] = useState("");
  const [tropomiError, setTropomiError] = useState("");
  const [merraError, setMerraError] = useState("");
  const [mapError, setMapError] = useState("");
  const [month, setMonth] = useState("");
  const [mode, setMode] = useState<GlobeMode>("observed");
  const [checkedLayers, setCheckedLayers] = useState<Record<string, boolean>>({
    "black-marble": true,
    forest: false,
    tropomi: false,
    merra: false,
  });
  const [observedCells, setObservedCells] =
    useState<BlackMarbleCellCollection>();
  const [previousObservedCells, setPreviousObservedCells] =
    useState<BlackMarbleCellCollection>();
  const [monthForecastCells, setMonthForecastCells] =
    useState<BlackMarbleCellCollection>();
  const [nextForecastCells, setNextForecastCells] =
    useState<BlackMarbleCellCollection>();
  const [tropomiCells, setTropomiCells] =
    useState<TropomiCellCollection>();
  const [paused, setPaused] = useState(false);
  const [selectedGridIndex, setSelectedGridIndex] = useState<number>();
  const [selectedLocation, setSelectedLocation] = useState<Location>();
  const [coveredByDataset, setCoveredByDataset] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [placeError, setPlaceError] = useState("");

  useEffect(() => {
    let active = true;
    loadBlackMarbleManifest()
      .then((value) => {
        if (!active) return;
        setManifest(value);
        setMonth(value.latestObservedMonth);
      })
      .catch((error: unknown) => {
        if (active)
          setManifestError(
            errorText(error, "Black Marble month index could not be loaded."),
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadMerraManifest()
      .then((value) => {
        if (active) setMerraManifest(value);
      })
      .catch((error: unknown) => {
        if (active)
          setMerraError(
            errorText(error, "MERRA-2 monthly context could not be loaded."),
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadTropomiManifest()
      .then((value) => {
        if (active) setTropomiManifest(value);
      })
      .catch((error: unknown) => {
        if (active)
          setTropomiError(
            errorText(error, "TROPOMI month index could not be loaded."),
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const currentIsObserved = Boolean(manifest?.months.includes(month));
  const currentHasForecast = Boolean(manifest?.forecastMonths.includes(month));
  const currentMode =
    currentHasForecast && (!currentIsObserved || mode === "forecast")
      ? "forecast"
      : "observed";
  const nextForecastMonth =
    currentMode === "forecast" || !currentIsObserved
      ? month
      : nextMonth(month);
  const previousObservedMonth = useMemo(
    () =>
      manifest?.months
        .filter((availableMonth) => availableMonth < month)
        .sort()
        .pop(),
    [manifest, month],
  );

  useEffect(() => {
    if (!manifest || !month) return;
    let active = true;
    setDataError("");
    setObservedCells(undefined);
    setMonthForecastCells(undefined);
    setNextForecastCells(undefined);

    if (manifest.months.includes(month)) {
      loadBlackMarbleMonth(month)
        .then((cells) => {
          if (active) setObservedCells(cells);
        })
        .catch((error: unknown) => {
          if (active)
            setDataError(
              errorText(error, `Observed Black Marble data for ${month} failed to load.`),
            );
        });
    }

    if (manifest.forecastMonths.includes(month)) {
      loadBlackMarbleForecast(month)
        .then((cells) => {
          if (active) setMonthForecastCells(cells);
        })
        .catch((error: unknown) => {
          if (active)
            setDataError(
              errorText(error, `The Random Forest forecast for ${month} failed to load.`),
            );
        });
    }

    if (
      manifest.forecastMonths.includes(nextForecastMonth) &&
      nextForecastMonth !== month
    ) {
      loadBlackMarbleForecast(nextForecastMonth)
        .then((cells) => {
          if (active) setNextForecastCells(cells);
        })
        .catch((error: unknown) => {
          if (active)
            setDataError(
              errorText(
                error,
                `The Random Forest forecast for ${nextForecastMonth} failed to load.`,
              ),
            );
        });
    }

    return () => {
      active = false;
    };
  }, [currentMode, manifest, month, nextForecastMonth]);

  useEffect(() => {
    if (!checkedLayers.tropomi || !tropomiManifest?.months.includes(month)) {
      setTropomiCells(undefined);
      return;
    }

    let active = true;
    setTropomiCells(undefined);
    setTropomiError("");
    loadTropomiMonth(month)
      .then((cells) => {
        if (active) setTropomiCells(cells);
      })
      .catch((error: unknown) => {
        if (active)
          setTropomiError(
            errorText(error, `TROPOMI grid data for ${month} failed to load.`),
          );
      });
    return () => {
      active = false;
    };
  }, [checkedLayers.tropomi, month, tropomiManifest]);

  useEffect(() => {
    if (selectedGridIndex === undefined || !previousObservedMonth) {
      setPreviousObservedCells(undefined);
      return;
    }

    let active = true;
    setPreviousObservedCells(undefined);
    loadBlackMarbleMonth(previousObservedMonth)
      .then((cells) => {
        if (active) setPreviousObservedCells(cells);
      })
      .catch((error: unknown) => {
        if (active)
          setDataError(
            errorText(
              error,
              `The previous observed Black Marble data for ${previousObservedMonth} failed to load.`,
            ),
          );
      });

    return () => {
      active = false;
    };
  }, [previousObservedMonth, selectedGridIndex]);

  const activeCells =
    currentMode === "forecast" ? monthForecastCells : observedCells;
  const observedMapCells = useMemo(
    () => positiveRadianceCells(observedCells),
    [observedCells],
  );
  const forecastCellsForMap =
    currentMode === "forecast" ? monthForecastCells : nextForecastCells;
  const forecastMapCells = useMemo(
    () => positiveRadianceCells(forecastCellsForMap),
    [forecastCellsForMap],
  );
  const observedByGridIndex = useMemo(
    () => collectionByGridIndex(observedCells),
    [observedCells],
  );
  const previousObservedByGridIndex = useMemo(
    () => collectionByGridIndex(previousObservedCells),
    [previousObservedCells],
  );
  const monthForecastByGridIndex = useMemo(
    () => collectionByGridIndex(monthForecastCells),
    [monthForecastCells],
  );
  const nextForecastByGridIndex = useMemo(
    () => collectionByGridIndex(nextForecastCells),
    [nextForecastCells],
  );
  const activeByGridIndex =
    currentMode === "forecast"
      ? monthForecastByGridIndex
      : observedByGridIndex;
  const forecastByGridIndex =
    currentMode === "forecast"
      ? monthForecastByGridIndex
      : nextForecastByGridIndex;
  const selectedObserved =
    selectedGridIndex === undefined
      ? undefined
      : observedByGridIndex.get(selectedGridIndex);
  const previousObserved =
    selectedGridIndex === undefined
      ? undefined
      : previousObservedByGridIndex.get(selectedGridIndex);
  const selectedActive =
    selectedGridIndex === undefined
      ? undefined
      : activeByGridIndex.get(selectedGridIndex);
  const selectedForecast =
    selectedGridIndex === undefined
      ? undefined
      : forecastByGridIndex.get(selectedGridIndex);
  const selectedTropomi = selectedLocation
    ? nearestTropomiCell(tropomiCells, selectedLocation)
    : undefined;
  const merraRecord = merraManifest?.records.find(
    (record) => record.month === month,
  );
  const displayMonth =
    currentMode === "forecast" ? month : nextForecastMonth;
  const availableLayers = {
    "black-marble": currentIsObserved,
    forest: Boolean(manifest?.forecastMonths.includes(displayMonth)),
    tropomi: Boolean(tropomiManifest?.months.includes(month)),
    merra: Boolean(merraRecord),
  };
  const activeLayers = {
    "black-marble":
      checkedLayers["black-marble"] && availableLayers["black-marble"],
    forest: checkedLayers.forest && availableLayers.forest,
    tropomi: checkedLayers.tropomi && availableLayers.tropomi,
    merra: checkedLayers.merra && availableLayers.merra,
  };
  const availableMonths = useMemo(
    () =>
      manifest
        ? Array.from(
            new Set([
              ...manifest.months,
              ...manifest.forecastMonths,
              ...(tropomiManifest?.months ?? []),
              ...(merraManifest?.months ?? []),
            ]),
          ).sort()
        : [],
    [manifest, merraManifest, tropomiManifest],
  );

  useEffect(() => {
    activeCellsRef.current = activeCells ?? EMPTY_CELLS;
    observedCellsRef.current = observedMapCells;
    forecastCellsRef.current = forecastMapCells;
  }, [activeCells, forecastMapCells, observedMapCells]);

  useEffect(() => {
    tropomiCellsRef.current = tropomiCells ?? EMPTY_TROPOMI_CELLS;
  }, [tropomiCells]);

  useEffect(() => {
    if (
      !activeCells ||
      !selectedLocation ||
      !coveredByDataset ||
      selectedGridIndex !== undefined
    )
      return;
    const closest = nearestCell(activeCells, selectedLocation);
    if (!closest || closest.gridIndex === undefined) return;
    setSelectedGridIndex(closest.gridIndex);
    setSelectedLocation({
      latitude: closest.latitude,
      longitude: closest.longitude,
    });
    const mapInstance = mapRef.current;
    mapInstance?.easeTo({
      center: [closest.longitude, closest.latitude],
      zoom: Math.max(mapInstance.getZoom(), 7.5),
      duration: 900,
    });
  }, [activeCells, coveredByDataset, selectedGridIndex, selectedLocation]);

  useEffect(() => {
    if (!selectedLocation || !coveredByDataset) {
      setPlaceName("");
      setPlaceError("");
      return;
    }
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      setPlaceName("");
      setPlaceError("Place-name lookup requires a Mapbox access token.");
      return;
    }
    const controller = new AbortController();
    setPlaceName("");
    setPlaceError("");
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${selectedLocation.longitude},${selectedLocation.latitude}.json`,
    );
    url.searchParams.set("types", "place,locality,neighborhood,district,region");
    url.searchParams.set("limit", "1");
    url.searchParams.set("access_token", token);
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Place lookup failed (HTTP ${response.status}).`);
        return response.json();
      })
      .then((value: { features?: { place_name?: string }[] }) => {
        const label = value.features?.[0]?.place_name;
        if (!label) throw new Error("No mapped place name was returned.");
        setPlaceName(label);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPlaceError(
            errorText(error, "Place name is unavailable; coordinates are shown."),
          );
      });
    return () => controller.abort();
  }, [coveredByDataset, selectedLocation]);

  useEffect(() => {
    if (!manifest) return;
    const activeManifest = manifest;
    let disposed = false;
    let instance: MapInstance | undefined;
    let observer: ResizeObserver | undefined;
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token || token === "pk.your_public_mapbox_token") {
      setMapError(
        "Mapbox token is missing. Set VITE_MAPBOX_ACCESS_TOKEN in frontend/.env.local.",
      );
      return;
    }

    async function initialize() {
      try {
        const { default: mapbox } = await import("mapbox-gl");
        if (disposed || !containerRef.current) return;
        if (!mapbox.supported()) throw new Error("WebGL is unavailable.");
        instance = new mapbox.Map({
          container: containerRef.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/dark-v11",
          center: centerOfBounds(activeManifest.bounds),
          zoom: 1.65,
          projection: { name: "globe" },
          attributionControl: true,
        });
        mapRef.current = instance;
        instance.addControl(new mapbox.NavigationControl(), "top-left");
        instance.scrollZoom.setWheelZoomRate(1 / 120);
        instance.scrollZoom.enable();
        instance.touchZoomRotate.enable();
        instance.on("wheel", () => setPaused(true));
        instance.on("dragstart", () => setPaused(true));
        instance.on("error", (event) => {
          if (!disposed)
            setMapError(
              event.error?.message ?? "A globe map resource could not load.",
            );
        });
        instance.on("load", () => {
          if (disposed || !instance) return;
          instance.setFog({
            color: "#102132",
            "high-color": "#1a3b54",
            "space-color": "#03070c",
            "star-intensity": 0.06,
          });
          const styleLayers = instance.getStyle().layers ?? [];
          const firstBoundaryLayer = styleLayers.find(
            (layer) => layer.type === "line" && /admin.*boundary/i.test(layer.id),
          );
          const firstSymbolLayer = styleLayers.find(
            (layer) => layer.type === "symbol",
          );
          instance.addSource("globe-terrain-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
          instance.addLayer(
            {
              id: "globe-terrain-hillshade",
              type: "hillshade",
              source: "globe-terrain-dem",
              paint: {
                "hillshade-exaggeration": 0.22,
                "hillshade-shadow-color": "#101a25",
                "hillshade-highlight-color": "#91a8bd",
                "hillshade-accent-color": "#566c81",
              },
            },
            firstBoundaryLayer?.id ?? firstSymbolLayer?.id,
          );
          for (const layer of styleLayers) {
            if (layer.type !== "line" || !/admin.*boundary/i.test(layer.id))
              continue;
            instance.setPaintProperty(layer.id, "line-color", "#70869b");
            instance.setPaintProperty(layer.id, "line-opacity", 0.62);
            instance.setPaintProperty(layer.id, "line-width", [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.45,
              6,
              1.1,
            ]);
          }
          instance.addSource("globe-graticule", {
            type: "geojson",
            data: GRATICULE,
          });
          instance.addLayer({
            id: "globe-graticule",
            type: "line",
            source: "globe-graticule",
            paint: {
              "line-color": "#a7bfd5",
              "line-opacity": 0.2,
              "line-width": 0.7,
            },
          });
          instance.addSource("globe-tropomi-no2", {
            type: "geojson",
            data: tropomiCellsRef.current,
          });
          instance.addSource("globe-blackmarble-cells", {
            type: "geojson",
            data: observedCellsRef.current,
          });
          instance.addLayer({
            id: "globe-blackmarble-glow",
            type: "heatmap",
            source: "globe-blackmarble-cells",
            filter: [">", ["get", "radiance"], 0],
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "radiance"],
                0,
                0,
                0.5,
                0.2,
                5,
                0.75,
                30,
                1,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                0.95,
                5,
                2.1,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                4,
                3,
                13,
                7,
                25,
              ],
              "heatmap-opacity": 0.96,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(255,131,20,0)",
                0.2,
                "rgba(255,119,18,0.28)",
                0.48,
                "#f47b16",
                0.72,
                "#ffc248",
                1,
                "#fff1bd",
              ],
            },
          });
          instance.addLayer({
            id: "globe-blackmarble-cells",
            type: "circle",
            source: "globe-blackmarble-cells",
            minzoom: 3,
            filter: [">", ["get", "radiance"], 0],
            paint: {
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "radiance"],
                0,
                "#ff9d20",
                0.5,
                "#ffb72b",
                5,
                "#ff5c22",
                30,
                "#fff3c4",
              ],
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                1,
                6,
                2.5,
                9,
                5,
              ],
              "circle-opacity": 0.96,
              "circle-blur": 0.16,
              "circle-stroke-color": "#ffe0a0",
              "circle-stroke-width": 0.35,
            },
          });
          instance.addSource("globe-rf-forecast-source", {
            type: "geojson",
            data: forecastCellsRef.current,
          });
          instance.addLayer({
            id: "globe-rf-forecast-glow",
            type: "heatmap",
            source: "globe-rf-forecast-source",
            layout: { visibility: "none" },
            filter: [">", ["get", "radiance"], 0],
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "radiance"],
                0,
                0,
                0.5,
                0.2,
                5,
                0.75,
                30,
                1,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                0.9,
                5,
                2,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                3,
                3,
                10,
                7,
                22,
              ],
              "heatmap-opacity": 0.9,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(25,190,224,0)",
                0.2,
                "rgba(25,190,224,0.28)",
                0.48,
                "#16a9c8",
                0.72,
                "#62dced",
                1,
                "#d8faff",
              ],
            },
          });
          instance.addLayer({
            id: "globe-rf-forecast-cells",
            type: "circle",
            source: "globe-rf-forecast-source",
            minzoom: 3,
            layout: { visibility: "none" },
            filter: [">", ["get", "radiance"], 0],
            paint: {
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "increaseProbability"],
                0,
                "#2379a6",
                0.5,
                "#38bdd2",
                1,
                "#d8faff",
              ],
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                1,
                6,
                2.5,
                9,
                5,
              ],
              "circle-opacity": 0.94,
              "circle-blur": 0.15,
              "circle-stroke-color": "#c7f7ff",
              "circle-stroke-width": 0.35,
            },
          });
          instance.addLayer({
            id: "globe-tropomi-no2-grid",
            type: "fill",
            source: "globe-tropomi-no2",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "interpolate",
                ["linear"],
                ["get", "no2ColumnMolM2"],
                -0.000001,
                "#586b89",
                0,
                "#607d9a",
                0.000002,
                "#38a9c8",
                0.000006,
                "#a7d576",
                0.00001,
                "#ffc15b",
                0.000015,
                "#ed705b",
              ],
              "fill-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                2,
                0.36,
                5,
                0.65,
                8,
                0.78,
              ],
              "fill-outline-color": "rgba(202,235,255,0.26)",
            },
          });
          instance.addSource("globe-selected-cell", {
            type: "geojson",
            data: EMPTY_CELLS,
          });
          instance.addLayer({
            id: "globe-selected-cell",
            type: "circle",
            source: "globe-selected-cell",
            paint: {
              "circle-radius": 11,
              "circle-color": "#fff3c4",
              "circle-opacity": 0.32,
              "circle-stroke-color": "#fff9e6",
              "circle-stroke-width": 2,
            },
          });
          instance.on("click", (event) => {
            const location = {
              latitude: event.lngLat.lat,
              longitude: event.lngLat.lng,
            };
            setPaused(true);
            setSelectedLocation(location);
            setSelectedGridIndex(undefined);
            const covered = isWithinBounds(location, activeManifest.bounds);
            setCoveredByDataset(covered);
            if (!covered) return;
            const closest = nearestCell(activeCellsRef.current, location);
            if (!closest || closest.gridIndex === undefined) return;
            setSelectedLocation({
              latitude: closest.latitude,
              longitude: closest.longitude,
            });
            setSelectedGridIndex(closest.gridIndex);
            instance?.easeTo({
              center: [closest.longitude, closest.latitude],
              zoom: Math.max(instance.getZoom(), 7.5),
              duration: 900,
            });
          });
          setMapError("");
          setMap(instance);
        });
        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          observer = new ResizeObserver(() => instance?.resize());
          observer.observe(containerRef.current);
        }
      } catch (error: unknown) {
        if (!disposed)
          setMapError(
            errorText(
              error,
              "The interactive globe could not start. Check WebGL and the Mapbox token.",
            ),
          );
      }
    }
    void initialize();
    return () => {
      disposed = true;
      observer?.disconnect();
      mapRef.current = null;
      instance?.remove();
    };
  }, [manifest]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(
      "globe-blackmarble-cells",
    ) as GeoJSONSource | undefined;
    source?.setData(observedMapCells);
  }, [map, observedMapCells]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource("globe-tropomi-no2") as
      | GeoJSONSource
      | undefined;
    source?.setData(tropomiCells ?? EMPTY_TROPOMI_CELLS);
  }, [map, tropomiCells]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(
      "globe-rf-forecast-source",
    ) as GeoJSONSource | undefined;
    source?.setData(forecastMapCells);
  }, [forecastMapCells, map]);

  useEffect(() => {
    if (!map) return;
    const observedVisibility = activeLayers["black-marble"]
      ? "visible"
      : "none";
    const forecastVisibility = activeLayers.forest ? "visible" : "none";
    const tropomiVisibility = activeLayers.tropomi ? "visible" : "none";
    map.setLayoutProperty(
      "globe-tropomi-no2-grid",
      "visibility",
      tropomiVisibility,
    );
    for (const layer of [
      "globe-blackmarble-glow",
      "globe-blackmarble-cells",
    ]) {
      map.setLayoutProperty(layer, "visibility", observedVisibility);
    }
    for (const layer of [
      "globe-rf-forecast-glow",
      "globe-rf-forecast-cells",
    ]) {
      map.setLayoutProperty(layer, "visibility", forecastVisibility);
    }
  }, [
    activeLayers["black-marble"],
    activeLayers.forest,
    activeLayers.tropomi,
    map,
  ]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource("globe-selected-cell") as
      | GeoJSONSource
      | undefined;
    source?.setData(selectedCellCollection(selectedActive));
  }, [map, selectedActive]);

  useEffect(() => {
    if (!map || paused) return;
    let frame = 0;
    let lastStep = 0;
    const rotate = (time: number) => {
      if (time - lastStep >= 50) {
        const center = map.getCenter();
        map.setCenter([center.lng + 0.035, center.lat]);
        lastStep = time;
      }
      frame = requestAnimationFrame(rotate);
    };
    frame = requestAnimationFrame(rotate);
    return () => cancelAnimationFrame(frame);
  }, [map, paused]);

  function chooseMonth(value: string) {
    setMonth(value);
    setMode("observed");
    setDataError("");
  }

  function toggleLayer(id: string, checked: boolean) {
    setCheckedLayers((current) => ({ ...current, [id]: checked }));
  }

  const modelMetrics = manifest?.metrics;
  const observedChange =
    selectedObserved && previousObserved
      ? selectedObserved.radiance - previousObserved.radiance
      : undefined;
  const insightLocation = selectedLocation
    ? placeName ||
      `${selectedLocation.latitude.toFixed(4)}°, ${selectedLocation.longitude.toFixed(4)}°`
    : undefined;
  const insightSentences = (() => {
    if (!selectedLocation) {
      if (!manifest || !modelMetrics)
        return ["Loading verified Black Marble observations and model metrics."];
      return [
        `This globe shows quality-screened ${manifest.product} nighttime radiance for ${manifest.region} in months present in the generated dataset.`,
        `The trained Random Forest predicts one calendar month ahead; chronological holdout direction accuracy was ${(modelMetrics.direction.accuracy * 100).toFixed(1)}% across ${modelMetrics.test_samples.toLocaleString()} cell-months, and its probabilities are not calibrated.`,
        "Select a covered cell to review its measured radiance, valid-observation count, earlier available observation, and forecast where those assets exist.",
        "Nighttime radiance measures brightness, not electricity use, and does not establish a cause or intervention effect.",
      ];
    }

    if (!coveredByDataset) {
      return [
        `The selected point at ${insightLocation} is outside the ${manifest?.region ?? "study-region"} data bounds.`,
        "No observed cell value or model forecast is available here, so no change direction can be reported.",
        "Missing geographic coverage is not a zero-radiance measurement.",
        "Use an appropriate local dataset and records to assess this location.",
      ];
    }

    const observedSentence = selectedObserved
      ? `Observed: Black Marble radiance at ${insightLocation} was ${selectedObserved.radiance.toFixed(3)} ${manifest?.units ?? ""} for ${month}, from ${selectedObserved.observationCount.toLocaleString()} valid source observations.`
      : previousObserved
        ? `Observed: the latest available quality-screened value at ${insightLocation} was ${previousObserved.radiance.toFixed(3)} ${manifest?.units ?? ""} for ${previousObservedMonth}, from ${previousObserved.observationCount.toLocaleString()} valid source observations; no current observation is available for ${month}.`
        : `Observed: no valid quality-screened cell value is available at ${insightLocation} for ${month}; the missing value is not treated as zero.`;
    const comparisonSentence =
      observedChange !== undefined && previousObservedMonth
        ? `Compared with ${previousObservedMonth}, measured radiance ${Math.abs(observedChange) <= (modelMetrics?.regression.mae ?? 0) ? "remained relatively stable" : observedChange > 0 ? "increased" : "decreased"} by ${Math.abs(observedChange).toFixed(3)} ${manifest?.units ?? ""}; “relatively stable” means within the model's held-out MAE, not statistical significance.`
        : `A month-to-month observed change cannot be calculated for ${month} because both valid observations are not available.`;
    const predictionBaseline = selectedObserved ?? previousObserved;
    const predictedDirection = selectedForecast
      ? selectedForecast.increaseProbability !== undefined
        ? selectedForecast.increaseProbability >= 0.5
          ? "increase"
          : "decrease"
        : predictionBaseline
          ? selectedForecast.radiance >= predictionBaseline.radiance
            ? "increase"
            : "decrease"
          : undefined
      : undefined;
    const predictionSentence = selectedForecast
      ? `Model estimate: the Random Forest predicts ${selectedForecast.radiance.toFixed(3)} ${manifest?.units ?? ""} for ${displayMonth}${predictedDirection ? `, with a direction estimate of ${predictedDirection}` : ""}${selectedForecast.increaseProbability === undefined ? "." : ` and an uncalibrated increase score of ${(selectedForecast.increaseProbability * 100).toFixed(1)}%.`}`
      : `Model estimate: no Random Forest cell forecast is available for ${displayMonth}.`;

    return [
      observedSentence,
      comparisonSentence,
      predictionSentence,
      "Possible explanations such as changing local activity, lighting infrastructure, outages, or observation conditions are unverified; radiance is not electricity use and does not identify a cause.",
      "Verify the cell against local records and independent imagery before taking action.",
    ];
  })();

  return (
    <section
      className="intelligence-globe"
      aria-label="Interactive Black Marble intelligence globe"
    >
      <header className="intelligence-globe-header">
        <div className="intelligence-globe-title">
          <span>
            <Globe2 size={20} />
          </span>
          <div>
            <h2>Black Marble Intelligence Globe</h2>
            <p>
              Rotating global view · location-specific VNP46A3 observations for{" "}
              {manifest?.region ?? "the study region"}
            </p>
          </div>
        </div>
        {onOpenMap && (
          <button
            type="button"
            className="intelligence-globe-open-map"
            onClick={onOpenMap}
          >
            Open full map <ArrowUpRight size={15} />
          </button>
        )}
        <div className="intelligence-globe-controls">
          <label>
            Map month
            <select
              aria-label="Globe map month"
              value={month}
              onChange={(event) => chooseMonth(event.target.value)}
              disabled={!manifest}
            >
              {availableMonths.map((value) => (
                <option key={value} value={value}>
                  {value}
                  {!manifest?.months.includes(value) &&
                  manifest?.forecastMonths.includes(value)
                    ? " · forecast"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {currentIsObserved && currentHasForecast && (
            <div className="intelligence-globe-modes" aria-label="Globe layer">
              <button
                type="button"
                aria-pressed={currentMode === "observed"}
                onClick={() => setMode("observed")}
              >
                Observed
              </button>
              <button
                type="button"
                aria-pressed={currentMode === "forecast"}
                onClick={() => setMode("forecast")}
              >
                Forecast
              </button>
            </div>
          )}
        </div>
      </header>

      {(manifestError || dataError || tropomiError || merraError || mapError) && (
        <p className="intelligence-globe-error" role="alert">
          {manifestError || dataError || tropomiError || merraError || mapError}
        </p>
      )}

      <div className="intelligence-globe-grid">
        <aside className="intelligence-globe-side intelligence-globe-location">
          <span className="intelligence-globe-eyebrow">
            <MapPin size={14} /> LOCATION INTELLIGENCE
          </span>
          <h3>
            {placeName ||
              (selectedLocation
                ? coveredByDataset
                  ? `${manifest?.region ?? "Study region"} cell`
                  : "Outside data coverage"
                : "Select a point on the globe")}
          </h3>
          {selectedLocation ? (
            <>
              <p className="intelligence-globe-coordinates">
                {selectedLocation.latitude.toFixed(5)}°,{" "}
                {selectedLocation.longitude.toFixed(5)}°
              </p>
              {placeError && <p className="intelligence-globe-place-error">{placeError}</p>}
              {coveredByDataset ? (
                <dl className="intelligence-globe-values">
                  <div>
                    <dt>Observed radiance · {month}</dt>
                    <dd>
                      {selectedObserved
                        ? `${selectedObserved.radiance.toFixed(3)} ${manifest?.units ?? ""}`
                        : "No valid cell value"}
                    </dd>
                  </div>
                  <div>
                    <dt>Valid source observations</dt>
                    <dd>
                      {selectedObserved
                        ? selectedObserved.observationCount.toLocaleString()
                        : "Not available"}
                    </dd>
                  </div>
                  {checkedLayers.tropomi && (
                    <>
                        <div>
                          <dt>Monthly TROPOMI NO₂ column · {month}</dt>
                          <dd>
                            {!availableLayers.tropomi
                              ? "No grid for this month"
                              : selectedTropomi
                                ? `${(selectedTropomi.no2ColumnMolM2 * 1_000_000).toFixed(2)} µmol/m²`
                                : tropomiError
                                  ? "Grid failed to load"
                                  : tropomiCells
                                    ? "No valid cell at this location"
                                    : "Loading monthly grid"}
                          </dd>
                        </div>
                        {selectedTropomi && (
                          <div>
                            <dt>TROPOMI QA / valid pixels</dt>
                            <dd>
                              {selectedTropomi.qaMean.toFixed(3)} /{" "}
                              {selectedTropomi.validPixelCount.toLocaleString()}
                            </dd>
                          </div>
                        )}
                    </>
                  )}
                  {currentMode === "forecast" && (
                    <div>
                      <dt>Forecast radiance · {month}</dt>
                      <dd>
                        {selectedActive
                          ? `${selectedActive.radiance.toFixed(3)} ${manifest?.units ?? ""}`
                          : "No forecast value"}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="intelligence-globe-no-coverage">
                  The current Black Marble grid covers{" "}
                  {manifest?.region ?? "the study region"} only. This location
                  has no supported observation or forecast.
                </p>
              )}
            </>
          ) : (
            <p className="intelligence-globe-prompt">
              Click the globe to pause rotation and inspect the nearest
              quality-screened cell.
            </p>
          )}
          <AIAnalyticsChecklist
            activeLayers={activeLayers}
            availableLayers={availableLayers}
            onLayerToggle={toggleLayer}
          />
          {checkedLayers.merra && merraRecord && merraManifest && (
            <section
              className="intelligence-globe-merra-context"
              aria-label="MERRA-2 regional wind context"
            >
              <h3>
                <a
                  href={merraManifest.sourceCatalog}
                  target="_blank"
                  rel="noreferrer"
                >
                  MERRA-2 area mean
                </a>{" "}
                · {month}
              </h3>
              <dl className="intelligence-globe-values">
                <div>
                  <dt>10 m eastward wind component</dt>
                  <dd>
                    {merraRecord.u10mMeanMps.toFixed(2)}{" "}
                    {merraManifest.units}
                  </dd>
                </div>
                <div>
                  <dt>10 m northward wind component</dt>
                  <dd>
                    {merraRecord.v10mMeanMps.toFixed(2)}{" "}
                    {merraManifest.units}
                  </dd>
                </div>
                <div>
                  <dt>Valid hourly component pairs</dt>
                  <dd>
                    {merraRecord.validHourPairs.toLocaleString()} /{" "}
                    {merraRecord.expectedHourCount.toLocaleString()}
                    {!merraRecord.completeMonth && " · partial month"}
                  </dd>
                </div>
              </dl>
              <small className="intelligence-globe-source">
                {merraManifest.scopeNote}
              </small>
            </section>
          )}
          <small className="intelligence-globe-source">
            NASA VNP46A3 Collection 2 ·{" "}
            {manifest?.cellCount.toLocaleString() ?? "—"} cells ·{" "}
            {manifest?.months.length ?? "—"} usable observed months
          </small>
          {tropomiManifest && (
            <small className="intelligence-globe-source">
              <a
                href={tropomiManifest.sourceCatalog}
                target="_blank"
                rel="noreferrer"
              >
                Sentinel-5P TROPOMI
              </a>{" "}
              · {tropomiManifest.months[0]}–
              {tropomiManifest.months[tropomiManifest.months.length - 1]} ·{" "}
              {tropomiManifest.gridDegrees}° monthly grid, not native footprints
            </small>
          )}
        </aside>

        <div className="intelligence-globe-center">
          <div className="intelligence-globe-map-tools">
            <span>{paused ? "ROTATION PAUSED" : "AUTOROTATING"}</span>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume globe rotation" : "Pause globe rotation"}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPaused(true);
                mapRef.current?.easeTo({
                  center: manifest ? centerOfBounds(manifest.bounds) : [0, 0],
                  zoom: 4.5,
                  duration: 900,
                });
              }}
            >
              <Crosshair size={14} /> Focus {manifest?.region ?? "region"}
            </button>
          </div>
          <div
            ref={containerRef}
            className="intelligence-globe-canvas"
            aria-label="Interactive globe with Black Marble, TROPOMI, and Random Forest layers"
          />
        </div>

        <aside className="intelligence-globe-side intelligence-globe-forecast">
          <span className="intelligence-globe-eyebrow">
            <Crosshair size={14} /> CELL SCREENING
          </span>
          <h3>
            {selectedLocation
              ? `Model outlook · ${displayMonth}`
              : "One-month Random Forest"}
          </h3>
          {selectedLocation && coveredByDataset ? (
            <>
              <dl className="intelligence-globe-values">
                <div>
                  <dt>Predicted radiance</dt>
                  <dd>
                    {selectedForecast
                      ? `${selectedForecast.radiance.toFixed(3)} ${manifest?.units ?? ""}`
                      : "Forecast unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Probability of increase</dt>
                  <dd>
                    {selectedForecast?.increaseProbability !== undefined
                      ? `${(selectedForecast.increaseProbability * 100).toFixed(1)}%`
                      : "Unavailable"}
                  </dd>
                </div>
                {selectedForecast?.increaseProbability !== undefined && (
                  <div className="intelligence-globe-probability">
                    <progress
                      aria-label="Cell probability of radiance increase"
                      max="1"
                      value={selectedForecast.increaseProbability}
                    />
                  </div>
                )}
              </dl>
            </>
          ) : selectedLocation ? (
            <p className="intelligence-globe-no-coverage">
              No cell-level model output is available outside the{" "}
              {manifest?.region ?? "study region"} grid.
            </p>
          ) : (
            <p className="intelligence-globe-prompt">
              Select a lit location to see the cell forecast and evidence-based
              insights.
            </p>
          )}
          {modelMetrics && (
            <div className="intelligence-globe-model-metrics">
              <strong>Chronological holdout</strong>
              <span>
                Direction accuracy{" "}
                <b>{(modelMetrics.direction.accuracy * 100).toFixed(1)}%</b>
              </span>
              <span>
                Balanced accuracy{" "}
                <b>
                  {(modelMetrics.direction.balanced_accuracy * 100).toFixed(1)}%
                </b>
              </span>
              <span>
                Radiance MAE{" "}
                <b>
                  {modelMetrics.regression.mae.toFixed(3)} {manifest?.units}
                </b>
              </span>
              <small>
                {modelMetrics.test_samples.toLocaleString()} held-out
                cell-months · exploratory model; probabilities are not
                calibrated
              </small>
            </div>
          )}
          <section className="intelligence-globe-insights" aria-label="AI Insights">
            <h4>AI Insights</h4>
            <p>{insightSentences.join(" ")}</p>
          </section>
        </aside>
      </div>

      <p className="intelligence-globe-footnote">
        Scroll or pinch to zoom and drag to rotate. Cells use actual{" "}
        {manifest?.region ?? "study-region"} coordinates. Click outside the
        study area to see the coverage limitation, or use Focus{" "}
        {manifest?.region ?? "region"} to return to the data region.
      </p>
    </section>
  );
}
