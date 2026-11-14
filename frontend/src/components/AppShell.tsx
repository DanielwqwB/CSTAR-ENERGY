import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { navigation, pageTitles } from "../data/navigation";
import { Monitor, Search, Layers, BarChart3, UserRound } from "lucide-react";
import { Badge, Brand, Button, Card, Icon } from "./ui";
import { colors, ui } from "../theme";
import { WorkspaceSearch } from "./WorkspaceSearch";
import type { Page } from "../types";

const tour: { title: string; body: string; page: Page }[] = [
  {
    title: "The Problem",
    body: "A persistent nighttime-light change is an observation—not an explanation. Select a candidate to begin.",
    page: "overview",
  },
  {
    title: "Multi-Satellite Evidence",
    body: "Black Marble, TROPOMI, meteorology, and Sentinel-2 contribute evidence at different spatial supports.",
    page: "data",
  },
  {
    title: "Event Investigation",
    body: "Review historical context, independent records, and missing evidence.",
    page: "investigation",
  },
  {
    title: "Wind-Aware Assessment",
    body: "Screen wind alignment alongside atmospheric footprints and competing sources.",
    page: "plume",
  },
  {
    title: "CCTF Attribution",
    body: "Supporting, missing, and inconclusive evidence remain visible.",
    page: "attribution",
  },
  {
    title: "Decision Support",
    body: "Export a screening report with provenance and explicit uncertainty.",
    page: "reports",
  },
];
export function AppShell({ children }: { children: ReactNode }) {
  const { page, go, logout, profile, toast, select } = useWorkspace();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const scroll = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [page]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpenMenu(null); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const navigate = (next: Page) => { go(next); setOpenMenu(null); };
  const groupIcons = [Monitor, Search, Layers, BarChart3];
  const activeGroup = navigation.find(group => group.items.some(item => item.id === page));
  const tourStep = (index: number) => {
    setStep(index);
    select("DEMO-002");
    navigate(tour[index].page);
  };
  return (
    <div className="app-shell">
      <div className="workspace">
        <header ref={header} className="topbar" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpenMenu(null);
        }}>
          <button className="brand-home" aria-label="CSTAR-Energy home" onClick={() => navigate("overview")}><Brand /></button>
          <nav className="top-navigation" aria-label="Workspace navigation">
            {navigation.map((group, index) => {
              const Glyph = groupIcons[index];
              const expanded = openMenu === group.group;
              return <div className="nav-dropdown" key={group.group}>
                <button className="nav-trigger" data-active={activeGroup === group} aria-expanded={expanded}
                  aria-controls={`nav-${group.group}`} onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setOpenMenu(expanded ? null : group.group);
                  }}>
                  <Glyph size={24} /><span>{group.group[0] + group.group.slice(1).toLowerCase()}</span><Icon name="chevron-down" size={16} color="currentColor" />
                </button>
                {expanded && <div className="nav-dropdown-panel" id={`nav-${group.group}`}>
                  <span className="dropdown-label">{group.group}</span>
                  {group.items.map(item => <button className="nav-button" key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
                    <Icon name={item.icon} color="currentColor" /><span>{item.label}</span>
                  </button>)}
                </div>}
              </div>;
            })}
          </nav>
          <WorkspaceSearch />
          <div className="topbar-account">
            <button className="alert-button" aria-label="Research alerts" onClick={() => navigate("alerts")}><Icon name="notifications-outline" size={23} color={colors.cyan} /></button>
            <div className="nav-dropdown">
              <button className="profile-trigger" aria-expanded={openMenu === "profile"} aria-controls="profile-menu" onClick={(event) => {
                trigger.current = event.currentTarget; setOpenMenu(openMenu === "profile" ? null : "profile");
              }}><span className="avatar"><UserRound size={23} /></span><span className="profile-copy"><strong>{profile.name}</strong><small>Research Analyst</small></span><Icon name="chevron-down" color="currentColor" size={16} /></button>
              {openMenu === "profile" && <div className="nav-dropdown-panel profile-menu" id="profile-menu">
                <Badge tone="amber">DEMONSTRATION</Badge>
                <button className="nav-button" onClick={() => navigate("profile")}>View profile</button>
                <button className="nav-button" onClick={() => navigate("settings")}>Account settings</button>
                <button className="nav-button" onClick={() => { setOpenMenu(null); tourStep(0); }}>Guided demonstration</button>
                <button className="nav-button" onClick={logout}>Sign out</button>
              </div>}
            </div>
          </div>
        </header>
        <main
          ref={scroll}
          className="workspace-main"
          style={{ paddingBottom: step === null ? 36 : 290 }}
        >
          <div className="workspace-content">
            {page !== "overview" && <div className="page-heading stack" style={{ gap: 8 }}>
              <span className="page-eyebrow">{activeGroup?.group}</span>
              <h1
                style={{ ...ui.heading, fontSize: "clamp(23px, 2.2vw, 30px)", margin: 0 }}
              >
                {pageTitles[page][0]}
              </h1>
              <span style={ui.muted}>{pageTitles[page][1]}</span>
            </div>
            }
            {children}
            <footer
              style={{
                borderTop: `1px solid ${colors.border}`,
                paddingTop: 16,
              }}
            >
              <span style={ui.small}>
                CSTAR—ENERGY · Research Screening Output · Synthetic
                demonstration data
              </span>
            </footer>
          </div>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span
            style={{
              maxWidth: 600,
              padding: 16,
              borderRadius: 12,
              border: `1px solid ${colors.green}66`,
              backgroundColor: colors.panel,
              color: colors.green,
              fontSize: 12,
            }}
          >
            {toast}
          </span>
        </div>
      )}
      {step !== null && (
        <aside className="tour" aria-label="Guided demonstration">
          <Card
            title={`Scene ${step + 1} — ${tour[step].title}`}
            action={
              <button
                type="button"
                aria-label="Close guided tour"
                onClick={() => setStep(null)}
              >
                <Icon name="close" />
              </button>
            }
          >
            <Badge>GUIDED DEMO · {step + 1}/6</Badge>
            <span style={ui.muted}>{tour[step].body}</span>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <Button
                label="Back"
                secondary
                disabled={step === 0}
                onClick={() => tourStep(Math.max(0, step - 1))}
              />
              <Button
                label={step === 5 ? "Finish" : "Next"}
                onClick={() =>
                  step === 5 ? setStep(null) : tourStep(step + 1)
                }
              />
            </div>
          </Card>
        </aside>
      )}
    </div>
  );
}
