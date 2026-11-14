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
  return (
    <div
      className="event-table-scroll"
      tabIndex={0}
      aria-label="Scrollable event catalogue"
    >
      <table className="event-table">
        <thead>
          <tr>
            {[
              "Event",
              "Location / Zone",
              "Candidate mechanism",
              "Onset",
              "Adequacy",
              "Review status",
              "Open",
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <button
                  type="button"
                  className="event-link"
                  onClick={() => open(event)}
                >
                  {event.id}
                </button>
              </td>
              <td>
                <div className="stack">
                  <span>{event.location}</span>
                  <span style={ui.small}>{event.zone}</span>
                </div>
              </td>
              <td>{event.mechanism}</td>
              <td>{event.onset}</td>
              <td>
                <Status value={event.adequacy} />
              </td>
              <td>
                {editable ? (
                  <Select
                    label={`Review status for ${event.id}`}
                    value={event.status}
                    options={statuses}
                    onChange={(value) =>
                      update(event.id, { status: value as EventStatus })
                    }
                  />
                ) : (
                  <Status value={event.status} />
                )}
              </td>
              <td>
                <button
                  type="button"
                  aria-label={`Open ${event.id}`}
                  className="event-open"
                  onClick={() => open(event)}
                >
                  <Icon name="arrow-forward" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
