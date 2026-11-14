import type { TransitionEvent } from "../types";
export const statuses = [
  "Pending Review",
  "Under Investigation",
  "Additional Evidence Required",
  "Reviewed",
  "Unresolved",
] as const;
export function filterEvents(
  events: TransitionEvent[],
  query: string,
  type = "All mechanisms",
  status = "All statuses",
  region = "Aurelia Pilot Locality",
) {
  const text = query.trim().toLowerCase();
  return events.filter(
    (event) =>
      [event.id, event.location, event.zone, event.mechanism]
        .join(" ")
        .toLowerCase()
        .includes(text) &&
      (type === "All mechanisms" || event.shortType === type) &&
      (status === "All statuses" || event.status === status) &&
      (region === "Aurelia Pilot Locality" ||
        (region === "North District Subset"
          ? event.zone.startsWith("NR")
          : event.zone.startsWith("EI"))),
  );
}
export function toCsv(events: TransitionEvent[]) {
  const columns = [
    "id",
    "location",
    "mechanism",
    "onset",
    "adequacy",
    "status",
    "notes",
  ] as const;
  const escape = (value: string) =>
    '"' +
    (/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') +
    '"';
  return [
    columns.join(","),
    ...events.map((event) =>
      columns.map((key) => escape(event[key] || "")).join(","),
    ),
  ].join("\r\n");
}
