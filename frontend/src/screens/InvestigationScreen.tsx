import { useEffect, useState } from "react";
import { Activity, CalendarDays, Check, ClipboardCheck, Database, Factory, FileText, Layers, Lightbulb, TrendingUp, TriangleAlert } from "lucide-react";
import { css } from "../styles";
import { Button, Field, Select } from "../components/ui";
import { TrendChart } from "../components/Charts";
import { useWorkspace } from "../context/WorkspaceContext";
import { statuses } from "../utils/events";
import type { EventStatus } from "../types";

export function EventPicker() {
  const { events, selected, select } = useWorkspace();
  return <Select label="Selected event" value={`${selected.id} · ${selected.location}`} options={events.map(event => `${event.id} · ${event.location}`)} onChange={value => select(value.split(" · ")[0])} />;
}

export function InvestigationScreen() {
  const { selected, update, notify, go } = useWorkspace();
  const [notes, setNotes] = useState(selected.notes || "");
  useEffect(() => setNotes(selected.notes || ""), [selected.id, selected.notes]);
  const evidence = [
    { title: "Observed Evidence", content: `${selected.radiance}. ${selected.atmosphere}.`, icon: Check, tone: "green" },
    { title: "Possible Explanation", content: selected.mechanism, icon: Lightbulb, tone: "amber" },
    { title: "Missing Evidence", content: selected.uncertainty, icon: TriangleAlert, tone: "rose" },
    { title: "Recommended Verification", content: selected.verification, icon: ClipboardCheck, tone: "cyan" },
  ];
  return <div className="investigation-screen">
    <div className="investigation-picker"><EventPicker /></div>
    <div className="investigation-summary">
      <div className="investigation-stat cyan"><span className="investigation-stat-icon"><Layers /></span><div><small>Event ID</small><strong>{selected.id}</strong><span>{selected.location}</span></div></div>
      <div className="investigation-stat green"><span className="investigation-stat-icon"><Factory /></span><div><small>Event Type</small><strong>{selected.shortType} Candidate</strong><span>{selected.mechanism}</span></div></div>
      <div className="investigation-stat amber"><span className="investigation-stat-icon"><TrendingUp /></span><div><small>Radiance Change</small><strong>{selected.radiance}</strong><span>Illustrative transition signal</span></div></div>
      <div className="investigation-stat rose"><span className="investigation-stat-icon"><CalendarDays /></span><div><label htmlFor="investigation-status">Review Status</label><select id="investigation-status" value={selected.status} onChange={event => update(selected.id, { status: event.target.value as EventStatus })}>{statuses.map(status => <option key={status}>{status}</option>)}</select><span>{selected.verification}</span></div></div>
    </div>
    <div className="investigation-main-grid">
      <section className="investigation-card investigation-chart-card">
        <header><span className="investigation-card-icon"><Activity /></span><div><h2>Before and After Radiance Context</h2><p>Illustrative monthly composite comparison</p></div><Button secondary label="Explore Timeline" onClick={() => go("timeline")} /></header>
        <div className="investigation-card-body"><TrendChart variant={Number(selected.id.slice(-1)) - 1} /></div>
      </section>
      <section className="investigation-card investigation-evidence-card">
        <header><span className="investigation-card-icon"><Layers /></span><div><h2>What Do We Know?</h2><p>Observations are separated from interpretation</p></div></header>
        <div className="investigation-evidence-list">{evidence.map(item => { const Glyph = item.icon; return <div className="investigation-evidence-row" key={item.title}><span className={`investigation-evidence-icon ${item.tone}`}><Glyph /></span><div><h3>{item.title}</h3><p>{item.content}</p></div></div>; })}</div>
      </section>
    </div>
    <div className="investigation-bottom-grid">
      <section className="investigation-card investigation-notes-card">
        <header><span className="investigation-card-icon"><FileText /></span><div><h2>Analyst Notebook</h2><p>Saved through the workspace API</p></div><div className="investigation-header-actions"><Button label="Save notes" icon="save-outline" onClick={() => { update(selected.id, { notes }); notify("Saving analyst notes…"); }} /><Button secondary label="Request field verification" onClick={() => { update(selected.id, { status: "Additional Evidence Required" }); notify("Event flagged for field verification in this demo."); }} /></div></header>
        <div className="investigation-card-body"><Field label="Investigation notes" placeholder="Document evidence interpretation, unresolved questions, and follow-up…" multiline value={notes} onChange={setNotes} style={css({ minHeight: 100 })} /></div>
      </section>
      <section className="investigation-card investigation-record-card">
        <header><span className="investigation-card-icon"><Database /></span><div><h2>Linked Historical Record</h2><p>Independent records and event context</p></div></header>
        <div className="investigation-record"><span className="investigation-record-icon"><FileText /></span><div><strong>{selected.record}</strong><span>Demonstration record. Independent source document not supplied.</span></div><Button secondary label="Open Registry" onClick={() => go("records")} /></div>
      </section>
    </div>
    <p className="investigation-disclaimer">Nighttime brightness is not electricity consumption. Satellite NO₂ is not ground-level concentration. Correlation and wind compatibility do not establish causation.</p>
  </div>;
}
