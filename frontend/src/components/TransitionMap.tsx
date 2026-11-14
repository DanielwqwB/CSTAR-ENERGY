import { useEffect, useRef, useState } from "react";
import type { Map as MapInstance, Marker, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { TransitionEvent } from "../types";
import {
  atmosphericFootprints,
  DEMO_CENTER,
  BICOL_VIEW_BOUNDS,
  demoPosition,
  lightingCells,
  illustrativeNightLights,
  plumeHeatPoints,
} from "../data/mapGeometry";
import { Button } from "./ui";

function markerColor(event: TransitionEvent) {
  const palette: Record<string, string> = {
    "DEMO-001": "#007f9c", "DEMO-002": "#5b50cf",
    "DEMO-003": "#a56500", "DEMO-004": "#cf345c",
  };
  return palette[event.id] ?? "#435c76";
}

export function TransitionMap({
  events,
  selected,
  onSelect,
  plume = true,
  cells = true,
  height = 340,
  compact = false,
  candidates = true,
  cellOpacity = 0.3,
  plumeOpacity = 0.13,
  markerOpacity = 1,
  showLegend = true,
  showDetails = true,
  basemapStyle = "mapbox://styles/mapbox/light-v11",
  showPlumeHeatmap = false,
  comparisonYear,
  comparisonMode = "night",
}: {
  events: TransitionEvent[];
  selected?: string;
  onSelect: (event: TransitionEvent) => void;
  plume?: boolean;
  cells?: boolean;
  height?: number;
  compact?: boolean;
  candidates?: boolean;
  cellOpacity?: number;
  plumeOpacity?: number;
  markerOpacity?: number;
  showLegend?: boolean;
  showDetails?: boolean;
  basemapStyle?: string;
  showPlumeHeatmap?: boolean;
  comparisonYear?: number;
  comparisonMode?: "night" | "change" | "no2";
}) {
  const container = useRef<HTMLDivElement>(null);
  const sdk = useRef<typeof import("mapbox-gl").default | null>(null);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [status, setStatus] = useState("Loading Mapbox basemap…");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    let disposed = false;
    let instance: MapInstance | undefined;
    let observer: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setMap(null);
    setFailed(false);
    setStatus("Loading Mapbox basemap…");
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token || token === "pk.your_public_mapbox_token") {
      setFailed(true);
      setStatus(
        "Mapbox token is missing. Set VITE_MAPBOX_ACCESS_TOKEN in frontend/.env.local.",
      );
      return;
    }
    async function initialize() {
      try {
        const { default: mapbox } = await import("mapbox-gl");
        if (disposed || !container.current) return;
        if (!mapbox.supported()) throw new Error("WebGL unavailable");
        sdk.current = mapbox;
        instance = new mapbox.Map({
          container: container.current,
          accessToken: token,
          style: basemapStyle,
          center: DEMO_CENTER,
          zoom: 7,
          attributionControl: true,
        });
        instance.addControl(new mapbox.NavigationControl(), "top-right");
        instance.addControl(
          new mapbox.ScaleControl({ unit: "metric" }),
          "bottom-left",
        );
        instance.scrollZoom.disable();
        timeout = setTimeout(() => {
          if (!disposed) {
            setStatus(
              "Map is taking longer to load. Check your connection and Mapbox token restrictions.",
            );
            setFailed(true);
          }
        }, 20000);
        instance.on("error", () => {
          if (!disposed) {
            setStatus(
              "Some map resources could not load. Check your connection and Mapbox token permissions.",
            );
            setFailed(true);
          }
        });
        instance.on("load", () => {
          if (disposed || !instance) return;
          clearTimeout(timeout);
          instance.addSource("lighting-cells", {
            type: "geojson",
            data: lightingCells([]),
          });
          instance.addLayer({
            id: "lighting-cells",
            type: "fill",
            source: "lighting-cells",
            paint: {
              "fill-color": ["get", "color"],
              "fill-opacity": 0.3,
              "fill-outline-color": ["get", "color"],
            },
          });
          instance.addSource("atmospheric-footprints", {
            type: "geojson",
            data: atmosphericFootprints([]),
          });
          instance.addLayer({
            id: "atmospheric-footprints",
            type: "fill",
            source: "atmospheric-footprints",
            paint: {
              "fill-color": "#fbbf24",
              "fill-opacity": 0.13,
              "fill-outline-color": "#fbbf24",
            },
          });
          instance.addSource("illustrative-plume-heat", {
            type: "geojson",
            data: plumeHeatPoints([]),
          });
          instance.addLayer({
            id: "illustrative-plume-heat",
            type: "heatmap",
            source: "illustrative-plume-heat",
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": 1.3,
              "heatmap-radius": 55,
              "heatmap-opacity": 0.8,
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(90,45,220,0)", 0.15, "#6032cb", 0.4, "#b545d0", 0.65, "#f59e0b", 1, "#ffe026"],
            },
          });
          instance.addSource("illustrative-night-lights", {
            type: "geojson",
            data: illustrativeNightLights(2016),
          });
          instance.addLayer({
            id: "illustrative-night-lights",
            type: "heatmap",
            source: "illustrative-night-lights",
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": 1.5,
              "heatmap-radius": 18,
              "heatmap-opacity": 0.9,
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(255,180,0,0)", .2, "#d07b00", .5, "#ffbd19", .8, "#fff08a", 1, "#fffde8"],
            },
          });
          setStatus("");
          setFailed(false);
          setMap(instance);
        });
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => instance?.resize());
          observer.observe(container.current);
        }
      } catch {
        if (!disposed) {
          setFailed(true);
          setStatus(
            "Mapbox could not start. Check WebGL support, your connection, and token configuration. Events remain available below.",
          );
        }
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      observer?.disconnect();
      instance?.remove();
    };
  }, [attempt, basemapStyle]);
  useEffect(() => {
    if (!map || !sdk.current) return;
    (map.getSource("lighting-cells") as GeoJSONSource).setData(
      lightingCells(events),
    );
    (map.getSource("atmospheric-footprints") as GeoJSONSource).setData(
      atmosphericFootprints(events),
    );
    (map.getSource("illustrative-plume-heat") as GeoJSONSource).setData(
      plumeHeatPoints(events),
    );
    map.setLayoutProperty(
      "lighting-cells",
      "visibility",
      cells ? "visible" : "none",
    );
    map.setLayoutProperty(
      "atmospheric-footprints",
      "visibility",
      plume ? "visible" : "none",
    );
    map.setLayoutProperty("illustrative-plume-heat", "visibility", plume && showPlumeHeatmap ? "visible" : "none");
    map.setLayoutProperty("illustrative-night-lights", "visibility", comparisonYear === undefined ? "none" : "visible");
    const markers: Marker[] = (candidates ? events : []).map((event) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-event-marker";
      button.style.opacity = String(markerOpacity);
      button.style.setProperty("--event-color", markerColor(event));
      button.setAttribute(
        "aria-label",
        `Investigate ${event.id}, ${event.location}`,
      );
      button.setAttribute("aria-pressed", String(selected === event.id));
      button.title = `${event.id} · ${event.location} (synthetic location)`;
      const dot = document.createElement("span");
      dot.className = "map-event-number";
      dot.textContent = event.id.slice(-2);
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "map-event-label";
      label.textContent = event.id;
      button.append(dot, label);
      button.addEventListener("click", () => callback.current(event));
      return new sdk.current!.Marker({ element: button, anchor: "center" })
        .setLngLat(demoPosition(event))
        .addTo(map);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, events, selected, cells, plume, candidates, markerOpacity, showPlumeHeatmap, comparisonYear]);
  useEffect(() => {
    if (!map || comparisonYear === undefined) return;
    (map.getSource("illustrative-night-lights") as GeoJSONSource).setData(illustrativeNightLights(comparisonYear));
    const palette = comparisonMode === "change"
      ? ["rgba(0,170,240,0)", "#087caf", "#38bdf8", "#fff0a0", "#fff"]
      : comparisonMode === "no2"
        ? ["rgba(135,60,200,0)", "#6032cb", "#b545d0", "#f59e0b", "#ffe026"]
        : ["rgba(255,180,0,0)", "#d07b00", "#ffbd19", "#fff08a", "#fffde8"];
    map.setPaintProperty("illustrative-night-lights", "heatmap-color", ["interpolate", ["linear"], ["heatmap-density"], 0, palette[0], .2, palette[1], .5, palette[2], .8, palette[3], 1, palette[4]]);
  }, [map, comparisonYear, comparisonMode]);
  useEffect(() => {
    if (!map) return;
    map.fitBounds(BICOL_VIEW_BOUNDS, { padding: 36, duration: 0 });
  }, [map]);
  useEffect(() => {
    if (!map) return;
    map.setPaintProperty("lighting-cells", "fill-opacity", cellOpacity);
    map.setPaintProperty("atmospheric-footprints", "fill-opacity", plumeOpacity);
  }, [map, cellOpacity, plumeOpacity]);
  return (
    <div className="transition-map">
      <div className="map-frame" style={{ height }}>
        <div
          ref={container}
          className="map-canvas"
          aria-label="Mapbox demonstration event map"
        />
        <span className="map-caption">BICOL REGION - DEMONSTRATION</span>
        {status && (
          <div className="map-status" role="status">
            <span>{status}</span>
            {failed && (
              <Button
                label="Retry map"
                secondary
                onClick={() => setAttempt((value) => value + 1)}
              />
            )}
          </div>
        )}
      </div>
      {showLegend && <div className="map-legend">
        {cells && (
          <span>
            <i style={{ background: "#38bdf8" }} />
            Sample lighting cells (~500 m)
          </span>
        )}
        {plume && (
          <span>
            <i style={{ background: "#fbbf24" }} />
            Illustrative atmospheric footprint
          </span>
        )}
      </div>}
      <p className="map-disclaimer">
        Mapbox basemap · Fictional Aurelia events placed in Bicol Region for
        demonstration. Positions and overlays are not verified observations.
      </p>
      {showDetails && <details open={compact ? undefined : true} className="map-event-details"><summary>Demonstration events ({events.length})</summary>
      <div className="map-event-list" aria-label="Map events">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            aria-pressed={selected === event.id}
            onClick={() => onSelect(event)}
          >
            <i style={{ background: markerColor(event) }} />
            {event.id}
            <span>{event.location}</span>
          </button>
        ))}
      </div>
      </details>}
    </div>
  );
}
