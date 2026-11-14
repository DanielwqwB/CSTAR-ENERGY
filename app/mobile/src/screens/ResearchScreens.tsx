import React, { useState } from "react";
import { Text, View } from "react-native";
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
    <View style={ui.stack}>
      <Field
        placeholder="Search datasets, instruments, or products…"
        value={search}
        onChangeText={setSearch}
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
          <Text style={ui.text}>{description}</Text>
          <Text style={ui.muted}>{scale}</Text>
          <Button
            secondary
            label={expanded === name ? "Hide provenance" : "View provenance"}
            onPress={() => setExpanded(expanded === name ? "" : name)}
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
        <Text style={ui.muted}>No datasets match this search.</Text>
      )}
      <Card title="Sample processing history">
        <Text style={ui.text}>Synthetic catalog v0.4 prepared</Text>
        <Text style={ui.small}>
          18 Jun 2025 · 14:32 UTC · Demonstration record
        </Text>
        <Badge tone="green">Sample catalog ready</Badge>
      </Card>
    </View>
  );
}
export function RecordsScreen() {
  const { events, selected, records, addRecord, notify } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("Level C — Secondary report");
  const [error, setError] = useState("");
  return (
    <View style={ui.stack}>
      <EventPicker />
      <Card
        title="Intervention registry"
        subtitle="Simulated records are distinguished from verified documentation"
        action={
          <Button
            label={adding ? "Cancel" : "Add record"}
            secondary
            icon="add-outline"
            onPress={() => setAdding(!adding)}
          />
        }
      >
        {adding && (
          <View style={ui.stack}>
            <Field
              label="Record name"
              value={name}
              onChangeText={setName}
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
            {!!error && <Text style={{ color: colors.rose }}>{error}</Text>}
            <Button
              label="Save demonstration record"
              onPress={() => {
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
                notify("Demonstration record saved locally.");
              }}
            />
          </View>
        )}
        {events
          .filter((e) => e.id === selected.id)
          .map((event) => (
            <View key={event.id} style={{ gap: 9 }}>
              <Text style={ui.text}>{event.record}</Text>
              <Text style={ui.small}>
                {event.id} · {event.location}
              </Text>
              <Badge tone="amber">Simulated · not independently verified</Badge>
            </View>
          ))}
        {records
          .filter((r) => r.eventId === selected.id)
          .map((record) => (
            <View
              key={record.id}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 15,
                gap: 8,
              }}
            >
              <Text style={ui.title}>{record.name}</Text>
              <Text style={ui.small}>
                {record.id} · {record.level}
              </Text>
              <Badge tone="amber">User-added demonstration record</Badge>
            </View>
          ))}
      </Card>
      <Notice warning>
        Adding a record does not verify it. Primary source documents, dates, and
        independent checks are still required.
      </Notice>
    </View>
  );
}
export function AnalyticsScreen() {
  return (
    <View style={ui.stack}>
      <Notice warning>
        There are no labeled validation cases or calibrated model results in
        this prototype. Values below describe data readiness, not model
        performance.
      </Notice>
      <View style={ui.wrap}>
        {["Precision", "Recall", "F1 score", "Calibration"].map((label) => (
          <Card key={label} title={label} style={{ flex: 1, minWidth: 150 }}>
            <Text style={{ color: colors.dim, fontSize: 32 }}>—</Text>
            <Badge tone="amber">Not Evaluated</Badge>
          </Card>
        ))}
      </View>
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
          <View key={title} style={{ gap: 6, paddingVertical: 8 }}>
            <Text style={ui.title}>{title}</Text>
            <Text style={ui.muted}>{detail}</Text>
          </View>
        ))}
      </Card>
      <Card
        title="Confusion matrix placeholder"
        subtitle="Awaiting labeled validation cases"
      >
        <View style={ui.wrap}>
          {["Lighting", "Industrial", "Mixed", "Unresolved"].map((label) => (
            <View key={label} style={{ flex: 1, minWidth: 110, gap: 10 }}>
              <Text style={ui.small}>{label}</Text>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={{
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.raised,
                    borderRadius: 6,
                  }}
                >
                  <Text style={ui.small}>Not evaluated</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}
export function AlertsScreen() {
  const { events, select, go } = useWorkspace();
  const alerts = events.filter((e) => e.status !== "Reviewed");
  return (
    <View style={ui.stack}>
      <Card
        title="Active research alerts"
        subtitle={`${alerts.length} alerts derived from stored demonstration events`}
      >
        {!alerts.length && (
          <Text style={ui.muted}>
            All events have been reviewed. No active research alerts.
          </Text>
        )}
        {alerts.map((event) => (
          <View
            key={event.id}
            style={{
              gap: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              paddingBottom: 18,
            }}
          >
            <View style={ui.wrap}>
              <Badge
                tone={event.adequacy === "Insufficient" ? "rose" : "amber"}
              >
                {event.adequacy === "Insufficient"
                  ? "Coverage warning"
                  : "Review required"}
              </Badge>
              <Text style={ui.small}>{event.id}</Text>
            </View>
            <Text style={ui.title}>{event.location}</Text>
            <Text style={ui.muted}>{event.uncertainty}</Text>
            <Status value={event.status} />
            <Button
              secondary
              label="Open event"
              icon="arrow-forward"
              onPress={() => {
                select(event.id);
                go("investigation");
              }}
            />
          </View>
        ))}
      </Card>
    </View>
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
    <View style={ui.stack}>
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
        <Text style={ui.label}>INCLUDED EVIDENCE</Text>
        <View style={ui.wrap}>
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
        </View>
        <View style={ui.wrap}>
          <Button
            label="Export JSON"
            icon="download-outline"
            onPress={() => {
              void download("json");
            }}
          />
          <Button
            secondary
            label="CSV"
            onPress={() => {
              void download("csv");
            }}
          />
          <Button
            secondary
            label="Text report"
            onPress={() => {
              void download("txt");
            }}
          />
        </View>
      </Card>
      <Card title={format} subtitle="CSTAR—ENERGY · Synthetic demonstration">
        <Badge>{selected.id}</Badge>
        <Text style={ui.heading}>{selected.location}</Text>
        <Text style={ui.text}>{selected.summary}</Text>
        {[
          ["WORKING EXPLANATION", selected.mechanism],
          ["OBSERVED EVIDENCE", `${selected.radiance}; ${selected.atmosphere}`],
          ["UNCERTAINTY", selected.uncertainty],
          ["RECOMMENDED VERIFICATION", selected.verification],
          ["ANALYST NOTES", selected.notes || "No analyst notes yet."],
        ].map(([title, text]) => (
          <View key={title} style={{ gap: 6 }}>
            <Text style={[ui.label, { color: colors.cyan }]}>{title}</Text>
            <Text style={ui.muted}>{text}</Text>
          </View>
        ))}
        <Notice warning>{report.disclaimer}</Notice>
      </Card>
    </View>
  );
}
export function SettingsScreen() {
  const { profile, setProfile, region, setRegion, notify } = useWorkspace();
  const [tab, setTab] = useState("Profile");
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  return (
    <View style={ui.stack}>
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
      <Card
        title={tab}
        subtitle="Demonstration controls are stored locally where practical"
      >
        {tab === "Profile" ? (
          <>
            <Field label="Name" value={name} onChangeText={setName} />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field label="Role" value="Research Analyst" editable={false} />
            <Button
              label="Save profile"
              onPress={() => {
                if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  notify("Enter a name and a valid email.");
                  return;
                }
                setProfile({ name: name.trim(), email });
                notify("Demo profile saved locally.");
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
              Region preferences save automatically on this device. The
              interface follows the reference’s dark theme.
            </Notice>
          </>
        ) : tab === "User administration" ? (
          <>
            {[
              [profile.name, "Research Analyst"],
              ["Maya Santos", "Administrator"],
              ["Lina Chen", "LGU Viewer"],
            ].map(([person, role]) => (
              <View key={person} style={ui.row}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>{person}</Text>
                  <Text style={ui.small}>{role}</Text>
                </View>
                <Status value="Active" />
              </View>
            ))}
            <Notice>
              Illustrative user directory only. Account creation and permissions
              require a backend.
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
    </View>
  );
}
