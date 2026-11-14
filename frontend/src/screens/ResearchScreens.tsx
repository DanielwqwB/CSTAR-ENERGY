import { css } from "../styles";
import React, { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Notice,
  Select,
  Status,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { useResearchData } from "../context/ResearchDataContext";
import { colors, ui } from "../theme";
import { exportText } from "../utils/export";
import { toCsv } from "../utils/events";
import { EventPicker } from "./InvestigationScreen";
import { regions } from "./OverviewScreen";
import { api, type EvaluationBundle, type EvaluationMatrix, type EvaluationScalar, type ModelEvaluation } from "../api";
export function DataScreen() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const { datasets: datasetResource } = useResearchData();
  const datasets = datasetResource.data;
  const matches = (datasets ?? []).filter((row) =>
    row.join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="stack" style={css(ui.stack)}>
      <Field
        placeholder="Search datasets, instruments, or products…"
        value={search}
        onChange={setSearch}
      />
      <Notice>
        Sample products only. No live satellite downloads, processing jobs, or
        API credentials are configured.
      </Notice>
      {datasetResource.loading && (
        <p role="status">Loading sample dataset catalog…</p>
      )}
      {datasetResource.error && (
        <p role="alert">Dataset catalog unavailable: {datasetResource.error}</p>
      )}
      {datasets && matches.map(([name, product, scale, status, description]) => (
        <Card
          key={name}
          title={name}
          subtitle={product}
          action={<Status value={status} />}
        >
          <span style={css(ui.text)}>{description}</span>
          <span style={css(ui.muted)}>{scale}</span>
          <Button
            secondary
            label={expanded === name ? "Hide provenance" : "View provenance"}
            onClick={() => setExpanded(expanded === name ? "" : name)}
          />
          {expanded === name && (
            <Notice>
              Source family: {name}. Product: {product}. Catalog version:
              synthetic v0.4. All displayed values are illustrative; no source
              granules have been ingested. Quality status is a sample label.
            </Notice>
          )}
        </Card>
      ))}
      {datasets && !matches.length && (
        <span style={css(ui.muted)}>No datasets match this search.</span>
      )}
      <Card title="Sample processing history">
        <span style={css(ui.text)}>Synthetic catalog v0.4 prepared</span>
        <span style={css(ui.small)}>
          18 Jun 2025 · 14:32 UTC · Demonstration record
        </span>
        <Badge tone="green">Sample catalog ready</Badge>
      </Card>
    </div>
  );
}
export function RecordsScreen() {
  const { events, selected, records, addRecord, notify } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("Level C — Secondary report");
  const [error, setError] = useState("");
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card
        title="Intervention registry"
        subtitle="Simulated records are distinguished from verified documentation"
        action={
          <Button
            label={adding ? "Cancel" : "Add record"}
            secondary
            icon="add-outline"
            onClick={() => setAdding(!adding)}
          />
        }
      >
        {adding && (
          <div className="stack" style={css(ui.stack)}>
            <Field
              label="Record name"
              value={name}
              onChange={setName}
              placeholder="Describe the demonstration record"
            />
            <Select
              label="Evidence level"
              value={level}
              options={[
                "Level A — Primary record",
                "Level B — Official publication",
                "Level C — Secondary report",
              ]}
              onChange={setLevel}
            />
            {!!error && (
              <span style={css({ color: colors.rose })}>{error}</span>
            )}
            <Button
              label="Save demonstration record"
              onClick={() => {
                if (!name.trim()) {
                  setError("Enter a record name.");
                  return;
                }
                addRecord({
                  id: `LOCAL-${Date.now()}`,
                  name: name.trim(),
                  level,
                  eventId: selected.id,
                });
                setName("");
                setError("");
                setAdding(false);
                notify("Saving demonstration record…");
              }}
            />
          </div>
        )}
        {events
          .filter((e) => e.id === selected.id)
          .map((event) => (
            <div className="stack" key={event.id} style={css({ gap: 9 })}>
              <span style={css(ui.text)}>{event.record}</span>
              <span style={css(ui.small)}>
                {event.id} · {event.location}
              </span>
              <Badge tone="amber">Simulated · not independently verified</Badge>
            </div>
          ))}
        {records
          .filter((r) => r.eventId === selected.id)
          .map((record) => (
            <div
              className="stack"
              key={record.id}
              style={css({
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 15,
                gap: 8,
              })}
            >
              <span style={css(ui.title)}>{record.name}</span>
              <span style={css(ui.small)}>
                {record.id} · {record.level}
              </span>
              <Badge tone="amber">User-added demonstration record</Badge>
            </div>
          ))}
      </Card>
      <Notice warning>
        Adding a record does not verify it. Primary source documents, dates, and
        independent checks are still required.
      </Notice>
    </div>
  );
}
function PlaceholderAnalyticsScreen() {
  return (
    <div className="stack" style={css(ui.stack)}>
      <Notice warning>
        There are no labeled validation cases or calibrated model results in
        this prototype. Values below describe data readiness, not model
        performance.
      </Notice>
      <div className="stack" style={css(ui.wrap)}>
        {["Precision", "Recall", "F1 score", "Calibration"].map((label) => (
          <Card
            key={label}
            title={label}
            style={css({ flex: 1, minWidth: 150 })}
          >
            <span style={css({ color: colors.dim, fontSize: 32 })}>—</span>
            <Badge tone="amber">Not Evaluated</Badge>
          </Card>
        ))}
      </div>
      <Card
        title="Illustrative method comparison"
        subtitle="Research evaluation plan"
      >
        {[
          ["Radiance-only baseline", "Detect persistent nighttime changes"],
          [
            "Multi-sensor evidence",
            "Add atmospheric, weather, and land context",
          ],
          [
            "CCTF assessment",
            "Expose supporting, conflicting, and missing evidence",
          ],
        ].map(([title, detail]) => (
          <div
            className="stack"
            key={title}
            style={css({ gap: 6, paddingBlock: 8 })}
          >
            <span style={css(ui.title)}>{title}</span>
            <span style={css(ui.muted)}>{detail}</span>
          </div>
        ))}
      </Card>
      <Card
        title="Confusion matrix placeholder"
        subtitle="Awaiting labeled validation cases"
      >
        <div className="stack" style={css(ui.wrap)}>
          {["Lighting", "Industrial", "Mixed", "Unresolved"].map((label) => (
            <div
              className="stack"
              key={label}
              style={css({ flex: 1, minWidth: 110, gap: 10 })}
            >
              <span style={css(ui.small)}>{label}</span>
              {[0, 1, 2, 3].map((i) => (
                <div
                  className="stack"
                  key={i}
                  style={css({
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.raised,
                    borderRadius: 6,
                  })}
                >
                  <span style={css(ui.small)}>Not evaluated</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
export function AnalyticsScreen() {
  const [evaluations, setEvaluations] = useState<EvaluationBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<"blackmarble" | "merra" | "tropomi">("merra");

  useEffect(() => {
    let active = true;
    api<EvaluationBundle>("/evaluations")
      .then((data) => {
        if (!data?.blackmarble || !data?.merra || !data?.tropomi) {
          throw new Error("Evaluation data is not available from the backend.");
        }
        if (active) setEvaluations(data);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Evaluation data unavailable."));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <div className="stack" style={css(ui.stack)}><Notice warning>{error}</Notice></div>;
  if (!evaluations) return <div className="stack" style={css(ui.stack)}><Notice>Loading model evaluation artifacts…</Notice></div>;

  const models = [
    { key: "blackmarble", label: "Black Marble", evaluation: evaluations.blackmarble },
    { key: "merra", label: "MERRA-2", evaluation: evaluations.merra },
    { key: "tropomi", label: "TROPOMI NO₂", evaluation: evaluations.tropomi },
  ] as const;
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const formatValue = (value: unknown, key = "") => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") {
      if (key.toLowerCase().includes("percent") || key.toLowerCase().includes("accuracy")) return `${(key.toLowerCase().includes("accuracy") && value <= 1 ? value * 100 : value).toFixed(2)}%`;
      if (Number.isInteger(value) && Math.abs(value) >= 1000) return value.toLocaleString();
      return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(4);
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (key.toLowerCase().includes("missing")) {
        const total = entries.reduce((sum, [, item]) => sum + (typeof item === "number" ? item : 0), 0);
        return `${total.toLocaleString()} missing`;
      }
      return `${entries.length} fields`;
    }
    return String(value);
  };
  const testMetrics = (evaluation: ModelEvaluation) => asRecord(evaluation.metrics?.test_metrics) ?? asRecord(evaluation.metrics?.test);
  const comparisonColumns = (rows: Record<string, EvaluationScalar>[]) => {
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const preferred = ["model", "split", "mae", "mae_kelvin", "mae_umol_m2", "rmse", "rmse_kelvin", "rmse_umol_m2", "r2", "bias", "accuracy", "balanced_accuracy", "macro_f1", "training_seconds"];
    return [...preferred.filter((key) => keys.includes(key)), ...keys.filter((key) => !preferred.includes(key))];
  };
  const comparisonTable = (title: string, rows: Record<string, EvaluationScalar>[]) => {
    if (!rows.length) return <p className="analytics-empty">No comparison table was produced for this model.</p>;
    const columns = comparisonColumns(rows);
    return <details className="analytics-disclosure"><summary>{title}<span>{rows.length} rows</span></summary><div className="analytics-subsection"><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row.model ?? "model")}-${String(row.split ?? index)}`}>{columns.map((column) => <td key={column}>{formatValue(row[column], column)}</td>)}</tr>)}</tbody></table></div></div></details>;
  };
  const matrix = (title: string, value: EvaluationMatrix | null) => value ? <details className="analytics-disclosure"><summary>{title}<span>{value.labels.length} × {value.rows.length}</span></summary><div className="analytics-subsection"><div className="analytics-table-wrap"><table className="analytics-table analytics-matrix"><thead><tr><th>Actual / Predicted</th>{value.labels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{value.rows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((cell, index) => <td key={`${row.label}-${index}`}>{formatValue(cell)}</td>)}</tr>)}</tbody></table></div></div></details> : <p className="analytics-empty">No labeled confusion matrix is available for this evaluation.</p>;
  const quality = (evaluation: ModelEvaluation) => {
    const data = asRecord(evaluation.data_quality);
    if (!data) return null;
    const entries = ["raw_rows", "raw_tropomi_rows", "model_rows", "train_rows", "validation_rows", "test_rows", "start_date", "end_date", "missing_values"];
    return <div className="analytics-quality">{entries.filter((key) => data[key] !== undefined).map((key) => <span key={key}><small>{key.replace(/_/g, " ")}</small><strong>{formatValue(data[key], key)}</strong></span>)}</div>;
  };
  const detailTable = (title: string, value: unknown) => {
    const data = asRecord(value);
    if (!data) return null;
    const entries = Object.entries(data).filter(([, item]) => item === null || ["string", "number", "boolean"].includes(typeof item));
    if (!entries.length) return null;
    return <details className="analytics-disclosure"><summary>{title}<span>{entries.length} values</span></summary><div className="analytics-subsection"><div className="analytics-table-wrap"><table className="analytics-table analytics-detail-table"><tbody>{entries.map(([name, item]) => <tr key={name}><th>{name.replace(/_/g, " ")}</th><td>{formatValue(item, name)}</td></tr>)}</tbody></table></div></div></details>;
  };
  const limitations = (value: unknown) => {
    if (!Array.isArray(value) || !value.length) return null;
    return <details className="analytics-disclosure"><summary>Known limitations<span>{value.length} notes</span></summary><div className="analytics-subsection"><ul className="analytics-limitations">{value.map((item, index) => <li key={`${String(item)}-${index}`}>{String(item)}</li>)}</ul></div></details>;
  };
  const panel = ({ key, label, evaluation }: (typeof models)[number]) => {
    const metrics = testMetrics(evaluation);
    const gate = asRecord(evaluation.metrics?.acceptance_gate);
    const band = asRecord(evaluation.band_metrics?.selected_test);
    const direction = asRecord(evaluation.metrics?.change_direction_diagnostic);
    const forward = asRecord(evaluation.forward_metrics?.candidate);
    const headline = key === "blackmarble"
      ? [["MAE", metrics?.mae], ["RMSE", metrics?.rmse], ["MAPE", metrics?.mape_percent], ["R²", metrics?.r2]]
      : key === "merra"
        ? [["MAE (K)", metrics?.mae_kelvin ?? metrics?.mae], ["RMSE (K)", metrics?.rmse_kelvin ?? metrics?.rmse], ["R²", metrics?.r2], ["Change-direction accuracy", direction?.accuracy]]
        : [["MAE (µmol/m²)", metrics?.mae_umol_m2 ?? metrics?.mae], ["RMSE", metrics?.rmse_umol_m2 ?? metrics?.rmse], ["R²", metrics?.r2], ["Band accuracy", band?.accuracy]];
    return <article className="analytics-model-panel" key={key}><header className="analytics-model-header"><div><h2>{label}</h2><p>{String(evaluation.metrics?.task ?? "Evaluation artifacts")}</p></div><Badge tone={gate?.passed === true ? "green" : "amber"}>{gate?.passed === true ? "Gate passed" : key === "blackmarble" ? "Regression only" : "Review result"}</Badge></header><div className="analytics-metric-grid">{headline.map(([name, value]) => <div className="analytics-metric" key={String(name)}><small>{String(name)}</small><strong>{formatValue(value, String(name))}</strong></div>)}</div>{key === "tropomi" && forward && <div className="analytics-callout"><strong>Forward 2026 candidate</strong><span>MAE {formatValue(forward.mae_umol_m2)} · RMSE {formatValue(forward.rmse_umol_m2)} · R² {formatValue(forward.r2)} · bias {formatValue(forward.bias_umol_m2)}</span></div>}{key === "tropomi" && <div className="analytics-callout"><strong>Interpretation</strong><span>{String(evaluation.metrics?.anomaly_interpretation ?? "Evaluation result only")}</span></div>}{quality(evaluation)}{detailTable("Selected evaluation", evaluation.metrics)}{detailTable("Test metrics", metrics)}{detailTable("Persistence / climatology baseline", evaluation.metrics?.persistence_test ?? evaluation.metrics?.persistence_baseline_test_metrics ?? evaluation.metrics?.spatial_seasonal_climatology_test)}{detailTable("Change direction diagnostic", direction)}{detailTable("Concentration-band evaluation", band)}{detailTable("Acceptance gate", gate)}{key === "tropomi" && detailTable("Forward 2026 candidate", forward)}{key === "tropomi" && detailTable("Forward 2026 baseline", evaluation.forward_metrics?.baseline)}{key === "tropomi" && detailTable("Forward 2026 no-weather control", evaluation.forward_metrics?.matched_no_weather_control)}{limitations(evaluation.metrics?.limitations)}{comparisonTable("Model comparison", evaluation.model_comparison)}{evaluation.forward_model_comparison && comparisonTable("Forward holdout comparison", evaluation.forward_model_comparison)}{evaluation.band_model_comparison && comparisonTable("NO₂ concentration-band comparison", evaluation.band_model_comparison)}{matrix(key === "tropomi" ? "NO₂ concentration-band confusion matrix" : "Change-class confusion matrix", evaluation.confusion_matrix)}</article>;
  };

  const activeModel = models.find((model) => model.key === activeKey) ?? models[0];
  return <div className="analytics-screen"><Notice warning>Evaluation artifacts are shown per model. They are not a combined CCTF score; CCTF attribution still requires an eligible pilot event and evidence gate.</Notice><div className="analytics-overview-grid analytics-model-tabs" role="tablist" aria-label="Model evaluations">{models.map(({ key, label, evaluation }) => <button key={key} type="button" role="tab" aria-selected={activeKey === key} className={activeKey === key ? "active" : ""} onClick={() => setActiveKey(key)}><small>{label}</small><strong>{key === "merra" && evaluation.metrics?.acceptance_gate && asRecord(evaluation.metrics.acceptance_gate)?.passed === true ? "Gate passed" : key === "tropomi" ? "Review required" : "Metrics available"}</strong><span>{evaluation.model_comparison.length ? `${evaluation.model_comparison.length} comparison rows` : `${evaluation.artifacts.length} artifact files`}</span></button>)}</div>{panel(activeModel)}</div>;
}
export function AlertsScreen() {
  const { events, select, go } = useWorkspace();
  const alerts = events.filter((e) => e.status !== "Reviewed");
  return (
    <div className="stack" style={css(ui.stack)}>
      <Card
        title="Active research alerts"
        subtitle={`${alerts.length} alerts derived from stored demonstration events`}
      >
        {!alerts.length && (
          <span style={css(ui.muted)}>
            All events have been reviewed. No active research alerts.
          </span>
        )}
        {alerts.map((event) => (
          <div
            className="stack"
            key={event.id}
            style={css({
              gap: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              paddingBottom: 18,
            })}
          >
            <div className="stack" style={css(ui.wrap)}>
              <Badge
                tone={event.adequacy === "Insufficient" ? "rose" : "amber"}
              >
                {event.adequacy === "Insufficient"
                  ? "Coverage warning"
                  : "Review required"}
              </Badge>
              <span style={css(ui.small)}>{event.id}</span>
            </div>
            <span style={css(ui.title)}>{event.location}</span>
            <span style={css(ui.muted)}>{event.uncertainty}</span>
            <Status value={event.status} />
            <Button
              secondary
              label="Open event"
              icon="arrow-forward"
              onClick={() => {
                select(event.id);
                go("investigation");
              }}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}
export function ReportsScreen() {
  const { selected, notify } = useWorkspace();
  const [format, setFormat] = useState("Research screening report");
  const report = {
    title: format,
    dataset: "Synthetic catalog v0.4",
    event: selected,
    disclaimer:
      "Research Screening Output — Not a Regulatory or Emissions Compliance Determination.",
  };
  const download = async (kind: "json" | "csv" | "txt") => {
    try {
      await exportText(
        `${selected.id}-report.${kind}`,
        kind === "json"
          ? JSON.stringify(report, null, 2)
          : kind === "csv"
            ? toCsv([selected])
            : `${format}\n\n${selected.id} · ${selected.location}\n${selected.summary}\n\nWorking explanation: ${selected.mechanism}\nUncertainty: ${selected.uncertainty}\nVerification: ${selected.verification}\nAnalyst notes: ${selected.notes || "None"}\n\n${report.disclaimer}`,
        kind === "json"
          ? "application/json"
          : kind === "csv"
            ? "text/csv"
            : "text/plain",
      );
    } catch {
      notify("Export could not be opened. Please try again.");
    }
  };
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card title="Report configuration">
        <Select
          label="Report title"
          value={format}
          options={[
            "Research screening report",
            "Event evidence summary",
            "Field verification brief",
          ]}
          onChange={setFormat}
        />
        <span style={css(ui.label)}>INCLUDED EVIDENCE</span>
        <div className="stack" style={css(ui.wrap)}>
          {[
            "Event metadata",
            "Working mechanism",
            "Uncertainty",
            "Verification needs",
            "Analyst notes",
          ].map((label) => (
            <Badge key={label} tone="green">
              ✓ {label}
            </Badge>
          ))}
        </div>
        <div className="stack" style={css(ui.wrap)}>
          <Button
            label="Export JSON"
            icon="download-outline"
            onClick={() => {
              void download("json");
            }}
          />
          <Button
            secondary
            label="CSV"
            onClick={() => {
              void download("csv");
            }}
          />
          <Button
            secondary
            label="Text report"
            onClick={() => {
              void download("txt");
            }}
          />
        </div>
      </Card>
      <Card title={format} subtitle="CSTAR—ENERGY · Synthetic demonstration">
        <Badge>{selected.id}</Badge>
        <span style={css(ui.heading)}>{selected.location}</span>
        <span style={css(ui.text)}>{selected.summary}</span>
        {[
          ["WORKING EXPLANATION", selected.mechanism],
          ["OBSERVED EVIDENCE", `${selected.radiance}; ${selected.atmosphere}`],
          ["UNCERTAINTY", selected.uncertainty],
          ["RECOMMENDED VERIFICATION", selected.verification],
          ["ANALYST NOTES", selected.notes || "No analyst notes yet."],
        ].map(([title, text]) => (
          <div className="stack" key={title} style={css({ gap: 6 })}>
            <span style={css([ui.label, { color: colors.cyan }])}>{title}</span>
            <span style={css(ui.muted)}>{text}</span>
          </div>
        ))}
        <Notice warning>{report.disclaimer}</Notice>
      </Card>
    </div>
  );
}
export function ProfileScreen() {
  return <SettingsScreen profileOnly />;
}
export function SettingsScreen({
  profileOnly = false,
}: { profileOnly?: boolean } = {}) {
  const { profile, setProfile, region, setRegion, notify, logout } =
    useWorkspace();
  const [tab, setTab] = useState("Profile");
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  return (
    <div className="stack" style={css(ui.stack)}>
      {!profileOnly && (
        <Select
          label="Administration section"
          value={tab}
          options={[
            "Profile",
            "Application preferences",
            "Data configuration",
            "Research configuration",
            "User administration",
          ]}
          onChange={setTab}
        />
      )}
      <Card
        title={tab}
        subtitle="Your profile and preferences are saved to your private workspace"
      >
        {tab === "Profile" ? (
          <>
            <Field label="Name" value={name} onChange={setName} />
            <Field
              label="Email"
              value={email}
              onChange={setEmail}
              type="email"
            />
            <Field label="Role" value="Research Analyst" editable={false} />
            <span style={ui.small}>
              This is your display profile. Editing this email does not change
              your sign-in email.
            </span>
            <Button
              label="Save profile"
              onClick={() => {
                if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  notify("Enter a name and a valid email.");
                  return;
                }
                setProfile({ name: name.trim(), email });
                notify("Saving profile…");
              }}
            />
          </>
        ) : tab === "Application preferences" ? (
          <>
            <Select
              label="Default study region"
              value={region}
              options={regions}
              onChange={setRegion}
            />
            <Notice>
              Region preferences save automatically to the backend. The
              interface uses a bright light theme with clear surfaces and
              readable text.
            </Notice>
          </>
        ) : tab === "User administration" ? (
          <>
            {[
              [profile.name, "Research Analyst"],
              ["Maya Santos", "Administrator"],
              ["Lina Chen", "LGU Viewer"],
            ].map(([person, role]) => (
              <div className="stack" key={person} style={css(ui.row)}>
                <div className="stack" style={css({ flex: 1 })}>
                  <span style={css(ui.text)}>{person}</span>
                  <span style={css(ui.small)}>{role}</span>
                </div>
                <Status value="Active" />
              </div>
            ))}
            <Notice>
              Illustrative user directory only. Manage actual accounts in your
              Supabase project's Authentication dashboard.
            </Notice>
          </>
        ) : (
          <>
            <Field
              label="Analysis period"
              value="Jan 2023 – Dec 2024"
              editable={false}
            />
            <Field
              label="Radiance persistence setting"
              value="3 consecutive monthly composites"
              editable={false}
            />
            <Field
              label="Data version"
              value="Synthetic catalog v0.4"
              editable={false}
            />
            <Notice>
              These describe the bundled demonstration dataset. Live processing
              configuration is not connected.
            </Notice>
          </>
        )}
      </Card>
      {profileOnly && (
        <Card title="Account session">
          <span style={ui.muted}>
            Sign out when you finish using this workspace.
          </span>
          <Button
            label="Log out"
            secondary
            icon="log-out-outline"
            onClick={logout}
          />
        </Card>
      )}
    </div>
  );
}
