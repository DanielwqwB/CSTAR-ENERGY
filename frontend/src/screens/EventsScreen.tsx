import { useState } from "react";
import { Search, FileText, RotateCcw, Download, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { EventList } from "../components/EventList";
import { useWorkspace } from "../context/WorkspaceContext";
import { filterEvents, statuses, toCsv } from "../utils/events";
import { exportText } from "../utils/export";
import type { TransitionEvent } from "../types";
export function EventsScreen() {
  const { events, notify } = useWorkspace();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All mechanisms");
  const [status, setStatus] = useState("All statuses");
  const [period, setPeriod] = useState("All observation periods");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [sort, setSort] = useState<keyof TransitionEvent>("id");
  const [descending, setDescending] = useState(false);
  const years = [...new Set(events.flatMap(event => event.onset.match(/\b20\d{2}\b/g) ?? []))].sort();
  const filtered = filterEvents(events, search, type, status).filter(event => period === "All observation periods" || event.onset.includes(period)).sort((a,b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), undefined, { numeric: true }) * (descending ? -1 : 1));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const reset = () => { setSearch(""); setType("All mechanisms"); setStatus("All statuses"); setPeriod("All observation periods"); setPage(1); };
  return <div className="catalogue-screen">
    <section className="catalogue-toolbar" aria-label="Catalogue filters"><label className="catalogue-search"><Search size={20} /><input aria-label="Search catalogue" placeholder="Search event ID, location, or mechanism..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
      <select aria-label="Filter by mechanism" value={type} onChange={e => { setType(e.target.value); setPage(1); }}>{["All mechanisms", "Lighting", "Industrial", "Mixed", "Unresolved"].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by review status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{["All statuses", ...statuses].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by observation year" value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }}>{["All observation periods", ...years].map(value => <option key={value}>{value}</option>)}</select>
      <button onClick={reset}><RotateCcw size={18} />Reset Filters</button><button className="catalogue-export" onClick={() => { exportText("cstar-events.csv", toCsv(filtered), "text/csv").catch(() => notify("The export could not be opened. Please try again.")); }}><Download size={18} />Export CSV</button>
    </section>
    <section className="catalogue-queue"><header><span className="overview-panel-icon"><FileText /></span><div><h2>Event Review Queue</h2><p>{filtered.length} of {events.length} synthetic candidates</p></div><span className="queue-count">Showing {filtered.length ? start + 1 : 0}–{Math.min(start + size, filtered.length)} of {filtered.length} events</span><label>View: <select aria-label="Events per page" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>{[5,10,20,50].map(value => <option key={value} value={value}>{value} per page</option>)}</select></label></header>
      <EventList events={filtered.slice(start, start + size)} editable sortKey={sort} descending={descending} onSort={key => { setSort(key); setDescending(key === sort ? !descending : false); setPage(1); }} />
      <footer><p><Info size={20} />Synthetic demonstration data for system evaluation and illustration only.</p><nav aria-label="Catalogue pagination"><button aria-label="Previous catalogue page" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={18} /></button>{Array.from({length: pages}, (_,i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n-current) <= 1).map(n => <button key={n} aria-label={`Catalogue page ${n}`} aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>)}<button aria-label="Next catalogue page" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight size={18} /></button></nav></footer>
    </section>
  </div>;
}
