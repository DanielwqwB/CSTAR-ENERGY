export type Page =
  | "profile"
  | "overview"
  | "map"
  | "events"
  | "investigation"
  | "timeline"
  | "plume"
  | "counterfactual"
  | "attribution"
  | "data"
  | "records"
  | "analytics"
  | "alerts"
  | "reports"
  | "settings";
export type EventStatus =
  | "Pending Review"
  | "Under Investigation"
  | "Additional Evidence Required"
  | "Reviewed"
  | "Unresolved";
export interface TransitionEvent {
  id: string;
  shortType: string;
  mechanism: string;
  location: string;
  zone: string;
  onset: string;
  radiance: string;
  atmosphere: string;
  adequacy: string;
  status: EventStatus;
  analyst: string;
  color: string;
  coords: number[];
  summary: string;
  uncertainty: string;
  record: string;
  wind: string;
  verification: string;
  notes?: string;
}
export interface RegistryRecord {
  id: string;
  name: string;
  level: string;
  eventId: string;
}
