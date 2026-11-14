import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
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

const BICOL_DATA_BOUNDS: [[number, number], [number, number]] = [
  [122.3, 11.4],
  [124.7, 14.6],
];

type GlobeMode = "observed" | "forecast";
type Location = { latitude: number; longitude: number };

const EMPTY_CELLS: BlackMarbleCellCollection = {
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

function isWithinBicol(location: Location) {
  const [[west, south], [east, north]] = BICOL_DATA_BOUNDS;
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

export function IntelligenceGlobe({
  onOpenMap,
}: {
  onOpenMap?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const activeCellsRef = useRef<BlackMarbleCellCollection>(EMPTY_CELLS);
  const visibleCellsRef = useRef<BlackMarbleCellCollection>(EMPTY_CELLS);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [manifest, setManifest] = useState<BlackMarbleMonthlyManifest>();
  const [manifestError, setManifestError] = useState("");
  const [dataError, setDataError] = useState("");
  const [mapError, setMapError] = useState("");
  const [month, setMonth] = useState("");
  const [mode, setMode] = useState<GlobeMode>("observed");
  const [observedCells, setObservedCells] =
    useState<BlackMarbleCellCollection>();
  const [monthForecastCells, setMonthForecastCells] =
    useState<BlackMarbleCellCollection>();
  const [nextForecastCells, setNextForecastCells] =
    useState<BlackMarbleCellCollection>();
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

  const currentIsObserved = Boolean(manifest?.months.includes(month));
  const currentHasForecast = Boolean(manifest?.forecastMonths.includes(month));
  const currentMode =
    !currentIsObserved || (mode === "forecast" && currentHasForecast)
      ? "forecast"
      : "observed";
  const nextForecastMonth =
    currentMode === "forecast" ? month : nextMonth(month);

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

  const activeCells =
    currentMode === "forecast" ? monthForecastCells : observedCells;
  const visibleCells = useMemo(
    () =>
      activeCells
        ? {
            type: "FeatureCollection" as const,
            features: activeCells.features.filter(
              (feature) => feature.properties.radiance > 0,
            ),
          }
        : EMPTY_CELLS,
    [activeCells],
  );
  const observedByGridIndex = useMemo(
    () => collectionByGridIndex(observedCells),
    [observedCells],
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
  const selectedActive =
    selectedGridIndex === undefined
      ? undefined
      : activeByGridIndex.get(selectedGridIndex);
  const selectedForecast =
    selectedGridIndex === undefined
      ? undefined
      : forecastByGridIndex.get(selectedGridIndex);
  const displayMonth =
    currentMode === "forecast" ? month : nextForecastMonth;
  const availableMonths = useMemo(
    () =>
      manifest
        ? Array.from(
            new Set([...manifest.months, ...manifest.forecastMonths]),
          ).sort()
        : [],
    [manifest],
  );

  useEffect(() => {
    activeCellsRef.current = activeCells ?? EMPTY_CELLS;
    visibleCellsRef.current = visibleCells;
  }, [activeCells, visibleCells]);

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
          center: [123.3, 13.05],
          zoom: 1.65,
          projection: { name: "globe" },
          attributionControl: true,
        });
        mapRef.current = instance;
        instance.addControl(new mapbox.NavigationControl(), "top-left");
        instance.scrollZoom.enable();
        instance.on("error", (event) => {
          if (!disposed)
            setMapError(
              event.error?.message ?? "A globe map resource could not load.",
            );
        });
        instance.on("load", () => {
          if (disposed || !instance) return;
          instance.addSource("globe-graticule", {
            type: "geojson",
            data: GRATICULE,
          });
          instance.addLayer({
            id: "globe-graticule",
            type: "line",
            source: "globe-graticule",
            paint: {
              "line-color": "#9cb7d2",
              "line-opacity": 0.16,
              "line-width": 0.6,
            },
          });
          instance.addSource("globe-blackmarble-cells", {
            type: "geojson",
            data: visibleCellsRef.current,
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
                0.7,
                5,
                1.8,
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
              "circle-opacity": 0.9,
              "circle-blur": 0.25,
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
            const covered = isWithinBicol(location);
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
  }, []);

  useEffect(() => {
    if (!map || !visibleCells) return;
    const source = map.getSource(
      "globe-blackmarble-cells",
    ) as GeoJSONSource | undefined;
    source?.setData(visibleCells);
  }, [map, visibleCells]);

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

  const modelMetrics = manifest?.metrics;

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
              Rotating global view · location-specific VNP46A3 observations for
              Bicol Region
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
                  {!manifest?.months.includes(value) ? " · forecast" : ""}
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

      {(manifestError || dataError || mapError) && (
        <p className="intelligence-globe-error" role="alert">
          {manifestError || dataError || mapError}
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
                  ? "Bicol cell"
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
                  The current Black Marble grid covers Bicol only. This
                  location has no supported observation or forecast.
                </p>
              )}
            </>
          ) : (
            <p className="intelligence-globe-prompt">
              Click the globe to pause rotation and inspect the nearest
              quality-screened cell.
            </p>
          )}
          <small className="intelligence-globe-source">
            NASA VNP46A3 Collection 2 · quality-screened land cells ·{" "}
            {manifest?.months.length ?? "—"} usable observed months
          </small>
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
                  center: [123.3, 13.05],
                  zoom: 4.5,
                  duration: 900,
                });
              }}
            >
              <Crosshair size={14} /> Focus Bicol
            </button>
          </div>
          <div
            ref={containerRef}
            className="intelligence-globe-canvas"
            aria-label="Rotating globe showing Black Marble radiance cells"
          />
          <div className="intelligence-globe-map-caption">
            <span className="intelligence-globe-light-key" />
            Black Marble radiance
            <span className="intelligence-globe-caption-date">
              {currentMode === "forecast" ? "RF FORECAST" : "OBSERVED"} ·{" "}
              {month || "Loading"}
            </span>
          </div>
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
              {selectedForecast && (
                <p className="intelligence-globe-action">
                  {selectedForecast.increaseProbability !== undefined &&
                  selectedForecast.increaseProbability >= 0.5
                    ? "Corroborate this cell with local lighting records or independent imagery before taking action."
                    : "Continue monitoring and verify decisions against independent imagery or local records."}
                  {" "}Screening prompt only; not a causal impact finding.
                </p>
              )}
            </>
          ) : selectedLocation ? (
            <p className="intelligence-globe-no-coverage">
              No cell-level model output is available outside the Bicol study
              grid.
            </p>
          ) : (
            <p className="intelligence-globe-prompt">
              Select a lit location to see the cell forecast and evidence-based
              follow-up prompt.
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
        </aside>
      </div>

      {selectedForecast && selectedObserved && (
        <p className="intelligence-globe-change">
          {selectedForecast.radiance >= selectedObserved.radiance ? (
            <ArrowUpRight size={14} aria-label="Predicted increase" />
          ) : (
            <ArrowDownRight size={14} aria-label="Predicted decrease" />
          )}
          Forecast compared with the selected observed cell. Results are
          screening signals, not evidence of cause or intervention impact.
        </p>
      )}
      <p className="intelligence-globe-footnote">
        The globe is a geographic view; lights are drawn at their actual Bicol
        cell coordinates. Click outside the study area to see the coverage
        limitation, or use Focus Bicol to return to the data region.
      </p>
    </section>
  );
}
