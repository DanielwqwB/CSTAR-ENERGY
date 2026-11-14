import { useEffect, useState } from "react";
import { EventPicker } from "./InvestigationScreen";
import { Card, Notice, Status } from "../components/ui";
import { api, type CctfAssessment } from "../api";

/** Render the backend CCTF assessment without inventing a mechanism verdict. */
export function AttributionScreen() {
  const [assessment, setAssessment] = useState<CctfAssessment>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<CctfAssessment>("/cctf/assessment")
      .then((data) => active && setAssessment(data))
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "The CCTF request failed.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="cctf-screen">
      <div className="cctf-picker"><span>Selected event</span><EventPicker /></div>
      <Card title="CCTF evidence fingerprint" subtitle="Conservative screening result for the selected event">
        {error ? <p role="alert">CCTF assessment unavailable: {error}</p> : !assessment ? <p role="status">Loading CCTF assessment…</p> : <>
          <div className="cctf-metrics">
            <div className="cctf-metric amber"><span><Status value={assessment.label} /></span><div><small>Assessment state</small><strong>{assessment.status}</strong><em>No confidence score is reported</em></div></div>
            <div className="cctf-metric violet"><span>!</span><div><small>Evidence gate</small><strong>{assessment.gate.eligible ? "Eligible" : "Incomplete"}</strong><em>{assessment.gate.blocking_reasons.length} blocker(s)</em></div></div>
          </div>
          <Notice warning>
            {assessment.pilot_event
              ? `Pilot configured: ${assessment.pilot_event.title} (${assessment.pilot_event.barangay}, ${assessment.pilot_event.municipality}). The engine remains unresolved until the evidence gate is met.`
              : "No pilot event is configured. The engine abstains until event geometry, a treatment window, source evidence, radiance change, and matched wind evidence are supplied."}
          </Notice>
          <div className="cctf-rows">
            {(assessment.evidence ?? []).map((item) => (
              <button className="cctf-row" type="button" aria-expanded={expanded === item.key} key={item.key} onClick={() => setExpanded(expanded === item.key ? null : item.key)}>
                <span className="cctf-row-name">{item.label}</span>
                <span className={`cctf-row-badge ${item.state}`}>{item.state === "available" ? "Available" : item.state === "conflicting" ? "Conflicting" : "Missing"}</span>
                {expanded === item.key && <span className="cctf-row-detail">{item.detail}</span>}
              </button>
            ))}
          </div>
          {(assessment.limitations ?? []).map((limitation) => <span className="cctf-limitation" key={limitation}>• {limitation}</span>)}
        </>}
      </Card>
    </div>
  );
}
