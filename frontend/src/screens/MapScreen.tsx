import { useState } from "react";
import { Layers, Info, MapPin, Factory, CalendarDays, TrendingUp, Crosshair, Database, ArrowLeft, ArrowRight, TriangleAlert } from "lucide-react";
import { TransitionMap } from "../components/TransitionMap";
import { useWorkspace } from "../context/WorkspaceContext";

export function MapScreen() {
  const { events, selected, select, go } = useWorkspace();
  const [layers, setLayers] = useState({ cells: true, plume: true, candidates: true });
  const [opacity, setOpacity] = useState({ cells: 30, plume: 13, candidates: 100 });
  const index = events.findIndex(event => event.id === selected.id);
  const controls: { key?: keyof typeof layers; label: string; note: string }[] = [
    { key: "cells", label: "Nighttime Radiance Cells", note: "Illustrative ~500 m cells" },
    { label: "Radiance Change", note: "Change raster not connected" },
    { label: "Atmospheric NO?", note: "NO? raster not connected" },
    { label: "Wind Direction", note: "Wind vectors not connected" },
    { label: "Industrial Areas", note: "Industrial boundaries not connected" },
    { label: "Road Networks", note: "Separate road overlay not connected" },
    { label: "Built-up Areas", note: "Land-cover overlay not connected" },
    { key: "candidates", label: "Candidate Zones", note: "Synthetic event markers" },
    { key: "plume", label: "Atmospheric Footprints", note: "Illustrative atmospheric support" },
  ];
  const cycle = (direction: number) => { if (events.length) select(events[(index + direction + events.length) % events.length].id); };
  return <div className="monitoring-layout">
    <aside className="monitoring-panel layer-panel" aria-label="Map layers">
      <header><Layers size={22} /><h2>Map Layers</h2><Info size={18} /></header>
      <div className="layer-controls">{controls.map(({ key, label, note }, index) => <div className={`layer-control ${key ? "" : "layer-pending"}`} key={label}>
        <label className="layer-toggle"><span>{label}</span><input type="checkbox" role="switch" aria-describedby={`layer-note-${index}`} disabled={!key} checked={key ? layers[key] : false} onChange={event => { if (key) setLayers({ ...layers, [key]: event.target.checked }); }} /><span className="switch-track" aria-hidden="true" /></label>
        <input type="range" min={0} max={100} value={key ? opacity[key] : 0} disabled={!key || !layers[key]} aria-label={`${label} opacity`} onChange={event => { if (key) setOpacity({ ...opacity, [key]: Number(event.target.value) }); }} />
        <div className="layer-caption"><span id={`layer-note-${index}`}>{note}</span>{key && <output>{opacity[key]}%</output>}</div>
      </div>)}</div>
      <button className="layer-data-link" onClick={() => go("data")}>Explore data sources <ArrowRight size={15} /></button>
    </aside>
    <section className="monitoring-map" aria-label="Transition monitoring map">
      <TransitionMap events={events} selected={selected.id} onSelect={event => select(event.id)} cells={layers.cells} plume={layers.plume} candidates={layers.candidates} cellOpacity={opacity.cells / 100} plumeOpacity={opacity.plume / 100} markerOpacity={opacity.candidates / 100} height={620} compact />
    </section>
    <aside className="monitoring-panel zone-panel" aria-label="Selected transition zone">
      <header><MapPin size={21} /><h2>Selected Transition Zone</h2><div className="zone-pager"><button aria-label="Previous transition zone" disabled={events.length < 2} onClick={() => cycle(-1)}><ArrowLeft size={16} /></button><span>{index + 1} of {events.length}</span><button aria-label="Next transition zone" disabled={events.length < 2} onClick={() => cycle(1)}><ArrowRight size={16} /></button></div></header>
      <div className="zone-highlight"><span><Factory size={30} /></span><div><h3>{selected.location}</h3><p>{selected.mechanism}</p></div></div>
      <dl className="zone-facts">{[
        { label: "Observation period", value: selected.onset, icon: CalendarDays },
        { label: "Transition type", value: selected.radiance, icon: TrendingUp },
        { label: "Key finding", value: selected.atmosphere, icon: Crosshair },
        { label: "Data coverage", value: selected.adequacy, icon: Layers },
        { label: "Data readiness", value: selected.verification, icon: Database },
      ].map(({ label, value, icon: Glyph }) => <div key={label}><Glyph size={22} /><div><dt>{label}</dt><dd>{value}</dd></div></div>)}</dl>
      <div className="zone-warning"><TriangleAlert size={24} /><p>Demonstration imagery and footprints are illustrative. No field validation is conducted in this mode.</p></div>
      <button className="investigate-zone" onClick={() => go("investigation")}>Investigate Event <ArrowRight size={19} /></button>
    </aside>
  </div>;
}
