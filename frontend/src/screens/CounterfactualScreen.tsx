import { useState } from "react";
import { Check, Info, Layers, Scale, SlidersHorizontal, Target, TrendingUp } from "lucide-react";
import { Select } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { EventPicker } from "./InvestigationScreen";
import series from "../data/series.json";

const cohorts = ["Matched industrial zones A + C", "Road-adjacent controls B + D", "Regional synthetic control"];

function ComparisonChart() {
  const x = (index: number) => 50 + index * 620 / (series.length - 1);
  const y = (value: number) => 202 - value * 1.65;
  const observed = series.map((point, index) => `${x(index)},${y(point.radiance)}`).join(" ");
  const comparison = series.map((point, index) => `${x(index)},${y(point.counter)}`).join(" ");
  return <div className="counterfactual-chart" aria-label="Illustrative observed and matched comparison trajectories; synthetic data, not a causal estimate">
    <svg viewBox="0 0 720 252" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="counterfactual-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0787e8" stopOpacity=".25" /><stop offset="1" stopColor="#0787e8" stopOpacity=".02" /></linearGradient></defs>
      {[0, 20, 40, 60, 80, 100].map(value => <g key={value}><line x1="50" x2="670" y1={y(value)} y2={y(value)} stroke="#d9e7f8" strokeDasharray="4 4" /><text x="39" y={y(value) + 4} textAnchor="end" fontSize="11" fill="#425b80">{value}</text></g>)}
      <line x1={x(6)} x2={x(6)} y1="20" y2="202" stroke="#eca400" strokeDasharray="6 5" />
      <rect x="407" y="4" width="248" height="24" rx="12" fill="#fff0d4" /><text x="531" y="20" textAnchor="middle" fontSize="10" fill="#946000" fontWeight="700">ILLUSTRATIVE TRANSITION WINDOW</text>
      <polygon points={`50,202 ${observed} 670,202`} fill="url(#counterfactual-area)" />
      <polyline points={comparison} fill="none" stroke="#5d75a7" strokeWidth="2.5" strokeDasharray="8 6" />
      <polyline points={observed} fill="none" stroke="#0787e8" strokeWidth="3" />
      {series.map((point, index) => <g key={point.month}><circle cx={x(index)} cy={y(point.radiance)} r="3.5" fill="#0787e8" /><circle cx={x(index)} cy={y(point.counter)} r="3" fill="#fff" stroke="#5d75a7" strokeWidth="2" /><text x={x(index)} y="231" textAnchor="middle" fontSize="10" fill="#101f50">{point.month}</text></g>)}
    </svg>
    <div className="counterfactual-legend"><span><i className="observed" />Observed synthetic signal</span><span><i className="matched" />Matched descriptive comparison</span><span><i className="period" />Jan–Dec 2024</span></div>
  </div>;
}

export function CounterfactualScreen() {
  const { selected } = useWorkspace();
  const [cohort, setCohort] = useState(cohorts[0]);
  return <div className="counterfactual-screen">
    <div className="counterfactual-picker"><span>Selected event</span><EventPicker /></div>
    <div className="counterfactual-metrics">
      <div className="counterfactual-metric blue"><span><TrendingUp /></span><div><small>Comparison Area</small><strong>{cohort === cohorts[0] ? "A + C" : cohort === cohorts[1] ? "B + D" : "Regional"}</strong><em>Descriptive control cohort</em></div></div>
      <div className="counterfactual-metric green"><span><Scale /></span><div><small>Match Quality</small><strong>Unvalidated</strong><em>No cohort-specific score</em></div></div>
      <div className="counterfactual-metric amber"><span><Layers /></span><div><small>Analysis Period</small><strong>Jan–Dec 2024</strong><em>12 synthetic months</em></div></div>
      <div className="counterfactual-metric violet"><span><Check /></span><div><small>Assessment Status</small><strong>Illustrative</strong><em>Descriptive comparison only</em></div></div>
    </div>
    <div className="counterfactual-main">
      <section className="counterfactual-panel counterfactual-configuration"><header><span className="counterfactual-panel-icon"><SlidersHorizontal /></span><div><h2>Comparison Configuration</h2><p>Define the descriptive comparison cohort</p></div></header><div className="counterfactual-configuration-body"><Select label="Comparison context" value={cohort} options={cohorts} onChange={setCohort} /><div className="counterfactual-context"><Info size={21} /><span>Selected cohort: <strong>{cohort}</strong>. This prototype uses one shared illustrative comparison trajectory. Cohort-specific model estimates and validated matching diagnostics are unavailable.</span></div></div></section>
      <section className="counterfactual-panel"><header><span className="counterfactual-panel-icon"><TrendingUp /></span><div><h2>Observed vs. Matched Comparison</h2><p>Illustrative trajectories; no causal estimate</p></div></header><ComparisonChart /></section>
    </div>
    <section className="counterfactual-panel counterfactual-result"><div className="counterfactual-result-heading"><span className="counterfactual-panel-icon"><Target /></span><div><h2>Assessment Result</h2><p>Counterfactual insight and interpretation</p></div></div><div className="counterfactual-result-message"><span><Info /></span><div><strong>Descriptive deviation in the synthetic series</strong><p>The observed trajectory rises above the shared comparison after July. Matching assumptions have not been validated, so this chart cannot establish a treatment-specific effect or causal attribution for {selected.location}.</p></div></div></section>
  </div>;
}
