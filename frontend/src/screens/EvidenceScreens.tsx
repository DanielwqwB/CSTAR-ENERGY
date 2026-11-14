import { css } from "../styles";
import React, { useState } from "react";
import { Badge, Button, Card, Notice, Select, Status } from "../components/ui";
import { TrendChart } from "../components/Charts";
import { TransitionMap } from "../components/TransitionMap";
import { EventPicker } from "./InvestigationScreen";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, ui } from "../theme";
export function TimelineScreen() {
  const { selected } = useWorkspace();
  const [period, setPeriod] = useState("Monthly · Jan–Dec 2024");
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Select
        value={period}
        options={["Monthly · Jan–Dec 2024", "Quarterly view"]}
        onChange={setPeriod}
      />
      <Card
        title="A · Historical Nighttime Radiance"
        subtitle="Illustrative radiance units; brightness is not electricity consumption"
      >
        <TrendChart
          quarterly={period === "Quarterly view"}
          variant={Number(selected.id.slice(-1)) - 1}
        />
      </Card>
      <Card
        title="B · Atmospheric NO₂"
        subtitle="Illustrative tropospheric column signal; not a measured event series"
      >
        <TrendChart mode="no2" quarterly={period === "Quarterly view"} />
        <Status value={selected.atmosphere} />
      </Card>
      <Card title="C · Contextual evidence">
        <span style={css(ui.text)}>{selected.record}</span>
        <span style={css(ui.muted)}>Candidate onset: {selected.onset}</span>
        <Notice warning>{selected.uncertainty}</Notice>
      </Card>
    </div>
  );
}
export function PlumeScreen() {
  const { selected, events, select } = useWorkspace();
  const [pass, setPass] = useState("Overpass 1 · Compatible");
  const compatible = pass.includes("Compatible");
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card
        title="Source–plume screening view"
        subtitle="Illustrative footprint geometry; not a facility emission estimate"
      >
        <TransitionMap
          events={events}
          selected={selected.id}
          onSelect={(e) => select(e.id)}
          plume={compatible}
          height={370}
        />
      </Card>
      <Card title="Observation controls">
        <Select
          label="Quality-screened sample overpass"
          value={pass}
          options={[
            "Overpass 1 · Compatible",
            "Overpass 2 · Compatible",
            "Overpass 3 · Compatible",
            "Overpass 4 · Inconclusive",
            "Overpass 5 · Insufficient coverage",
          ]}
          onChange={setPass}
        />
        <div className="stack" style={css(ui.wrap)}>
          <Badge tone={compatible ? "green" : "amber"}>
            {compatible ? "Wind alignment compatible" : "No reliable alignment"}
          </Badge>
          <Badge tone="dim">Illustrative winds · NE</Badge>
        </div>
      </Card>
      <Card title="Screening indicators">
        <span style={css(ui.muted)}>{selected.wind}</span>
        <span style={css(ui.muted)}>
          Competing source context: {selected.uncertainty}
        </span>
      </Card>
      <Notice warning>
        An atmospheric NO₂ enhancement located downwind may be consistent with a
        source, but wind alignment alone does not establish that the source
        caused the pollution.
      </Notice>
    </div>
  );
}
export function CounterfactualScreen() {
  const { selected } = useWorkspace();
  const [control, setControl] = useState("Matched industrial zones A + C");
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card title="Comparison configuration">
        <Select
          label="Comparison cohort"
          value={control}
          options={[
            "Matched industrial zones A + C",
            "Road-adjacent controls B + D",
            "Regional synthetic control",
          ]}
          onChange={setControl}
        />
        <Notice>
          Selected cohort: {control}. This prototype uses one shared
          illustrative comparison trajectory; cohort-specific model estimates
          are not available.
        </Notice>
      </Card>
      <Card
        title="Observed vs matched comparison"
        subtitle="Illustrative trajectories; no causal estimate"
      >
        <TrendChart
          mode="comparison"
          variant={Number(selected.id.slice(-1)) - 1}
        />
      </Card>
      <Notice warning>
        Post-event deviation is shown for inspection only. Matching assumptions
        have not been scientifically validated.
      </Notice>
    </div>
  );
}
export function AttributionScreen() {
  const { selected, update, notify } = useWorkspace();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = [
    [
      "Radiance change",
      selected.adequacy === "Insufficient" ? "Inconclusive" : "Supporting",
      selected.radiance,
    ],
    [
      "Change persistence",
      selected.adequacy === "Insufficient" ? "Missing" : "Supporting",
      "Observed across multiple illustrative monthly composites",
    ],
    ["Transition timing", "Supporting", selected.onset],
    ["Atmospheric NO₂ response", "Inconclusive", selected.atmosphere],
    [
      "Wind compatibility",
      selected.shortType === "Industrial" ? "Supporting" : "Inconclusive",
      selected.wind,
    ],
    [
      "Spatial structure",
      "Inconclusive",
      "Industrial and road context may both contribute",
    ],
    [
      "Construction evidence",
      "Inconclusive",
      "Illustrative Sentinel-2 context; primary documents required",
    ],
    ["Counterfactual deviation", "Inconclusive", "Descriptive comparison only"],
    ["Independent records", "Missing", selected.record],
    [
      "Observation quality",
      selected.adequacy === "Good" ? "Supporting" : "Inconclusive",
      selected.adequacy,
    ],
  ];
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card
        title="CCTF evidence fingerprint"
        subtitle="Select a row to inspect evidence details"
      >
        {rows.map(([label, status, detail]) => (
          <button
            className="stack"
            type="button"
            role="button"
            aria-expanded={expanded === label}
            key={label}
            onClick={() => setExpanded(expanded === label ? null : label)}
            style={css({
              gap: 10,
              paddingBlock: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            })}
          >
            <div className="stack" style={css(ui.row)}>
              <span style={css([ui.text, { flex: 1 }])}>{label}</span>
              <Status value={status} />
            </div>
            {expanded === label && <span style={css(ui.muted)}>{detail}</span>}
          </button>
        ))}
      </Card>
      <Card
        title="Competing mechanisms"
        subtitle="Choose the working explanation—not a confirmed cause"
      >
        <Select
          value={selected.mechanism}
          options={[
            "Lighting-system modernization",
            "Combustion-associated industrial expansion",
            "Mixed/unresolved transition",
            "Unresolved",
          ]}
          onChange={(mechanism) => {
            update(selected.id, { mechanism });
            notify("Working explanation saved. This is not a confirmed cause.");
          }}
        />
        <span style={css(ui.muted)}>{selected.summary}</span>
        <Notice warning>{selected.uncertainty}</Notice>
        <Button
          secondary
          label="Flag missing evidence"
          onClick={() => {
            update(selected.id, { status: "Additional Evidence Required" });
            notify("Event flagged for additional evidence.");
          }}
        />
      </Card>
    </div>
  );
}
