import { css } from "../styles";
import React from "react";
import {
  Badge,
  Button,
  Card,
  Icon,
  Notice,
  Select,
  Status,
} from "../components/ui";
import { TransitionMap } from "../components/TransitionMap";
import { Distribution } from "../components/Charts";
import { EventList } from "../components/EventList";
import { useWorkspace } from "../context/WorkspaceContext";
import { filterEvents } from "../utils/events";
import datasets from "../data/datasets.json";
import { colors, ui } from "../theme";
import type { Page } from "../types";
export const regions = [
  "Aurelia Pilot Locality",
  "North District Subset",
  "Eastport Study Area",
];
export function OverviewScreen() {
  const { events, region, setRegion, go, select } = useWorkspace();
  const filtered = filterEvents(events, "", undefined, undefined, region);
  const metrics: [string, string, string, Page, string][] = [
    [
      "Persistent Candidates",
      String(filtered.length),
      "All synthetic records",
      "events",
      colors.cyan,
    ],
    [
      "Lighting Candidates",
      String(filtered.filter((e) => e.shortType === "Lighting").length),
      "Needs fixture verification",
      "events",
      colors.cyan,
    ],
    [
      "Industrial Change",
      String(filtered.filter((e) => e.shortType === "Industrial").length),
      "Source remains unresolved",
      "events",
      "#24716d",
    ],
    [
      "Mixed / Unresolved",
      String(
        filtered.filter((e) => ["Mixed", "Unresolved"].includes(e.shortType))
          .length,
      ),
      "Explanations overlap",
      "attribution",
      colors.amber,
    ],
    [
      "Awaiting Verification",
      String(filtered.filter((e) => e.status !== "Reviewed").length),
      "Derived from event state",
      "records",
      colors.rose,
    ],
    [
      "Multi-Sensor Coverage",
      `${filtered.filter((e) => e.adequacy !== "Insufficient").length}/${filtered.length}`,
      "Sample observation coverage",
      "data",
      colors.green,
    ],
  ];
  return (
    <div className="stack" style={css(ui.stack)}>
      <div className="stack" style={css(ui.wrap)}>
        <div className="stack" style={css({ minWidth: 230 })}>
          <Select
            label="Study region"
            value={region}
            options={regions}
            onChange={setRegion}
          />
        </div>
        <div
          className="stack"
          style={css({ justifyContent: "flex-end", paddingBottom: 12 })}
        >
          <Badge tone="dim">Jan 2023 – Dec 2024</Badge>
        </div>
      </div>
      <Notice>
        5 data sources connected in demonstration mode · Last sample processing:
        18 Jun 2025, 14:32 UTC
      </Notice>
      <div className="metrics-grid">
        {metrics.map(([label, value, note, page, color]) => (
          <button
            className="stack"
            type="button"
            role="button"
            key={label}
            onClick={() => go(page)}
            style={css({
              backgroundColor: colors.panel,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 11,
              padding: 16,
              gap: 9,
            })}
          >
            <span style={css([ui.small, { color: colors.muted }])}>
              {label}
            </span>
            <span style={css({ color, fontSize: 29, fontWeight: "600" })}>
              {value}
            </span>
            <span style={css([ui.small, { fontSize: 9 }])}>{note}</span>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <Card
          title="Regional transition map"
          subtitle="Select a zone to open its event investigation"
          action={
            <Button secondary label="Open map" onClick={() => go("map")} />
          }
        >
          <TransitionMap
            events={filtered}
            onSelect={(event) => {
              select(event.id);
              go("investigation");
            }}
          />
        </Card>
        <div className="stack" style={css({ gap: 18 })}>
          <Card
            title="Candidate distribution"
            subtitle="Current demonstration dataset"
          >
            <Distribution events={filtered} />
          </Card>
          <Card title="Research status">
            {[
              ["Screening pipeline", "Active"],
              ["CCTF model", "Not calibrated"],
              ["Independent validation", "Not evaluated"],
              [
                "Coverage warning",
                `${filtered.filter((e) => e.adequacy === "Insufficient").length} active`,
              ],
            ].map(([label, value]) => (
              <div
                className="stack"
                key={label}
                style={css([ui.row, { justifyContent: "space-between" }])}
              >
                <span style={css(ui.muted)}>{label}</span>
                <span
                  style={css([
                    ui.small,
                    { color: value === "Active" ? colors.green : colors.amber },
                  ])}
                >
                  {value}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>
      <Card
        title="Latest candidate events"
        subtitle={`${filtered.length} synthetic events · deterministic demonstration data`}
        action={
          <Button label="View all" secondary onClick={() => go("events")} />
        }
      >
        <EventList events={filtered} />
      </Card>
      <Card
        title="Dataset readiness"
        subtitle="Sample products; no live NASA fetch"
      >
        {datasets.map(([name, product, scale, status]) => (
          <button
            className="stack"
            type="button"
            key={name}
            onClick={() => go("data")}
            style={css([ui.row, { paddingBlock: 6 }])}
          >
            <Icon name="server-outline" color={colors.cyan} />
            <div className="stack" style={css({ flex: 1 })}>
              <span style={css(ui.text)}>{name}</span>
              <span style={css(ui.small)}>
                {product} · {scale}
              </span>
            </div>
            <Status value={status} />
          </button>
        ))}
      </Card>
    </div>
  );
}
