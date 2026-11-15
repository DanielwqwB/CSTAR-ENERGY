import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, BarChart3, CalendarRange, CircleAlert, Cpu, FileCheck2, Globe2,
  Database, Layers3, LogOut, Map as MapIcon, Menu, Radio, ShieldCheck, X,
} from "lucide-react";
import logo from "../../assets/cstar-logo.png";
import { loadBlackMarbleManifest, type BlackMarbleMonthlyManifest } from "../data/blackMarble";
import { useWorkspace } from "../context/WorkspaceContext";
import { BlackMarbleTransition } from "./BlackMarbleTransition";
import { IntelligenceGlobe } from "./IntelligenceGlobe";

type WorkspacePage = "overview" | "regional-map" | "coverage" | "evaluation" | "provenance";

const navigation: { id: WorkspacePage; label: string; shortLabel: string; icon: typeof Globe2 }[] = [
  { id: "overview", label: "Intelligence overview", shortLabel: "Overview", icon: Globe2 },
  { id: "regional-map", label: "Regional transition map", shortLabel: "Transition map", icon: MapIcon },
  { id: "coverage", label: "Observation coverage", shortLabel: "Coverage", icon: Database },
  { id: "evaluation", label: "Model evaluation", shortLabel: "Evaluation", icon: BarChart3 },
  { id: "provenance", label: "Data provenance", shortLabel: "Provenance", icon: FileCheck2 },
];

function useManifest() {
  const [manifest, setManifest] = useState<BlackMarbleMonthlyManifest>();
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    loadBlackMarbleManifest()
      .then((value) => { if (active) setManifest(value); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The Black Marble manifest could not be loaded.");
      });
    return () => { active = false; };
  }, [retryKey]);
  return { manifest, error, retry: () => setRetryKey((value) => value + 1) };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

function Panel({ eyebrow, title, aside, children, className = "" }: {
  eyebrow?: string; title: string; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`data-panel ${className}`.trim()}>
    <header className="data-panel-header"><div>{eyebrow && <span className="hud-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{aside}</header>
    <div className="data-panel-body">{children}</div>
  </section>;
}

function LoadingState({ error, retry }: { error: string; retry: () => void }) {
  return error ? <main className="workspace-stage workspace-state">
    <CircleAlert size={28} /><h1>Dataset manifest unavailable</h1><p>{error}</p><button type="button" onClick={retry}>Retry manifest</button>
  </main> : <main className="workspace-stage workspace-state" aria-live="polite">
    <Radio className="hud-pulse" size={28} /><h1>Loading verified dataset metadata</h1><p>Reading the generated Black Marble spatial manifest.</p>
  </main>;
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  return <div className="metric-bar-row"><span>{label}</span><div aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} /></div><strong>{value === null ? "N/A" : percent(value)}</strong></div>;
}

function Overview({ go }: { go: (page: WorkspacePage) => void }) {
  return <IntelligenceGlobe onOpenMap={() => go("regional-map")} />;
}

function RegionalMap() {
  return <BlackMarbleTransition compact />;
}

