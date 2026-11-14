import { css } from "../styles";
import React, { useEffect, useState } from "react";
import { Badge, Button, Card, Notice, Select, Status } from "../components/ui";
import { TrendChart } from "../components/Charts";
import { TransitionMap } from "../components/TransitionMap";
import { EventPicker } from "./InvestigationScreen";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  api,
  type AtmosphereCellPage,
  type AtmosphereManifest,
  type CctfAssessment,
} from "../api";
import { colors, ui } from "../theme";

function monthsBetween(start: string, end: string) {
  const [startYear, startMonth] = start.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = end.slice(0, 7).split("-").map(Number);
  const first = startYear * 12 + startMonth - 1;
  const last = endYear * 12 + endMonth - 1;
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const value = first + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

function formatMetric(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

function PublishedAtmosphereCard() {
  const [manifest, setManifest] = useState<AtmosphereManifest>();
  const [manifestError, setManifestError] = useState("");
  const [month, setMonth] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AtmosphereCellPage>();
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const limit = 20;

  useEffect(() => {
    let active = true;
    api<AtmosphereManifest>("/atmosphere/manifest")
      .then((data) => {
        if (!active) return;
        setManifest(data);
        setMonth(data.start_month.slice(0, 7));
      })
      .catch((error: unknown) => {
        if (active)
          setManifestError(
            error instanceof Error ? error.message : "The backend request failed.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!month) return;
    let active = true;
    setPage(undefined);
    setPageLoading(true);
    setPageError("");
    api<AtmosphereCellPage>(
      `/atmosphere/no2?month=${encodeURIComponent(month)}&limit=${limit}&offset=${offset}`,
    )
      .then((data) => {
        if (active) setPage(data);
      })
      .catch((error: unknown) => {
        if (active)
          setPageError(
            error instanceof Error ? error.message : "The backend request failed.",
          );
      })
      .finally(() => {
        if (active) setPageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, offset]);

  const months = manifest
    ? monthsBetween(manifest.start_month, manifest.end_month)
    : [];
  return (
    <Card
      title="C · Published TROPOMI NO₂ grid"
      subtitle="Quality-screened observed values and the selected model baseline"
    >
      {manifestError ? (
        <p role="alert">Published atmospheric data unavailable: {manifestError}</p>
      ) : !manifest ? (
        <p role="status">Loading published atmospheric run…</p>
      ) : (
        <>
          <div className="stack" style={css(ui.wrap)}>
            <Badge tone="dim">Model: {manifest.model_name}</Badge>
            <Badge tone="amber">
              Interpretation: {manifest.anomaly_interpretation}
            </Badge>
            <Badge tone="dim">
              {manifest.total_cell_months.toLocaleString()} cell-months
            </Badge>
          </div>
          <Notice warning>
            Expected NO₂ is the climatology baseline; residual equals observed
            minus expected. Missing or rejected observations remain blank. This
            is not an emissions estimate or source attribution.
          </Notice>
          <Select
            label="Published data month"
            value={month}
            options={months}
            onChange={(value) => {
              setMonth(value);
              setOffset(0);
            }}
          />
          {pageLoading ? (
            <p role="status">Loading {month} cell data…</p>
          ) : pageError ? (
            <p role="alert">Atmospheric cells unavailable: {pageError}</p>
          ) : page ? (
            <>
              <div
                className="overview-table-scroll"
                role="region"
                aria-label="Published TROPOMI cell-month data"
                tabIndex={0}
              >
                <table className="overview-table">
                  <thead>
                    <tr>
                      {[
                        "Cell",
                        "Quality status",
                        "QA mean",
                        "Valid orbits",
                        "Coverage",
                        "Expected (µmol/m²)",
                        "Observed (µmol/m²)",
                        "Residual (µmol/m²)",
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <tr key={row.cell_id}>
                        <td>{row.cell_id}</td>
                        <td>{row.observation_status.replaceAll("_", " ")}</td>
                        <td>{formatMetric(row.qa_mean)}</td>
                        <td>{row.valid_orbit_count}</td>
                        <td>{(row.coverage_fraction * 100).toFixed(1)}%</td>
                        <td>{formatMetric(row.expected_no2_umol_m2)}</td>
                        <td>{formatMetric(row.observed_no2_umol_m2)}</td>
                        <td>{formatMetric(row.anomaly_umol_m2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="stack" style={css(ui.row)}>
                <span style={css(ui.small)}>
                  {page.total
                    ? `Showing ${page.offset + 1}–${Math.min(page.offset + page.rows.length, page.total)} of ${page.total.toLocaleString()} cells`
                    : "No cells for this month"}
                </span>
                <Button
                  secondary
                  label="Previous cells"
                  disabled={offset === 0 || pageLoading}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                />
                <Button
                  secondary
                  label="Next cells"
                  disabled={offset + limit >= page.total || pageLoading}
                  onClick={() => setOffset(offset + limit)}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

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
      <PublishedAtmosphereCard />
      <Card title="D · Contextual evidence">
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
function LegacyAttributionScreen() {
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

export function AttributionScreen() {
  const { selected } = useWorkspace();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<CctfAssessment>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<CctfAssessment>("/cctf/assessment")
      .then((data) => active && setAssessment(data))
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The CCTF request failed.");
      });
    return () => { active = false; };
  }, [selected.id]);

  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card title="CCTF evidence fingerprint" subtitle="Conservative screening result for the selected event">
        {error ? <p role="alert">CCTF assessment unavailable: {error}</p> : !assessment ? <p role="status">Loading CCTF assessment…</p> : <>
          <div className="stack" style={css(ui.row)}>
            <Status value={assessment.label} />
            <span style={css(ui.muted)}>No confidence score is reported.</span>
          </div>
          <Notice warning>
            {assessment.pilot_event
              ? `Pilot configured: ${assessment.pilot_event.title} (${assessment.pilot_event.barangay}, ${assessment.pilot_event.municipality}). The engine remains unresolved until the evidence gate is met.`
              : "No pilot event is configured. The engine abstains from mechanism attribution until event geometry, a treatment window, a source record, radiance change, and matched wind evidence are supplied."}
          </Notice>
          {(assessment.evidence ?? []).map((item) => (
            <button className="stack" type="button" aria-expanded={expanded === item.key} key={item.key} onClick={() => setExpanded(expanded === item.key ? null : item.key)} style={css({ gap: 10, paddingBlock: 10, borderBottomWidth: 1, borderBottomColor: colors.border })}>
              <div className="stack" style={css(ui.row)}>
                <span style={css([ui.text, { flex: 1 }])}>{item.label}</span>
                <Status value={item.state === "available" ? "Available" : item.state === "conflicting" ? "Conflicting" : "Missing"} />
              </div>
              {expanded === item.key && <span style={css(ui.muted)}>{item.detail}</span>}
            </button>
          ))}
          {(assessment.limitations ?? []).map((limitation) => <span key={limitation} style={css(ui.muted)}>• {limitation}</span>)}
        </>}
      </Card>
      <Card title="Assessment state" subtitle="Mechanism selection is disabled until the evidence gate is met">
        <span style={css(ui.text)}>Selected workspace record: {selected.id}</span>
        <span style={css(ui.muted)}>{assessment?.pilot_event ? "The configured pilot is record-assisted; mechanism attribution remains disabled while the gate is incomplete." : "No verified pilot event is configured, so the system cannot produce a candidate mechanism verdict."}</span>
      </Card>
    </div>
  );
}
