import { css } from "../styles";
import { useViewport } from "../hooks/useViewport";
import React from "react";
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
  const { width } = useViewport();
  const open = (event: TransitionEvent) => {
    select(event.id);
    go("investigation");
  };
  if (!events.length)
    return (
      <div className="stack" style={css({ padding: 28, gap: 10 })}>
        <span style={css(ui.title)}>No matching events</span>
        <span style={css(ui.muted)}>
          Try another search or clear the filters.
        </span>
      </div>
    );
  if (width < 760)
    return (
      <div className="stack" style={css({ gap: 12 })}>
        {events.map((event) => (
          <Card key={event.id}>
            <button
              className="stack"
              type="button"
              role="button"
              onClick={() => open(event)}
              style={css({ gap: 10 })}
            >
              <div
                className="stack"
                style={css([ui.row, { justifyContent: "space-between" }])}
              >
                <span style={css({ color: colors.cyan, fontSize: 12 })}>
                  {event.id}
                </span>
                <Icon name="arrow-forward" />
              </div>
              <span style={css(ui.title)}>{event.location}</span>
              <span style={css(ui.muted)}>{event.mechanism}</span>
              <div className="stack" style={css(ui.wrap)}>
                <Badge>{event.zone}</Badge>
                <Status value={event.adequacy} />
              </div>
              <span style={css(ui.small)}>{event.onset}</span>
            </button>
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
      </div>
    );
  const widths = [100, 190, 220, 120, 110, 210, 50];
  return (
    <div className="stack scroll-area">
      <div className="stack" style={css({ minWidth: 1000 })}>
        <div
          className="stack"
          style={css([
            ui.row,
            {
              paddingBlock: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 8,
            },
          ])}
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
            <span
              key={i}
              style={css([ui.label, { width: widths[i], fontSize: 9 }])}
            >
              {label}
            </span>
          ))}
        </div>
        {events.map((event) => (
          <div
            className="stack"
            key={event.id}
            style={css([
              ui.row,
              {
                gap: 8,
                paddingBlock: 15,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              },
            ])}
          >
            <button
              className="stack"
              type="button"
              onClick={() => open(event)}
              style={css({ width: widths[0] })}
            >
              <span style={css({ color: colors.cyan, fontSize: 11 })}>
                {event.id}
              </span>
            </button>
            <div className="stack" style={css({ width: widths[1] })}>
              <span style={css([ui.text, { fontSize: 11 }])}>
                {event.location}
              </span>
              <span style={css(ui.small)}>{event.zone}</span>
            </div>
            <span style={css([ui.muted, { width: widths[2], fontSize: 11 }])}>
              {event.mechanism}
            </span>
            <span style={css([ui.small, { width: widths[3] }])}>
              {event.onset}
            </span>
            <div className="stack" style={css({ width: widths[4] })}>
              <Status value={event.adequacy} />
            </div>
            <div className="stack" style={css({ width: widths[5] })}>
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
            </div>
            <button
              className="stack"
              type="button"
              role="button"
              aria-label={`Open ${event.id}`}
              onClick={() => open(event)}
              style={css({ padding: 12 })}
            >
              <Icon name="arrow-forward" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
