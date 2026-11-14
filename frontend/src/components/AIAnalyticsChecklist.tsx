import { useState } from "react";

const sections = [
  { title: "Dataset Inputs", items: [
    { id: "black-marble", label: "VIIRS / Black Marble (Nighttime Light)", checked: true },
    { id: "tropomi", label: "Sentinel-5P (NO₂)", checked: false },
    { id: "merra", label: "MERRA-2 (Meteorology)", checked: true },
    { id: "sentinel", label: "Sentinel-2 (Land Use / Land Cover)", checked: true },
  ] },
  { title: "Model Analysis", items: [
    { id: "stgnn", label: "ST-GNN · Spatiotemporal change detection", checked: false },
    { id: "xgboost", label: "XGBoost · Transition classification", checked: false },
    { id: "forest", label: "Random Forest · Feature validation", checked: false },
  ] },
  { title: "CCTF Assessment", items: [
    { id: "cctf", label: "Cross-Coupled Transition Fingerprinting review", checked: false },
  ] },
];

const initial = Object.fromEntries(sections.flatMap(section => section.items.map(item => [item.id, item.checked])));

export function AIAnalyticsChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>(initial);
  const completed = Object.values(checked).filter(Boolean).length;
  const total = Object.keys(checked).length;
  return <section className="ai-checklist" aria-label="AI Analytics checklist">
    <header><div><h2>AI Analytics</h2><p>Review data and analysis steps</p></div><span className="ai-checklist-total" role="status">{completed} / {total} checked</span></header>
    <div className="ai-checklist-body">{sections.map((section, index) => {
      const count = section.items.filter(item => checked[item.id]).length;
      return <div className="ai-checklist-section" key={section.title}>
        <div className="ai-checklist-section-heading"><span className="ai-checklist-number">{index + 1}</span><h3>{section.title}</h3><span className="ai-checklist-count">{count} / {section.items.length} checked</span></div>
        <div className="ai-checklist-items">{section.items.map(item => <label key={item.id}><input type="checkbox" checked={checked[item.id]} onChange={event => setChecked(current => ({ ...current, [item.id]: event.target.checked }))} /><span>{item.label}</span></label>)}</div>
      </div>;
    })}</div>
    <p className="ai-checklist-note">Analyst checklist for this demonstration. Checks do not run models or change dataset readiness.</p>
  </section>;
}
