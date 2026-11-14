import { useState } from "react";
import { Select } from "../components/ui";
export { SourcePlumeScreen as PlumeScreen } from "./SourcePlumeScreen";
export { CounterfactualScreen } from "./CounterfactualScreen";
export { AttributionScreen } from "./AttributionScreen";
import { EventPicker } from "./InvestigationScreen";
import { useWorkspace } from "../context/WorkspaceContext";
import { Activity, CalendarCheck, Database, Factory, Layers, TrendingUp, Waves } from "lucide-react";
import { TimelineChart } from "../components/TimelineChart";
import series from "../data/series.json";
export function TimelineScreen() {
  const { selected } = useWorkspace();
  const [period, setPeriod] = useState("Monthly · Jan–Dec 2024");
  const [activeMonth, setActiveMonth] = useState(6);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const radianceChange = Math.round((series.at(-1)!.radiance / series[0].radiance - 1) * 100);
  const no2Change = Math.round((series.at(-1)!.no2 / series[0].no2 - 1) * 100);
  const milestones = [
    { index: 0, title: "Baseline Period", description: "Reference radiance and NO₂ levels.", icon: Database, tone: "blue" },
    { index: 6, title: "Transition Window", description: "Illustrative onset of sustained change.", icon: Factory, tone: "amber" },
    { index: 9, title: "Peak Enhancement", description: "Elevated radiance and NO₂ in the sample series.", icon: TrendingUp, tone: "blue" },
    { index: 11, title: "Review & Verification", description: "Interpretation and field validation remain open.", icon: CalendarCheck, tone: "green" },
  ];
  return (
    <div className="evidence-timeline-screen">
      <div className="timeline-controls"><div><span>Selected event</span><EventPicker /></div><div><span>Observation period</span><Select value={period} options={["Monthly · Jan–Dec 2024", "Quarterly view"]} onChange={setPeriod} /></div></div>
      <div className="timeline-metrics">
        <div className="timeline-metric blue"><span className="timeline-metric-icon"><TrendingUp /></span><div><small>Mean Radiance Change</small><strong>+{radianceChange}%</strong><span>Jan–Dec synthetic sample</span></div></div>
        <div className="timeline-metric green"><span className="timeline-metric-icon"><Waves /></span><div><small>Atmospheric NO₂ Change</small><strong>+{no2Change}%</strong><span>Jan–Dec synthetic sample</span></div></div>
        <div className="timeline-metric amber"><span className="timeline-metric-icon"><Layers /></span><div><small>Transition Period</small><strong>Jul 2024</strong><span>Illustrative transition window</span></div></div>
        <div className="timeline-metric rose"><span className="timeline-metric-icon"><CalendarCheck /></span><div><small>Evidence Status</small><strong>{selected.status}</strong><span>{selected.verification}</span></div></div>
      </div>
      <div className="timeline-chart-grid">
        <section className="timeline-panel"><header><span className="timeline-panel-icon"><TrendingUp /></span><div><h2>A · Historical Nighttime Radiance</h2><p>Illustrative radiance units; brightness is not electricity consumption</p></div></header><TimelineChart mode="radiance" quarterly={period === "Quarterly view"} /></section>
        <section className="timeline-panel"><header><span className="timeline-panel-icon"><Waves /></span><div><h2>B · Atmospheric NO₂</h2><p>Illustrative tropospheric column signal; not a measured event series</p></div></header><TimelineChart mode="no2" quarterly={period === "Quarterly view"} /></section>
      </div>
      <section className="timeline-panel timeline-events"><header><span className="timeline-panel-icon"><Layers /></span><div><h2>C · Evidence Timeline</h2><p>Integrated view of key evidence, records, and contextual events</p></div><button type="button" className="timeline-details-button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? "Hide Details" : "View Details"} →</button></header>
        <div className="timeline-track" aria-label="2024 evidence months"><div className="timeline-milestones">{milestones.map(milestone => { const Glyph = milestone.icon; return <button type="button" className={`timeline-milestone ${milestone.tone}`} key={milestone.title} onClick={() => { setActiveMonth(milestone.index); setDetailsOpen(true); }}><Glyph size={22} /><span><strong>{milestone.title}</strong><small>{milestone.description}</small></span></button>; })}</div><div className="timeline-months">{series.map((item, index) => <button type="button" key={item.month} className={index === activeMonth ? "active" : ""} aria-pressed={index === activeMonth} onClick={() => { setActiveMonth(index); setDetailsOpen(true); }}><i /><span>{item.month} 2024</span></button>)}</div></div>
        {detailsOpen && <div className="timeline-selected-detail" role="status"><Activity size={20} /><div><strong>{series[activeMonth].month} 2024 · Illustrative observation</strong><span>Radiance {series[activeMonth].radiance} units · NO₂ {series[activeMonth].no2} units. {activeMonth === 6 ? `Candidate onset: ${selected.onset}. ` : ""}{selected.record}</span></div></div>}
      </section>
    </div>
  );
}
