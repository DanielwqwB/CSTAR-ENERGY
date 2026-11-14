import { css } from "../styles";
import React, { useState } from "react";
import { Button, Card, Field, Select } from "../components/ui";
import { EventList } from "../components/EventList";
import { useWorkspace } from "../context/WorkspaceContext";
import { filterEvents, statuses, toCsv } from "../utils/events";
import { exportText } from "../utils/export";
import { ui } from "../theme";
export function EventsScreen() {
  const { events, notify } = useWorkspace();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All mechanisms");
  const [status, setStatus] = useState("All statuses");
  const filtered = filterEvents(events, search, type, status);
  return (
    <div className="stack" style={css(ui.stack)}>
      <Card>
        <Field
          placeholder="Search event ID, location, zone, or mechanism…"
          value={search}
          onChange={setSearch}
        />
        <div className="stack" style={css(ui.wrap)}>
          <div className="stack" style={css({ flex: 1, minWidth: 180 })}>
            <Select
              value={type}
              options={[
                "All mechanisms",
                "Lighting",
                "Industrial",
                "Mixed",
                "Unresolved",
              ]}
              onChange={setType}
            />
          </div>
          <div className="stack" style={css({ flex: 1, minWidth: 180 })}>
            <Select
              value={status}
              options={["All statuses", ...statuses]}
              onChange={setStatus}
            />
          </div>
          <Button
            secondary
            label="Reset filters"
            onClick={() => {
              setSearch("");
              setType("All mechanisms");
              setStatus("All statuses");
            }}
          />
          <Button
            label="Export CSV"
            icon="download-outline"
            onClick={() => {
              exportText("cstar-events.csv", toCsv(filtered), "text/csv").catch(
                () =>
                  notify("The export could not be opened. Please try again."),
              );
            }}
          />
        </div>
      </Card>
      <Card
        title="Event review queue"
        subtitle={`${filtered.length} of ${events.length} synthetic candidates`}
      >
        <EventList events={filtered} editable />
      </Card>
    </div>
  );
}
