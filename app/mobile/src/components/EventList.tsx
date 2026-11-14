import React from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { TransitionEvent, EventStatus } from "../types";
import { colors, ui } from "../theme";
import { Badge, Card, Icon, Select, Status } from "./ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { statuses } from "../utils/events";

export function EventList({
  events,
  editable = false,
}: {
  events: TransitionEvent[];
  editable?: boolean;
}) {
  const { select, go, update } = useWorkspace();
  const { width } = useWindowDimensions();
  const open = (event: TransitionEvent) => {
    select(event.id);
    go("investigation");
  };
  if (!events.length)
    return (
      <View style={{ padding: 28, gap: 10 }}>
        <Text style={ui.title}>No matching events</Text>
        <Text style={ui.muted}>Try another search or clear the filters.</Text>
      </View>
    );
  if (width < 760)
    return (
      <View style={{ gap: 12 }}>
        {events.map((event) => (
          <Card key={event.id}>
            <Pressable
              accessibilityRole="button"
              onPress={() => open(event)}
              style={{ gap: 10 }}
            >
              <View style={[ui.row, { justifyContent: "space-between" }]}>
                <Text style={{ color: colors.cyan, fontSize: 12 }}>
                  {event.id}
                </Text>
                <Icon name="arrow-forward" />
              </View>
              <Text style={ui.title}>{event.location}</Text>
              <Text style={ui.muted}>{event.mechanism}</Text>
              <View style={ui.wrap}>
                <Badge>{event.zone}</Badge>
                <Status value={event.adequacy} />
              </View>
              <Text style={ui.small}>{event.onset}</Text>
            </Pressable>
            {editable ? (
              <Select
                label="Review status"
                value={event.status}
                options={statuses}
                onChange={(value) =>
                  update(event.id, { status: value as EventStatus })
                }
              />
            ) : (
              <Status value={event.status} />
            )}
          </Card>
        ))}
      </View>
    );
  const widths = [100, 190, 220, 120, 110, 210, 50];
  return (
    <ScrollView horizontal>
      <View style={{ minWidth: 1000 }}>
        <View
          style={[
            ui.row,
            {
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 8,
            },
          ]}
        >
          {[
            "EVENT",
            "LOCATION / ZONE",
            "CANDIDATE MECHANISM",
            "ONSET",
            "ADEQUACY",
            "REVIEW STATUS",
            "",
          ].map((label, i) => (
            <Text key={i} style={[ui.label, { width: widths[i], fontSize: 9 }]}>
              {label}
            </Text>
          ))}
        </View>
        {events.map((event) => (
          <View
            key={event.id}
            style={[
              ui.row,
              {
                gap: 8,
                paddingVertical: 15,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <Pressable onPress={() => open(event)} style={{ width: widths[0] }}>
              <Text style={{ color: colors.cyan, fontSize: 11 }}>
                {event.id}
              </Text>
            </Pressable>
            <View style={{ width: widths[1] }}>
              <Text style={[ui.text, { fontSize: 11 }]}>{event.location}</Text>
              <Text style={ui.small}>{event.zone}</Text>
            </View>
            <Text style={[ui.muted, { width: widths[2], fontSize: 11 }]}>
              {event.mechanism}
            </Text>
            <Text style={[ui.small, { width: widths[3] }]}>{event.onset}</Text>
            <View style={{ width: widths[4] }}>
              <Status value={event.adequacy} />
            </View>
            <View style={{ width: widths[5] }}>
              {editable ? (
                <Select
                  value={event.status}
                  options={statuses}
                  onChange={(value) =>
                    update(event.id, { status: value as EventStatus })
                  }
                />
              ) : (
                <Status value={event.status} />
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${event.id}`}
              onPress={() => open(event)}
              style={{ padding: 12 }}
            >
              <Icon name="arrow-forward" size={15} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
