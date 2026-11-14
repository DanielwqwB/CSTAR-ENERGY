import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { navigation, pageTitles } from "../data/navigation";
import { useViewport } from "../hooks/useViewport";
import { Badge, Brand, Button, Card, Icon } from "./ui";
import { colors, ui } from "../theme";
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
  const { width } = useViewport();
  const wide = width >= 1050;
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const scroll = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [page]);
  useEffect(() => {
    if (drawer && !wide) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [drawer, wide]);
  const navigate = (next: Page) => {
    go(next);
    setDrawer(false);
  };
  const tourStep = (index: number) => {
    setStep(index);
    select("DEMO-002");
    navigate(tour[index].page);
  };
  const compact = wide && collapsed;
  const sidebar = (
    <aside
      className={`sidebar ${compact ? "compact" : ""}`}
      style={{ height: "100%" }}
    >
      <div
        style={{
          padding: compact ? 15 : 22,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {compact ? (
          <Icon name="planet" color={colors.cyan} size={30} />
        ) : (
          <Brand />
        )}
      </div>
      <nav aria-label="Workspace navigation">
        {navigation.map((group) => (
          <div className="sidebar-group" key={group.group}>
            {!compact && (
              <p
                style={{
                  ...ui.label,
                  color: colors.dim,
                  fontSize: 9,
                  padding: 10,
                }}
              >
                {group.group}
              </p>
            )}
            {group.items.map((item) => (
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                className="nav-button"
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon
                  name={item.icon}
                  size={17}
                  color={page === item.id ? colors.cyan : colors.muted}
                />
                {!compact && <span>{item.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div
        className="stack"
        style={{
          padding: 14,
          borderTop: `1px solid ${colors.border}`,
          gap: 10,
        }}
      >
        <Button
          label={compact ? "Demo" : "Guided demonstration"}
          secondary
          onClick={() => tourStep(0)}
        />
        {wide ? (
          <Button
            label={compact ? "Expand" : "Collapse sidebar"}
            secondary
            onClick={() => setCollapsed(!collapsed)}
          />
        ) : (
          <Button
            label="Close menu"
            secondary
            onClick={() => setDrawer(false)}
          />
        )}
      </div>
    </aside>
  );
  return (
    <div className="app-shell">
      {wide && sidebar}
      <dialog
        ref={dialog}
        className="dialog"
        aria-label="Navigation menu"
        onCancel={() => setDrawer(false)}
        onClose={() => setDrawer(false)}
        style={{
          margin: 0,
          height: "100dvh",
          width: Math.min(300, width - 45),
        }}
      >
        {!wide && sidebar}
      </dialog>
      <div className="workspace">
        <header className="topbar">
          {!wide && (
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
              style={{ padding: 8 }}
            >
              <Icon name="menu-outline" size={24} />
            </button>
          )}
          <span style={{ ...ui.small, flex: 1 }}>
            {wide ? `Workspace › ${pageTitles[page][0]}` : "CSTAR—ENERGY"}
          </span>
          {width > 600 && <Badge tone="amber">DEMONSTRATION</Badge>}
          <button
            type="button"
            aria-label="Research alerts"
            onClick={() => navigate("alerts")}
            style={{ padding: 8 }}
          >
            <Icon name="notifications-outline" />
          </button>
          {wide && (
            <div className="stack">
              <span style={{ ...ui.text, fontSize: 11 }}>{profile.name}</span>
              <span style={{ ...ui.small, fontSize: 9 }}>Research Analyst</span>
            </div>
          )}
          <button
            type="button"
            aria-label="Sign out"
            onClick={logout}
            style={{ padding: 8 }}
          >
            <Icon name="log-out-outline" />
          </button>
        </header>
        <main
          ref={scroll}
          className="workspace-main"
          style={{ paddingBottom: step === null ? 36 : 290 }}
        >
          <div className="workspace-content">
            <div className="stack" style={{ gap: 8 }}>
              <h1
                style={{ ...ui.heading, fontSize: wide ? 25 : 23, margin: 0 }}
              >
                {pageTitles[page][0]}
              </h1>
              <span style={ui.muted}>{pageTitles[page][1]}</span>
            </div>
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
