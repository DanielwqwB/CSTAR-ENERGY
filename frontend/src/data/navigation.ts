import type { Page } from "../types";
import type { IconName } from "../components/icons";
export type { IconName } from "../components/icons";
export const navigation: {
  group: string;
  items: { id: Page; label: string; icon: IconName }[];
}[] = [
  {
    group: "MONITOR",
    items: [
      { id: "overview", label: "Intelligence Overview", icon: "grid-outline" },
      { id: "map", label: "Transition Map", icon: "map-outline" },
      { id: "events", label: "Event Catalogue", icon: "list-outline" },
    ],
  },
  {
    group: "INVESTIGATE",
    items: [
      {
        id: "investigation",
        label: "Event Investigation",
        icon: "search-outline",
      },
      { id: "timeline", label: "Evidence Timeline", icon: "pulse-outline" },
      { id: "plume", label: "Source–Plume", icon: "navigate-outline" },
      {
        id: "counterfactual",
        label: "Counterfactual",
        icon: "git-compare-outline",
      },
      {
        id: "attribution",
        label: "CCTF Assessment",
        icon: "finger-print-outline",
      },
    ],
  },
  {
    group: "RESEARCH",
    items: [
      { id: "data", label: "Data Explorer", icon: "server-outline" },
      {
        id: "records",
        label: "Intervention Registry",
        icon: "documents-outline",
      },
      {
        id: "analytics",
        label: "Research Analytics",
        icon: "bar-chart-outline",
      },
    ],
  },
  {
    group: "OUTPUTS",
    items: [
      { id: "alerts", label: "Research Alerts", icon: "notifications-outline" },
      {
        id: "reports",
        label: "Reports & Exports",
        icon: "document-text-outline",
      },
      { id: "settings", label: "Administration", icon: "settings-outline" },
    ],
  },
];
export const pageTitles: Record<Page, [string, string]> = {
  overview: [
    "Regional Intelligence Overview",
    "Cross-coupled evidence for the fictional Aurelia pilot locality",
  ],
  map: [
    "Localized Transition Monitoring",
    "Explore fine-scale lighting cells and separate atmospheric footprints",
  ],
  events: [
    "Transition Event Catalogue",
    "Search, triage, and review synthetic transition candidates",
  ],
  investigation: [
    "Event Investigation",
    "Structured multi-sensor research workspace",
  ],
  timeline: [
    "Radiance and Atmospheric Evidence",
    "Aligned historical observations and intervention context",
  ],
  plume: [
    "Atmospheric Source–Plume Screening",
    "Wind-aware interpretation with competing-source safeguards",
  ],
  counterfactual: [
    "Counterfactual Transition Assessment",
    "Observed outcomes versus descriptive comparison trajectories",
  ],
  attribution: [
    "Transition Mechanism Assessment",
    "Cross-Coupled Transition Fingerprinting (CCTF)",
  ],
  data: [
    "Earth Observation Data Explorer",
    "Sample dataset readiness, quality, and provenance",
  ],
  records: [
    "Infrastructure and Industrial Event Records",
    "Independent documentation and verification registry",
  ],
  analytics: [
    "Model Evaluation and Research Analytics",
    "Illustrative framework; no validated performance results",
  ],
  alerts: [
    "Research Alerts",
    "Evidence-driven review signals from stored demonstration events",
  ],
  reports: [
    "Research Reports & Evidence Export",
    "Transparent, reproducible screening outputs",
  ],
  settings: [
    "Administration and Settings",
    "Local demonstration preferences and configuration",
  ],
};
