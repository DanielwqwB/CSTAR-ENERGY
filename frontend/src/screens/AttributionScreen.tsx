import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Fingerprint,
  Info,
  Layers,
  MapPin,
  ShieldCheck,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";
import { api, type CctfAssessment, type CctfEvidenceItem } from "../api";
import { EventPicker } from "./InvestigationScreen";

const evidenceIcons = [
  FileText,
  MapPin,
  CalendarDays,
  TrendingUp,
  Zap,
  Wind,
  Layers,
];

function evidenceStrength(state: CctfEvidenceItem["state"]) {
  if (state === "available") return 100;
  if (state === "conflicting") return 55;
  return 8;
}

function evidenceLabel(state: CctfEvidenceItem["state"]) {
  if (state === "available") return "Available";
  if (state === "conflicting") return "Conflicting";
  return "Missing";
}

function evidenceTone(state: CctfEvidenceItem["state"]) {
  if (state === "available") return "supporting";
  if (state === "conflicting") return "inconclusive";
  return "missing";
}

function EvidenceRows({
  rows,
  expanded,
  onToggle,
}: {
  rows: CctfEvidenceItem[];
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="cctf-rows">
      {rows.map((row, index) => {
        const Glyph = evidenceIcons[index % evidenceIcons.length];
        return (
          <button
            type="button"
            className="cctf-row"
            key={row.key}
            aria-expanded={expanded === row.key}
            onClick={() => onToggle(row.key)}
          >
            <span className="cctf-row-icon">
              <Glyph />
            </span>
            <span className="cctf-row-name">{row.label}</span>
            <span className="cctf-row-track" aria-hidden="true">
              <i style={{ width: `${evidenceStrength(row.state)}%` }} />
            </span>
            <span className={`cctf-row-badge ${evidenceTone(row.state)}`}>
              {evidenceLabel(row.state)}
            </span>
            {expanded === row.key && (
              <span className="cctf-row-detail">{row.detail}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <header>
      <span className="cctf-panel-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

/** Backend-backed CCTF view with the collaborator's latest responsive layout. */
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
          setError(
            reason instanceof Error ? reason.message : "The CCTF request failed.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = assessment?.evidence ?? [];
  const supporting = rows.filter((row) => row.state === "available").length;
  const period = assessment?.pilot_event
    ? `${assessment.pilot_event.treatment_window.start ?? "Unknown"} - ${assessment.pilot_event.treatment_window.end ?? "Unknown"}`
    : "Not configured";
  const confidence =
    assessment?.confidence == null
      ? "Unverified"
      : `${Math.round(assessment.confidence * 100)}%`;
  const gateSummary = useMemo(() => {
    if (!assessment) return "Loading evidence gate...";
    return assessment.gate.eligible
      ? "All required inputs are present for the configured screening gate."
      : `${assessment.gate.blocking_reasons.length} required input(s) still block a CCTF assessment.`;
  }, [assessment]);

  if (error)
    return (
      <div className="cctf-screen">
        <div className="cctf-picker">
          <span>Selected event</span>
          <EventPicker />
        </div>
        <p role="alert">CCTF assessment unavailable: {error}</p>
      </div>
    );

  if (!assessment)
    return (
      <div className="cctf-screen">
        <div className="cctf-picker">
          <span>Selected event</span>
          <EventPicker />
        </div>
        <p role="status">Loading CCTF assessment...</p>
      </div>
    );

  return (
    <div className="cctf-screen">
      <div className="cctf-picker">
        <span>Selected event</span>
        <EventPicker />
      </div>

      <div className="cctf-metrics">
        <div className="cctf-metric blue">
          <span>
            <Fingerprint />
          </span>
          <div>
            <small>CCTF Evidence</small>
            <strong>
              {supporting} / {rows.length}
            </strong>
            <em>Available evidence inputs</em>
          </div>
        </div>
        <div className="cctf-metric amber">
          <span>
            <Activity />
          </span>
          <div>
            <small>Assessment State</small>
            <strong>{assessment.status}</strong>
            <em>{assessment.label}</em>
          </div>
        </div>
        <div className="cctf-metric amber">
          <span>
            <CalendarDays />
          </span>
          <div>
            <small>Assessment Period</small>
            <strong>{period}</strong>
            <em>Pilot event window</em>
          </div>
        </div>
        <div className="cctf-metric violet">
          <span>
            <ShieldCheck />
          </span>
          <div>
            <small>Confidence Level</small>
            <strong>{confidence}</strong>
            <em>No causal verdict is reported</em>
          </div>
        </div>
      </div>

      <div className="cctf-main">
        <div className="cctf-column">
          <section className="cctf-panel">
            <PanelHeader
              icon={<Fingerprint />}
              title="CCTF Evidence Fingerprint"
              subtitle="Signal and source readiness for the selected event"
            />
            <EvidenceRows
              rows={rows.slice(0, 3)}
              expanded={expanded}
              onToggle={(key) => setExpanded(expanded === key ? null : key)}
            />
          </section>
          <section className="cctf-panel">
            <PanelHeader
              icon={<ClipboardCheck />}
              title="Additional Evidence Checks"
              subtitle="Multi-source consistency and context validation"
            />
            <EvidenceRows
              rows={rows.slice(3)}
              expanded={expanded}
              onToggle={(key) => setExpanded(expanded === key ? null : key)}
            />
          </section>
        </div>

        <div className="cctf-column">
          <section className="cctf-panel">
            <PanelHeader
              icon={<ShieldCheck />}
              title="Evidence Gate"
              subtitle="Required inputs before a mechanism assessment"
            />
            <div className="cctf-mechanism-body">
              <div className="cctf-context">
                <Info size={18} />
                <span>{gateSummary}</span>
              </div>
              <ul className="cctf-blockers">
                {assessment.gate.blocking_reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {!assessment.gate.blocking_reasons.length && (
                  <li>No blocking inputs reported.</li>
                )}
              </ul>
            </div>
          </section>

          <section className="cctf-panel">
            <PanelHeader
              icon={<Layers />}
              title="Model and Provenance"
              subtitle="Traceable inputs used by this screening view"
            />
            <div className="cctf-mechanism-body">
              <div className="cctf-context">
                <Camera size={18} />
                <span>
                  {assessment.mode}. This screen does not convert evidence into
                  a causal probability.
                </span>
              </div>
              {assessment.provenance && (
                <div className="cctf-provenance">
                  <strong>{assessment.provenance.model_name}</strong>
                  <span>
                    Run {assessment.provenance.atmosphere_run_id} · {assessment.provenance.start_month} to {assessment.provenance.end_month}
                  </span>
                  <span>{assessment.provenance.anomaly_interpretation}</span>
                </div>
              )}
              {!assessment.provenance && (
                <span className="cctf-muted">
                  No published atmospheric run is attached.
                </span>
              )}
            </div>
          </section>

          <section className="cctf-panel cctf-result cctf-result-unresolved">
            <span>
              {assessment.gate.eligible ? <CheckCircle2 /> : <Info />}
            </span>
            <div>
              <h2>
                {assessment.gate.eligible
                  ? "Assessment gate is eligible"
                  : "Assessment remains unresolved"}
              </h2>
              <p>
                {assessment.gate.eligible
                  ? "The required inputs are present for review; this remains a screening result, not a confirmed cause."
                  : "The evidence gate is closed. No lighting, industrial, or emissions mechanism is attributed from the available data."}
              </p>
            </div>
          </section>
        </div>
      </div>

      {assessment.limitations.length > 0 && (
        <div className="cctf-limitations" role="note">
          {assessment.limitations.map((limitation) => (
            <span key={limitation}>• {limitation}</span>
          ))}
        </div>
      )}
    </div>
  );
}
