import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { navigation } from "../data/navigation";
import { useWorkspace } from "../context/WorkspaceContext";

export function WorkspaceSearch() {
  const { events, go, select } = useWorkspace();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = query.trim().toLowerCase();
  const pages = term ? navigation.flatMap(group => group.items).filter(item => item.label.toLowerCase().includes(term)) : [];
  const matches = term ? events.filter(event => `${event.id} ${event.location} ${event.shortType}`.toLowerCase().includes(term)) : [];
  const close = () => { setOpen(false); setQuery(""); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <div className="workspace-search" ref={root} role="search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); input.current?.focus(); }
  }}>
    <div className="search-field"><Search size={18} aria-hidden="true" />
      <input ref={input} type="search" aria-label="Search pages and events" placeholder="Search pages, events?" value={query}
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} />
      {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={16} /></button>}
    </div>
    {open && term && <div className="search-results" aria-label="Search results">
      <p role="status">{pages.length + matches.length} results</p>
      {pages.length > 0 && <span className="dropdown-label">PAGES</span>}
      {pages.map(item => <button key={item.id} onClick={() => { go(item.id); close(); }}>{item.label}</button>)}
      {matches.length > 0 && <span className="dropdown-label">EVENTS</span>}
      {matches.map(event => <button key={event.id} onClick={() => { select(event.id); go("investigation"); close(); }}><strong>{event.id}</strong><span>{event.location}</span></button>)}
      {!pages.length && !matches.length && <p>No matches. Try a page name, location, or event ID.</p>}
    </div>}
  </div>;
}
