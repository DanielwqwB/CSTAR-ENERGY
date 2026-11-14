import { useState } from "react";
import { Check, Cloud, Info, Layers, SlidersHorizontal, TriangleAlert, Wind } from "lucide-react";
import { TransitionMap } from "../components/TransitionMap";
import { Select } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { EventPicker } from "./InvestigationScreen";

const overpasses = [
  "Overpass 1 · Compatible",
  "Overpass 2 · Compatible",
  "Overpass 3 · Compatible",
  "Overpass 4 · Inconclusive",
  "Overpass 5 · Insufficient coverage",
];
const markerColors: Record<string, string> = { "DEMO-001": "#007f9c", "DEMO-002": "#5b50cf", "DEMO-003": "#a56500", "DEMO-004": "#cf345c" };

export function SourcePlumeScreen() {
  const { selected, events, select } = useWorkspace();
  const [pass, setPass] = useState(overpasses[0]);
  const compatible = pass.endsWith("Compatible");
  const indicators = [
    { title: "Quality-screened overpass", detail: compatible ? "Meets sample data quality and coverage requirements." : "This overpass does not support a compatible screening result.", checked: compatible },
    { title: "Wind alignment", detail: compatible ? selected.wind : "No reliable alignment for this overpass.", checked: compatible },
    { title: "Atmospheric enhancement", detail: selected.atmosphere, checked: compatible && selected.atmosphere.toLowerCase().includes("enhancement") },
    { title: "Source–plume coherence", detail: "Spatial consistency between source and footprint remains unverified.", checked: false },
    { title: "Competing source context", detail: selected.uncertainty, checked: false },
  ];
  return <div className="source-plume-screen">
    <div className="source-plume-picker"><span>Selected event</span><EventPicker /></div>
    <div className="source-plume-metrics">
      <div className="source-plume-metric blue"><span><Wind /></span><div><small>Candidate Sources</small><strong>{events.length}</strong><em>Demonstration candidates</em></div></div>
      <div className="source-plume-metric green"><span><Cloud /></span><div><small>Plume Detections</small><strong>{compatible ? "2" : "—"}</strong><em>{compatible ? "Illustrative footprints" : "No compatible sample"}</em></div></div>
      <div className="source-plume-metric amber"><span><Layers /></span><div><small>Valid Overpasses</small><strong>3 / 5</strong><em>Quality-screened samples</em></div></div>
      <div className="source-plume-metric violet"><span><TriangleAlert /></span><div><small>Screening Status</small><strong>{compatible ? "Compatible" : "Inconclusive"}</strong><em>{compatible ? "Sample wind alignment" : "Further screening needed"}</em></div></div>
    </div>
    <div className="source-plume-main">
      <section className="source-plume-panel source-plume-map-panel"><header><span className="source-plume-panel-icon"><Wind /></span><div><h2>Source–Plume Screening View</h2><p>Demonstration candidates and atmospheric footprint extent</p></div><div className="source-plume-header-legend"><span><i className="blue" />Sample lighting cells</span><span><i className="amber" />Atmospheric plume (NO₂)</span><span><i className="violet" />Candidate source</span></div></header><div className="source-plume-map-body"><div className="source-plume-map-wrap"><TransitionMap events={events} selected={selected.id} onSelect={event => select(event.id)} plume={compatible} height={390} showLegend={false} showDetails={false} showPlumeHeatmap plumeOpacity={0.07} basemapStyle="mapbox://styles/mapbox/satellite-streets-v12" />{compatible && <div className="source-plume-scale" aria-label="Illustrative atmospheric footprint intensity, low to high"><strong>Illustrative NO₂ footprint</strong><i /><span><small>Low</small><small>High</small></span></div>}</div></div></section>
      <section className="source-plume-panel source-plume-indicators"><header><span className="source-plume-panel-icon"><SlidersHorizontal /></span><div><h2>Screening Indicators</h2></div><span className={`source-plume-status ${compatible ? "good" : "pending"}`}>{compatible ? "3 / 5 Compatible" : "Inconclusive"}</span></header><div className="source-plume-indicator-list">{indicators.map(indicator => <div className="source-plume-indicator" key={indicator.title}><span className={indicator.checked ? "checked" : "unchecked"}>{indicator.checked && <Check size={14} />}</span><div><strong>{indicator.title}</strong><p>{indicator.detail}</p></div></div>)}</div></section>
    </div>
    <div className="source-plume-bottom">
      <section className="source-plume-panel source-plume-events"><header><span className="source-plume-panel-icon"><Layers /></span><div><h2>Demonstration Events ({events.length})</h2></div></header><div className="source-plume-event-grid">{events.map(event => <button type="button" key={event.id} aria-pressed={selected.id === event.id} onClick={() => select(event.id)}><i style={{ background: markerColors[event.id] || event.color }} /><span><strong>{event.id}</strong><small>{event.location}</small></span></button>)}</div></section>
      <section className="source-plume-panel source-plume-controls"><header><span className="source-plume-panel-icon"><SlidersHorizontal /></span><div><h2>Observation Controls</h2></div></header><div className="source-plume-control-body"><Select label="Quality-screened sample overpass" value={pass} options={overpasses} onChange={setPass} /><div className="source-plume-pills"><span className={compatible ? "good" : "pending"}><Check size={14} />{compatible ? "Wind alignment compatible" : "No reliable alignment"}</span><span><Wind size={14} />Illustrative winds · NE</span></div></div></section>
      <aside className="source-plume-caveat"><Info size={22} /><p>An atmospheric NO₂ enhancement located downwind may be consistent with a source, but wind alignment alone does not establish that the source caused the pollution.</p></aside>
    </div>
  </div>;
}
