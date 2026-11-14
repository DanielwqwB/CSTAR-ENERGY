import React from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
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
  const { width } = useWindowDimensions();
  const wide = width > 1200;
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
      "#22d3ee",
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
    <View style={ui.stack}>
      <View style={ui.wrap}>
        <View style={{ minWidth: 230 }}>
          <Select
            label="Study region"
            value={region}
            options={regions}
            onChange={setRegion}
          />
        </View>
        <View style={{ justifyContent: "flex-end", paddingBottom: 12 }}>
          <Badge tone="dim">Jan 2023 – Dec 2024</Badge>
        </View>
      </View>
      <Notice>
        5 data sources connected in demonstration mode · Last sample processing:
        18 Jun 2025, 14:32 UTC
      </Notice>
      <View style={ui.wrap}>
        {metrics.map(([label, value, note, page, color]) => (
          <Pressable
            accessibilityRole="button"
            key={label}
            onPress={() => go(page)}
            style={{
              flexGrow: 1,
              flexBasis: wide ? 145 : 140,
              backgroundColor: colors.panel,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 11,
              padding: 16,
              gap: 9,
            }}
          >
            <Text style={[ui.small, { color: colors.muted }]}>{label}</Text>
            <Text style={{ color, fontSize: 29, fontWeight: "600" }}>
              {value}
            </Text>
            <Text style={[ui.small, { fontSize: 9 }]}>{note}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 18 }}>
        <Card
          title="Regional transition map"
          subtitle="Select a zone to open its event investigation"
          action={
            <Button secondary label="Open map" onPress={() => go("map")} />
          }
          style={{ flex: wide ? 2 : undefined }}
        >
          <TransitionMap
            events={filtered}
            onSelect={(event) => {
              select(event.id);
              go("investigation");
            }}
          />
        </Card>
        <View style={{ flex: wide ? 1 : undefined, gap: 18 }}>
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
              <View
                key={label}
                style={[ui.row, { justifyContent: "space-between" }]}
              >
                <Text style={ui.muted}>{label}</Text>
                <Text
                  style={[
                    ui.small,
                    { color: value === "Active" ? colors.green : colors.amber },
                  ]}
                >
                  {value}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      </View>
      <Card
        title="Latest candidate events"
        subtitle={`${filtered.length} synthetic events · deterministic demonstration data`}
        action={
          <Button label="View all" secondary onPress={() => go("events")} />
        }
      >
        <EventList events={filtered} />
      </Card>
      <Card
        title="Dataset readiness"
        subtitle="Sample products; no live NASA fetch"
      >
        {datasets.map(([name, product, scale, status]) => (
          <Pressable
            key={name}
            onPress={() => go("data")}
            style={[ui.row, { paddingVertical: 6 }]}
          >
            <Icon name="server-outline" color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={ui.text}>{name}</Text>
              <Text style={ui.small}>
                {product} · {scale}
              </Text>
            </View>
            <Status value={status} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
