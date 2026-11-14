import { css } from "../styles";
import React, { useState } from "react";
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
import datasets from "../data/datasets.json";
import { colors, ui } from "../theme";
import { exportText } from "../utils/export";
import { toCsv } from "../utils/events";
import { EventPicker } from "./InvestigationScreen";
import { regions } from "./OverviewScreen";
export function DataScreen() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const matches = datasets.filter((row) =>
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
      {matches.map(([name, product, scale, status, description]) => (
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
      {!matches.length && (
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
export function AnalyticsScreen() {
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
