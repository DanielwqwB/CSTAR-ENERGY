import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_EVENT_PATH = resolve(
  PROJECT_ROOT,
  "data/raw/event_records/gubat_benguet_sbdp_2021.json",
);

export function loadPilotEvent(path = DEFAULT_EVENT_PATH) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Conservative CCTF screening result. Missing or incomplete inputs produce abstention.
export function buildCctfAssessment({ atmosphereRun = null, pilotEvent = loadPilotEvent() } = {}) {
  const atmosphereAvailable = Boolean(atmosphereRun);
  const hasSource = Boolean(pilotEvent?.source?.url);
  const hasGeometry = Boolean(pilotEvent?.geometry?.coordinates?.length);
  const hasStart = Boolean(pilotEvent?.treatment_window?.start);
  const hasEnd = Boolean(pilotEvent?.treatment_window?.end);
  return {
    status: "unresolved",
    label: "Insufficient evidence",
    candidate_mechanism: null,
    confidence: null,
    mode: pilotEvent ? "record-assisted satellite screening" : "satellite-led screening",
    pilot_event: pilotEvent,
    gate: {
      eligible: false,
      blocking_reasons: [
        ...(hasSource ? [] : ["official event source record"]),
        ...(hasGeometry ? [] : ["event geometry"]),
        ...(hasStart && hasEnd ? [] : ["complete treatment window"]),
        "event-linked Black Marble change",
        "overpass-matched MERRA-2 wind evidence",
        "eligible counterfactual controls",
      ],
    },
    evidence: [
      { key: "event_record", label: "Pilot event source record", state: hasSource ? "available" : "missing", detail: hasSource ? `${pilotEvent.title} is documented by ${pilotEvent.source.publisher}.` : "No independently documented pilot event source has been supplied." },
      { key: "event_geometry", label: "Event geometry", state: hasGeometry ? "available" : "missing", detail: hasGeometry ? `An approximate ${pilotEvent.geometry.precision.replaceAll("_", " ")} is available; the documented affected path is approximately ${pilotEvent.geometry.affected_path_km} km and is not yet mapped as a road geometry.` : "No event geometry has been supplied." },
      { key: "treatment_window", label: "Treatment window", state: hasStart && hasEnd ? "available" : "missing", detail: hasStart && hasEnd ? `${pilotEvent.treatment_window.start} to ${pilotEvent.treatment_window.end}.` : "Completion is documented, but the construction start date is not confirmed." },
      { key: "radiance_change", label: "Black Marble radiance change", state: "missing", detail: "The available radiance output is not linked to a verified event or event window." },
      { key: "atmospheric_no2", label: "TROPOMI NO2 support", state: atmosphereAvailable ? "available" : "missing", detail: atmosphereAvailable ? `A published ${atmosphereRun.model_name} export is available, labeled ${atmosphereRun.anomaly_interpretation}; it is not event-linked.` : "No published atmospheric export is available." },
      { key: "wind_compatibility", label: "MERRA-2 wind compatibility", state: "missing", detail: "No overpass-matched upwind/downwind comparison or rotated-wind placebo is available for a pilot event." },
      { key: "counterfactual", label: "Matched counterfactual", state: "missing", detail: "No pre-event window and eligible donor controls are available." },
    ],
    limitations: [
      pilotEvent ? "The pilot event is record-assisted, but the evidence gate remains closed." : "This is an abstention state, not a negative finding.",
      "No lighting, industrial, or emissions mechanism can be attributed without a documented event and linked evidence.",
      "The current TROPOMI model produces climatology residuals, not a causal attribution score.",
    ],
    provenance: atmosphereRun ? { atmosphere_run_id: atmosphereRun.run_id, model_name: atmosphereRun.model_name, anomaly_interpretation: atmosphereRun.anomaly_interpretation, start_month: atmosphereRun.start_month, end_month: atmosphereRun.end_month } : null,
  };
}