function Coverage({ manifest }: { manifest: BlackMarbleMonthlyManifest }) {
  const byYear = useMemo(() => {
    const groups = new Map<string, Set<number>>();
    for (const month of manifest.months) { const [year, monthNumber] = month.split("-"); const values = groups.get(year) ?? new Set<number>(); values.add(Number(monthNumber)); groups.set(year, values); }
    return [...groups.entries()];
  }, [manifest.months]);
  return <div className="coverage-layout">
      <Panel eyebrow="MONTH INDEX" title="Observed VNP46A3 coverage" className="coverage-matrix-panel">
        <div className="coverage-matrix" role="table" aria-label="Observed month coverage by year">
          <div className="coverage-row coverage-heading" role="row"><strong role="columnheader">YEAR</strong>{Array.from({ length: 12 }, (_, index) => <span role="columnheader" key={index}>{String(index + 1).padStart(2, "0")}</span>)}</div>
          {byYear.map(([year, months]) => <div className="coverage-row" role="row" key={year}><strong role="rowheader">{year}</strong>{Array.from({ length: 12 }, (_, index) => { const available = months.has(index + 1); return <i key={index} role="cell" data-available={available} title={`${year}-${String(index + 1).padStart(2, "0")}: ${available ? "observed" : "not available"}`} />; })}</div>)}
        </div><div className="coverage-legend"><i data-available="true" /> Observed <i /> Not available</div>
      </Panel>
      <div className="overview-side-stack">
        <Panel eyebrow="COVERAGE SUMMARY" title="Processed archive"><dl className="hud-definition-list">
          <div><dt>Observed months</dt><dd>{manifest.months.length}</dd></div><div><dt>Forecast assets</dt><dd>{manifest.forecastMonths.length}</dd></div>
          <div><dt>Grid cells</dt><dd>{number(manifest.cellCount)}</dd></div><div><dt>First observed</dt><dd>{manifest.months[0]}</dd></div><div><dt>Latest observed</dt><dd>{manifest.latestObservedMonth}</dd></div>
        </dl></Panel>
        <Panel eyebrow="FORECAST INDEX" title="Available forecast months"><div className="month-chip-list">{manifest.forecastMonths.map((month) => <span key={month}>{month}</span>)}</div><p className="panel-caveat">Forecast assets are model outputs, never observations.</p></Panel>
      </div>
    </div>;
}

function Evaluation({ manifest }: { manifest: BlackMarbleMonthlyManifest }) {
  const directionMetrics = [["Accuracy", manifest.metrics.direction.accuracy], ["Balanced accuracy", manifest.metrics.direction.balanced_accuracy], ["Precision", manifest.metrics.direction.precision], ["Recall", manifest.metrics.direction.recall], ["F1 score", manifest.metrics.direction.f1], ["ROC AUC", manifest.metrics.direction.roc_auc]] as const;
  return <div className="evaluation-grid">
      <Panel eyebrow="DIRECTION CLASSIFICATION" title="Held-out screening metrics"><div className="evaluation-bars">{directionMetrics.map(([label, value]) => <MetricBar key={label} label={label} value={value} />)}</div></Panel>
      <Panel eyebrow="RADIANCE REGRESSION" title="Held-out error"><div className="large-metric-pair"><div><span>MAE</span><strong>{manifest.metrics.regression.mae.toFixed(4)}</strong><small>{manifest.units}</small></div><div><span>RMSE</span><strong>{manifest.metrics.regression.rmse.toFixed(4)}</strong><small>{manifest.units}</small></div></div></Panel>
      <Panel eyebrow="HOLDOUT" title="Evaluation frame"><dl className="hud-definition-list"><div><dt>Model</dt><dd>{manifest.model}</dd></div><div><dt>Target</dt><dd>{manifest.metrics.target}</dd></div><div><dt>Period</dt><dd>{manifest.metrics.test_period.start} to {manifest.metrics.test_period.end}</dd></div><div><dt>Month pairs</dt><dd>{manifest.metrics.test_pairs}</dd></div><div><dt>Cell-months</dt><dd>{number(manifest.metrics.test_samples)}</dd></div></dl></Panel>
      <Panel eyebrow="INTERPRETATION" title="Required limitations"><div className="limitation-block"><ShieldCheck size={18} /><p>{manifest.disclaimer}</p></div><div className="limitation-block warning"><CircleAlert size={18} /><p>Brightness is not electricity consumption, and predicted direction does not establish a causal energy transition.</p></div></Panel>
    </div>;
}

