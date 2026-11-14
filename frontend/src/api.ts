import type { RegistryRecord, TransitionEvent } from "./types";
export interface WorkspaceData {
  events: TransitionEvent[];
  records: RegistryRecord[];
  region: string;
  profile: { name: string; email: string };
  version: number;
}
export type DatasetRow = [name: string, product: string, scale: string, status: string, description: string];
export interface SeriesPoint {
  month: string;
  radiance: number;
  adjusted: number;
  no2: number;
  counter: number;
}
export type EvaluationScalar = string | number | boolean | null;
export interface EvaluationMatrix {
  labels: string[];
  rows: { label: string; values: EvaluationScalar[] }[];
}
export interface ModelEvaluation {
  metrics: Record<string, unknown> | null;
  data_quality?: Record<string, unknown> | null;
  band_metrics?: Record<string, unknown> | null;
  forward_metrics?: Record<string, unknown> | null;
  model_comparison: Record<string, EvaluationScalar>[];
  forward_model_comparison?: Record<string, EvaluationScalar>[];
  band_model_comparison?: Record<string, EvaluationScalar>[];
  confusion_matrix: EvaluationMatrix | null;
  artifacts: string[];
}
export interface EvaluationBundle {
  blackmarble: ModelEvaluation;
  merra: ModelEvaluation;
  tropomi: ModelEvaluation;
}
export interface AtmosphereManifest {
  run_id: string;
  model_name: string;
  anomaly_interpretation: string;
  start_month: string;
  end_month: string;
  total_cell_months: number;
  published_at: string;
}
export interface AtmosphereCell {
  month: string;
  cell_id: string;
  latitude: number;
  longitude: number;
  observation_status: string;
  qa_mean: number | null;
  valid_orbit_count: number;
  valid_pixel_count: number;
  coverage_fraction: number;
  source_product: string | null;
  expected_no2_umol_m2: number;
  observed_no2_umol_m2: number | null;
  anomaly_umol_m2: number | null;
  interval_lower_umol_m2: number | null;
  interval_upper_umol_m2: number | null;
  significant_anomaly: boolean | null;
}
export interface AtmosphereCellPage {
  run_id: string;
  model_name: string;
  anomaly_interpretation: string;
  month: string;
  limit: number;
  offset: number;
  total: number;
  rows: AtmosphereCell[];
}
export interface CctfEvidenceItem {
  key: string;
  label: string;
  state: "available" | "missing" | "conflicting";
  detail: string;
}
export interface CctfAssessment {
  status: "unresolved" | "mixed" | "candidate";
  label: string;
  candidate_mechanism: string | null;
  confidence: number | null;
  mode: string;
  pilot_event: {
    event_id: string;
    title: string;
    event_type: string;
    municipality: string;
    barangay: string;
    treatment_window: { start: string | null; end: string | null };
    source: { publisher: string; url: string };
  } | null;
  gate: { eligible: boolean; blocking_reasons: string[] };
  evidence: CctfEvidenceItem[];
  limitations: string[];
  provenance: { atmosphere_run_id: string; model_name: string; anomaly_interpretation: string; start_month: string; end_month: string } | null;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Backend unavailable. Start the API server." }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: response.status,
    });
  return data;
}
