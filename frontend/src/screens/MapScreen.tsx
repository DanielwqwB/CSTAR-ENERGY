import { useState } from "react";
import { Expand, Layers, Moon, Wind } from "lucide-react";
import { TransitionMap } from "../components/TransitionMap";
import { useWorkspace } from "../context/WorkspaceContext";

const years = Array.from({ length: 11 }, (_, index) => 2016 + index);
type Mode = "night" | "change" | "no2";

export function MapScreen() {
  const { events, selected, select } = useWorkspace();
  const [year, setYear] = useState(2026);
  const [mode, setMode] = useState<Mode>("night");
  const [expanded, setExpanded] = useState(false);
  const map = (mapYear: number) => <TransitionMap
    events={events}
    selected={selected.id}
    onSelect={event => select(event.id)}
    basemapStyle="mapbox://styles/mapbox/dark-v11"
    comparisonYear={mapYear}
    comparisonMode={mode}
    cells={false}
    plume={false}
    candidates={false}
    showLegend={false}
    showDetails={false}
    height={470}
  />;
  return <section className={`regional-comparison ${expanded ? "expanded" : ""}`} aria-label="Regional year comparison map">
    <header className="regional-comparison-header"><span className="regional-comparison-icon"><Layers /></span><div><h2>Regional Transition Map</h2><p>Nighttime light intensity changes over time · illustrative VIIRS / Black Marble view</p></div><div className="regional-comparison-modes" role="group" aria-label="Map overlay"><button type="button" aria-pressed={mode === "night"} onClick={() => setMode("night")}><Moon size={15} />Night Light</button><button type="button" aria-pressed={mode === "change"} onClick={() => setMode("change")}><Layers size={15} />Change (Δ)</button><button type="button" aria-pressed={mode === "no2"} onClick={() => setMode("no2")}><Wind size={15} />NO₂ Overlay</button></div><button type="button" className="regional-comparison-expand" aria-label={expanded ? "Exit expanded map" : "Expand maps"} onClick={() => setExpanded(value => !value)}><Expand size={17} /></button></header>
    <div className="regional-comparison-years"><button type="button" aria-label="Play year comparison" onClick={() => setYear(year === 2026 ? 2016 : year + 1)}>▶</button><div className="regional-year-slider"><input type="range" min="2016" max="2026" step="1" value={year} aria-label="Comparison year" onChange={event => setYear(Number(event.target.value))} /><div className="regional-year-ticks">{years.map(tick => <button type="button" key={tick} aria-label={`Compare with ${tick}`} aria-current={year === tick ? "true" : undefined} onClick={() => setYear(tick)}>{tick}</button>)}</div></div><output aria-live="polite">2016 → {year}</output></div>
    <div className="regional-comparison-maps"><div className="regional-map-panel"><span className="regional-map-year">2016 · Baseline</span>{map(2016)}</div><div className="regional-map-divider" aria-hidden="true">↔</div><div className="regional-map-panel"><span className="regional-map-year">{year} · Comparison</span>{map(year)}<div className={`regional-map-intensity ${mode}`}><strong>{mode === "night" ? "Illustrative night light" : mode === "change" ? "Illustrative change" : "Illustrative NO₂ support"}</strong><i /><span><small>Low</small><small>High</small></span></div></div></div>
    <p className="regional-comparison-note">Mapbox dark basemap · Synthetic lighting patterns for interface demonstration only. Year selection does not display measured historical VIIRS, Black Marble, or NO₂ rasters.</p>
  </section>;
}
