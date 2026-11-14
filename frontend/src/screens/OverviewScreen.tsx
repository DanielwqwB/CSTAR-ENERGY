import type { ReactNode, CSSProperties } from "react";
import { Map, MapPin, CalendarDays, Layers, TriangleAlert, Wind, Database, Satellite, Factory, Building2, FileCheck2, ChevronRight, ArrowUpRight, ArrowRight, ChartPie } from "lucide-react";
import { IntelligenceGlobe } from "../components/IntelligenceGlobe";
import { Distribution } from "../components/Charts";
import { Status } from "../components/ui";
import { AIAnalyticsChecklist } from "../components/AIAnalyticsChecklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { useResearchData } from "../context/ResearchDataContext";
import { filterEvents } from "../utils/events";
import type { Page } from "../types";
export const regions = ["Aurelia Pilot Locality", "North District Subset", "Eastport Study Area"];

function Panel({ title, subtitle, icon, action, children, className = "" }: { title: string; subtitle?: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overview-panel ${className}`}><header><span className="overview-panel-icon">{icon}</span><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header><div className="overview-panel-body">{children}</div></section>;
}
export function OverviewScreen() {
  const { events, region, setRegion, go, select } = useWorkspace();
  const { datasets: datasetResource } = useResearchData();
  const datasets = datasetResource.data;
  const filtered = filterEvents(events, "", undefined, undefined, region);
  const ready = datasets?.filter(item => item[3] === "Ready").length ?? 0;
  const readiness = datasets?.length ? Math.round(ready / datasets.length * 100) : 0;
  const investigate = (id: string) => { select(id); go("investigation"); };
  const metrics = [
    { label: "Monitored Locations", value: new Set(filtered.map(e => e.location)).size, note: "Synthetic study locations", icon: <Layers />, tone: "blue", page: "map" },
    { label: "Lighting Transitions", value: filtered.filter(e => e.shortType === "Lighting").length, note: "Needs further validation", icon: <TriangleAlert />, tone: "green", page: "events" },
    { label: "Industrial Change", value: filtered.filter(e => e.shortType === "Industrial").length, note: "Suspected combustion", icon: <Wind />, tone: "amber", page: "events" },
    { label: "Events Under Review", value: filtered.filter(e => e.status !== "Reviewed").length, note: "Awaiting verification", icon: <CalendarDays />, tone: "rose", page: "records" },
  ];
  const datasetIcons = [Satellite, Factory, Wind, Building2, FileCheck2];
  return <div className="intelligence-overview">
    <section className="overview-hero">
      <span className="overview-hero-icon"><Map size={34} /></span>
      <div className="overview-heading"><span className="page-eyebrow">MONITOR</span><h1>Regional Intelligence Overview</h1><p>Cross-coupled satellite intelligence for municipal lighting and industrial energy transitions.</p></div>
      <div className="overview-filters"><label><MapPin size={20} /><select aria-label="Study region" value={region} onChange={event => setRegion(event.target.value)}>{regions.map(item => <option key={item}>{item}</option>)}</select></label><span className="overview-date"><CalendarDays size={20} />VNP46A3 · 2016–2026</span></div>
      <Satellite className="hero-satellite" size={100} aria-hidden="true" />
    </section>
    <div className="overview-metrics">{metrics.map(metric => <button key={metric.label} className={`overview-metric ${metric.tone}`} onClick={() => go(metric.page as Page)}><span className="metric-symbol">{metric.icon}</span><span className="metric-copy"><strong>{metric.label}</strong><b>{metric.value}</b><small>{metric.note}</small></span></button>)}</div>
    <IntelligenceGlobe onOpenMap={() => go("map")} />
    <div className="overview-columns">
      <div className="overview-primary">
        <Panel title="Data Readiness" subtitle="Status of sample datasets for analysis and modeling." icon={<Database />} action={<button className="overview-action" onClick={() => go("data")}>View Details <ArrowRight size={16} /></button>}>
          {datasetResource.loading ? <p role="status">Loading sample dataset catalog…</p> : datasetResource.error ? <p role="alert">Dataset catalog unavailable: {datasetResource.error}</p> : datasets && <div className="readiness-content"><div className="readiness-ring" style={{ "--readiness": `${readiness}%` } as CSSProperties}><div><strong>{readiness}%</strong><span>Ready</span></div></div><div className="readiness-sources">{datasets.map(([name, product, , status], index) => { const Glyph = datasetIcons[index % datasetIcons.length]; return <button key={name} onClick={() => go("data")} title={name}><span><Glyph size={23} />{product}</span><Status value={status} /></button>; })}</div></div>}
        </Panel>
        <Panel title="Latest Candidate Events" subtitle="Recent candidate transitions under review." icon={<CalendarDays />} action={<button className="overview-action" onClick={() => go("events")}>View All <ArrowRight size={16} /></button>}>
          <div className="overview-table-scroll" role="region" aria-label="Latest candidate events table" tabIndex={0}><table className="overview-table"><thead><tr>{["Event ID", "Location / Area", "Candidate Mechanism", "Onset Window", "Evidence", "Review Status"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.slice(0, 3).map(event => <tr key={event.id}><td><button onClick={() => investigate(event.id)}>{event.id}</button></td><td>{event.location}</td><td>{event.mechanism}</td><td>{event.onset}</td><td><Status value={event.adequacy} /></td><td><Status value={event.status} /></td></tr>)}</tbody></table>{!filtered.length && <p>No candidates in this study region.</p>}</div>
        </Panel>
      </div>
      <div className="overview-secondary">
        <AIAnalyticsChecklist />
        <Panel title="Candidate Mechanisms" subtitle="Potential explanations from integrated evidence." icon={<ChartPie />} className="mechanisms-panel"><Distribution events={filtered} /></Panel>
        <Panel title="Research Status" icon={<Layers />}><div className="research-status-list">{([
          ["Current pipeline", "Active", "data"], ["CCTF model", "Not calibrated", "attribution"], ["Independent validation", "Not evaluated", "analytics"], ["Coverage summary", `${filtered.filter(e => e.adequacy !== "Insufficient").length} of ${filtered.length}`, "data"],
        ] as [string, string, Page][]).map(([label, value, page]) => <button key={label} onClick={() => go(page)}><ChevronRight size={17} /><span>{label}</span><Status value={value} /></button>)}</div></Panel>
      </div>
    </div>
    <p className="overview-note">Demonstration workspace &middot; Fictional event locations on the Bicol basemap &middot; {datasets ? `${ready} of ${datasets.length} sample datasets ready.` : "Sample dataset status unavailable."} No live satellite feeds or validated attribution scores.</p>
  </div>;
}
