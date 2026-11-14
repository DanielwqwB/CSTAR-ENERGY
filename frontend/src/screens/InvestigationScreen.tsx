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
import { TrendChart } from "../components/Charts";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, ui } from "../theme";
import { statuses } from "../utils/events";
import type { EventStatus } from "../types";
export function EventPicker() {
  const { events, selected, select } = useWorkspace();
  return (
    <Select
      label="Selected event"
      value={`${selected.id} · ${selected.location}`}
      options={events.map((e) => `${e.id} · ${e.location}`)}
      onChange={(value) => select(value.split(" · ")[0])}
    />
  );
}
export function InvestigationScreen() {
  const { selected, update, notify, go } = useWorkspace();
  const [notes, setNotes] = useState(selected.notes || "");
  useEffect(
    () => setNotes(selected.notes || ""),
    [selected.id, selected.notes],
  );
  return (
    <div className="stack" style={css(ui.stack)}>
      <EventPicker />
      <Card
        title={selected.location}
        subtitle={`${selected.id} · ${selected.zone} · Onset ${selected.onset}`}
      >
        <div className="stack" style={css(ui.wrap)}>
          <Badge>{selected.shortType} candidate</Badge>
          <Status value={selected.adequacy} />
          <Status value={selected.status} />
        </div>
        <span style={css(ui.text)}>{selected.summary}</span>
        <Select
          label="Review status"
          value={selected.status}
          options={statuses}
          onChange={(status) =>
            update(selected.id, { status: status as EventStatus })
          }
        />
      </Card>
      <Card
        title="Before and after radiance context"
        subtitle="Illustrative monthly composite comparison"
      >
        <TrendChart variant={Number(selected.id.slice(-1)) - 1} />
        <Button
          secondary
          label="Explore evidence timeline"
          onClick={() => go("timeline")}
        />
      </Card>
      <Card
        title="What do we know?"
        subtitle="Observations are separated from interpretation"
      >
        {[
          [
            "Observed evidence",
            `${selected.radiance}. ${selected.atmosphere}.`,
          ],
          ["Possible explanation", selected.mechanism],
          ["Missing evidence", selected.uncertainty],
          ["Recommended verification", selected.verification],
        ].map(([title, content]) => (
          <div
            className="stack"
            key={title}
            style={css({
              gap: 5,
              borderLeftWidth: 2,
              borderLeftColor:
                title === "Missing evidence" ? colors.amber : colors.cyan,
              paddingLeft: 14,
            })}
          >
            <span style={css(ui.label)}>{title.toUpperCase()}</span>
            <span style={css(ui.muted)}>{content}</span>
          </div>
        ))}
      </Card>
      <Card title="Analyst notebook" subtitle="Saved locally on this device">
        <Field
          label="Investigation notes"
          placeholder="Document evidence interpretation, unresolved questions, and follow-up…"
          multiline
          value={notes}
          onChange={setNotes}
          style={css({ minHeight: 140 })}
        />
        <div className="stack" style={css(ui.wrap)}>
          <Button
            label="Save notes"
            icon="save-outline"
            onClick={() => {
              update(selected.id, { notes });
              notify("Analyst notes saved locally.");
            }}
          />
          <Button
            secondary
            label="Request field verification"
            onClick={() => {
              update(selected.id, { status: "Additional Evidence Required" });
              notify("Event flagged for field verification in this demo.");
            }}
          />
        </div>
      </Card>
      <Card title="Linked historical record">
        <span style={css(ui.text)}>{selected.record}</span>
        <span style={css(ui.small)}>
          Demonstration record. Independent source document not supplied.
        </span>
        <Button secondary label="Open registry" onClick={() => go("records")} />
      </Card>
      <Notice warning>
        Nighttime brightness is not electricity consumption. Satellite NO₂ is
        not ground-level concentration. Correlation and wind compatibility do
        not establish causation.
      </Notice>
    </div>
  );
}
