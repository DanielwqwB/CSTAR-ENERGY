import { useState } from "react";
import { Activity, CalendarDays, Camera, Check, ClipboardCheck, FileText, Fingerprint, Info, Layers, MapPin, Network, Scale, ShieldCheck, TrendingUp, Wind, Zap } from "lucide-react";
import { Button, Select } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { EventPicker } from "./InvestigationScreen";

const mechanismOptions = ["Lighting-system modernization", "Combustion-associated industrial expansion", "Mixed/unresolved transition", "Unresolved"];

export function AttributionScreen() {
  const { selected, update, notify } = useWorkspace();
  const [expanded, setExpanded] = useState<string | null>(null);
  const industrial = selected.shortType === "Industrial";
  const rows = [
    { label: "Radiance Change", detail: selected.radiance, status: selected.adequacy === "Insufficient" ? "Inconclusive" : "Supporting", strength: 92, icon: TrendingUp },
    { label: "Change Persistence", detail: "Observed across multiple illustrative monthly composites", status: selected.adequacy === "Insufficient" ? "Missing" : "Supporting", strength: 88, icon: Wind },
    { label: "Transition Timing", detail: selected.onset, status: "Supporting", strength: 80, icon: CalendarDays },
    { label: "Atmospheric NO₂ Response", detail: selected.atmosphere, status: "Inconclusive", strength: 65, icon: Zap },
    { label: "Wind Compatibility", detail: selected.wind, status: industrial ? "Supporting" : "Inconclusive", strength: industrial ? 76 : 48, icon: Wind },
    { label: "Spatial Structure", detail: "Industrial and road context may both contribute", status: "Inconclusive", strength: 58, icon: MapPin },
    { label: "Construction Evidence", detail: "Illustrative Sentinel-2 context; primary documents required", status: "Inconclusive", strength: 62, icon: Layers },
    { label: "Counterfactual Deviation", detail: "Descriptive comparison only", status: "Inconclusive", strength: 55, icon: Scale },
    { label: "Independent Records", detail: selected.record, status: "Missing", strength: 25, icon: FileText },
    { label: "Observation Quality", detail: selected.adequacy, status: selected.adequacy === "Good" ? "Supporting" : "Inconclusive", strength: selected.adequacy === "Good" ? 85 : 50, icon: Camera },
  ];
  const supporting = rows.filter(row => row.status === "Supporting").length;
  const scores = industrial ? [84, 63, 48, 37] : selected.shortType === "Lighting" ? [34, 84, 50, 39] : [60, 58, 52, 44];
  const mechanisms = ["Industrial Expansion", "Lighting Modernization", "Mixed Transition", "Infrastructure Growth"];
  return <div className="cctf-screen">
    <div className="cctf-picker"><span>Selected event</span><EventPicker /></div>
    <div className="cctf-metrics">
      <div className="cctf-metric blue"><span><Fingerprint /></span><div><small>CCTF Fingerprint</small><strong>{supporting} / {rows.length}</strong><em>Supporting indicators</em></div></div>
      <div className="cctf-metric green"><span><Network /></span><div><small>Working Mechanism</small><strong>{selected.mechanism}</strong><em>Analyst-selected explanation</em></div></div>
      <div className="cctf-metric amber"><span><CalendarDays /></span><div><small>Assessment Period</small><strong>2023–2024</strong><em>Demonstration event window</em></div></div>
      <div className="cctf-metric violet"><span><ShieldCheck /></span><div><small>Confidence Level</small><strong>Unverified</strong><em>Field validation required</em></div></div>
    </div>
    <div className="cctf-main">
      <div className="cctf-column">
        <section className="cctf-panel"><header><span className="cctf-panel-icon"><Fingerprint /></span><div><h2>CCTF Evidence Fingerprint</h2><p>Signal consistency for transition indicators</p></div></header><div className="cctf-rows">{rows.slice(0, 3).map(row => { const Glyph = row.icon; return <button type="button" className="cctf-row" key={row.label} aria-expanded={expanded === row.label} onClick={() => setExpanded(expanded === row.label ? null : row.label)}><span className="cctf-row-icon"><Glyph /></span><span className="cctf-row-name">{row.label}</span><span className="cctf-row-track"><i style={{ width: `${row.strength}%` }} /></span><span className={`cctf-row-badge ${row.status.toLowerCase()}`}>{row.status}</span>{expanded === row.label && <span className="cctf-row-detail">{row.detail}</span>}</button>; })}</div></section>
        <section className="cctf-panel"><header><span className="cctf-panel-icon"><ClipboardCheck /></span><div><h2>Additional Evidence Checks</h2><p>Multi-source consistency and context validation</p></div></header><div className="cctf-rows">{rows.slice(3).map(row => { const Glyph = row.icon; return <button type="button" className="cctf-row" key={row.label} aria-expanded={expanded === row.label} onClick={() => setExpanded(expanded === row.label ? null : row.label)}><span className="cctf-row-icon"><Glyph /></span><span className="cctf-row-name">{row.label}</span><span className="cctf-row-track"><i style={{ width: `${row.strength}%` }} /></span><span className={`cctf-row-badge ${row.status.toLowerCase()}`}>{row.status}</span>{expanded === row.label && <span className="cctf-row-detail">{row.detail}</span>}</button>; })}</div></section>
      </div>
      <div className="cctf-column">
        <section className="cctf-panel"><header><span className="cctf-panel-icon"><Layers /></span><div><h2>Competing Mechanisms</h2><p>Choose the working explanation and its confirmation level</p></div></header><div className="cctf-mechanism-body"><Select label="Working explanation" value={selected.mechanism} options={mechanismOptions} onChange={mechanism => { update(selected.id, { mechanism }); notify("Working explanation saved. This is not a confirmed cause."); }} /><div className="cctf-context"><Info size={18} /><span>{selected.summary} {selected.uncertainty}</span></div><Button secondary label="Flag missing evidence" onClick={() => { update(selected.id, { status: "Additional Evidence Required" }); notify("Event flagged for additional evidence."); }} /></div></section>
        <section className="cctf-panel"><header><span className="cctf-panel-icon"><Activity /></span><div><h2>Flag-Match Evidence</h2><p>Illustrative mechanism comparison, not a model output</p></div></header><div className="cctf-bars">{mechanisms.map((name, index) => <div className="cctf-bar" key={name}><span>{name}</span><div><i style={{ width: `${scores[index]}%` }} /></div><b>{(scores[index] / 100).toFixed(2)}</b></div>)}<small>Illustrative display scores (0–1); no validated model probabilities are available.</small></div></section>
        <section className="cctf-panel cctf-result"><span><Check /></span><div><h2>Assessment Result: {selected.mechanism}</h2><p>This is the selected working explanation. {supporting} of {rows.length} evidence checks are supporting; independent records and field verification remain necessary before attribution.</p></div></section>
      </div>
    </div>
  </div>;
}
