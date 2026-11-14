import React, { useState } from "react";
import { View } from "react-native";
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
    <View style={ui.stack}>
      <Card>
        <Field
          placeholder="Search event ID, location, zone, or mechanism…"
          value={search}
          onChangeText={setSearch}
        />
        <View style={ui.wrap}>
          <View style={{ flex: 1, minWidth: 180 }}>
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
          </View>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Select
              value={status}
              options={["All statuses", ...statuses]}
              onChange={setStatus}
            />
          </View>
          <Button
            secondary
            label="Reset filters"
            onPress={() => {
              setSearch("");
              setType("All mechanisms");
              setStatus("All statuses");
            }}
          />
          <Button
            label="Export CSV"
            icon="download-outline"
            onPress={() => {
              exportText("cstar-events.csv", toCsv(filtered), "text/csv").catch(
                () =>
                  notify("The export could not be opened. Please try again."),
              );
            }}
          />
        </View>
      </Card>
      <Card
        title="Event review queue"
        subtitle={`${filtered.length} of ${events.length} synthetic candidates`}
      >
        <EventList events={filtered} editable />
      </Card>
    </View>
  );
}