function Provenance({ manifest }: { manifest: BlackMarbleMonthlyManifest }) {
  const fields: [string, string][] = [["Region", manifest.region], ["Bounding box", manifest.bounds.join(", ")], ["Product", manifest.product], ["Science layer", manifest.layer], ["Quality rule", manifest.quality], ["Units", manifest.units], ["Grid format", manifest.gridValueFormat], ["Observation format", manifest.observedValueFormat], ["Forecast format", manifest.forecastValueFormat]];
  return <div className="provenance-layout">
      <Panel eyebrow="GENERATED MANIFEST" title="Black Marble spatial asset"><dl className="provenance-list">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Panel>
      <div className="overview-side-stack">
        <Panel eyebrow="MODEL FEATURES" title="Inputs used by the trained estimator"><ol className="feature-list">{manifest.metrics.feature_names.map((feature, index) => <li key={feature}><span>{String(index + 1).padStart(2, "0")}</span>{feature.replaceAll("_", " ")}</li>)}</ol></Panel>
        <Panel eyebrow="ASSET INTEGRITY" title="Manifest contract"><div className="integrity-row"><Cpu size={18} /><span>Format version</span><strong>{manifest.formatVersion}</strong></div><div className="integrity-row"><Layers3 size={18} /><span>Fixed grid cells</span><strong>{number(manifest.cellCount)}</strong></div><div className="integrity-row"><CalendarRange size={18} /><span>Latest observed</span><strong>{manifest.latestObservedMonth}</strong></div></Panel>
      </div>
    </div>;
}

export function DataWorkspace() {
  const [page, setPage] = useState<WorkspacePage>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { logout, toast } = useWorkspace();
  const { manifest, error, retry } = useManifest();
  const active = navigation.find((item) => item.id === page) ?? navigation[0];
  const ActiveIcon = active.icon;
  const go = (next: WorkspacePage) => { setPage(next); setMobileNavOpen(false); };
  return <div className="data-workspace">
    <header className="hud-topbar">
      <button type="button" className="hud-brand" onClick={() => go("overview")} aria-label="CSTAR-Energy overview"><img src={logo} alt="" width={42} height={42} /><span><strong>CSTAR</strong>-ENERGY<small>EARTH SYSTEM ATTRIBUTION LAB</small></span></button>
      <nav className="hud-navigation" aria-label="Dataset workspace navigation">{navigation.map((item) => { const Glyph = item.icon; return <button key={item.id} type="button" aria-current={page === item.id ? "page" : undefined} onClick={() => go(item.id)}><Glyph size={15} /><span>{item.shortLabel}</span></button>; })}</nav>
      <button className="hud-menu-button" type="button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}>{mobileNavOpen ? <X /> : <Menu />}</button>
      <button className="hud-signout-button" type="button" onClick={() => void logout()}><LogOut size={15} /><span>Sign out</span></button>
    </header>
    {mobileNavOpen && <nav className="hud-mobile-navigation" aria-label="Mobile dataset workspace navigation">{navigation.map((item) => { const Glyph = item.icon; return <button key={item.id} type="button" aria-current={page === item.id ? "page" : undefined} onClick={() => go(item.id)}><Glyph size={16} />{item.label}</button>; })}</nav>}
    {toast && <div className="hud-toast" role="status">{toast}</div>}
    {page !== "overview" && <div className="hud-contextbar"><span className="hud-context-page"><ActiveIcon size={14} /> {active.label}</span>{manifest && <><span><Globe2 size={13} /> {manifest.region}</span><span><Activity size={13} /> {manifest.product}</span><span><CalendarRange size={13} /> {manifest.months[0]} to {manifest.latestObservedMonth}</span></>}</div>}
    {!manifest ? <LoadingState error={error} retry={retry} /> : <main className={`workspace-stage workspace-stage-${page}`}>{page === "overview" && <Overview go={go} />}{page === "regional-map" && <RegionalMap />}{page === "coverage" && <Coverage manifest={manifest} />}{page === "evaluation" && <Evaluation manifest={manifest} />}{page === "provenance" && <Provenance manifest={manifest} />}</main>}
  </div>;
}
