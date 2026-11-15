import { useState } from "react";

type ChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
  available: boolean;
  unavailableReason?: string;
};

type ChecklistSection = {
  title: string;
  items: ChecklistItem[];
};

const sections: ChecklistSection[] = [
  {
    title: "Dataset Inputs",
    items: [
      {
        id: "black-marble",
        label: "VIIRS / Black Marble (Nighttime Light)",
        checked: true,
        available: true,
      },
      {
        id: "tropomi",
        label: "Sentinel-5P (NO₂)",
        checked: false,
        available: false,
        unavailableReason: "NO MONTHLY GRID FOR THIS DATE",
      },
      {
        id: "merra",
        label: "MERRA-2 (Regional wind context)",
        checked: false,
        available: false,
        unavailableReason: "NO MONTHLY DATA",
      },
      {
        id: "sentinel",
        label: "Sentinel-2 (Land Use / Land Cover)",
        checked: false,
        available: false,
        unavailableReason: "IMAGERY SOURCE NOT CONFIGURED",
      },
    ],
  },
  {
    title: "Model Analysis",
    items: [
      {
        id: "stgnn",
        label: "ST-GNN · Spatiotemporal change detection",
        checked: false,
        available: false,
      },
      {
        id: "xgboost",
        label: "XGBoost · Transition classification",
        checked: false,
        available: false,
      },
      {
        id: "forest",
        label: "Random Forest · Trained forecast",
        checked: false,
        available: true,
      },
    ],
  },
  {
    title: "CCTF Assessment",
    items: [
      {
        id: "cctf",
        label: "Cross-Coupled Transition Fingerprinting review",
        checked: false,
        available: false,
      },
    ],
  },
];

const initial = Object.fromEntries(
  sections.flatMap((section) =>
    section.items.map((item) => [item.id, item.checked]),
  ),
);

export function AIAnalyticsChecklist({
  activeLayers,
  availableLayers,
  onLayerToggle,
}: {
  activeLayers?: Readonly<Record<string, boolean>>;
  availableLayers?: Readonly<Record<string, boolean>>;
  onLayerToggle?: (id: string, checked: boolean) => void;
}) {
  const [localChecked, setLocalChecked] =
    useState<Record<string, boolean>>(initial);
  const checked = activeLayers ?? localChecked;
  const completed = Object.values(checked).filter(Boolean).length;
  const total = sections.reduce(
    (count, section) => count + section.items.length,
    0,
  );
  const isLayerFilter = activeLayers !== undefined && onLayerToggle !== undefined;

  return (
    <section
      className={`ai-checklist${isLayerFilter ? " ai-checklist-globe" : ""}`}
      aria-label="AI Analytics checklist"
    >
      <header>
        <div>
          <h2>AI Analytics</h2>
          <p>
            {isLayerFilter
              ? "Toggle mapped layers and regional context"
              : "Review data and analysis steps"}
          </p>
        </div>
        <span className="ai-checklist-total" role="status">
          {completed} / {total} checked
        </span>
      </header>
      <div className="ai-checklist-body">
        {sections.map((section, index) => {
          const count = section.items.filter(
            (item) => checked[item.id],
          ).length;
          return (
            <div className="ai-checklist-section" key={section.title}>
              <div className="ai-checklist-section-heading">
                <span className="ai-checklist-number">{index + 1}</span>
                <h3>{section.title}</h3>
                <span className="ai-checklist-count">
                  {count} / {section.items.length} checked
                </span>
              </div>
              <div className="ai-checklist-items">
                {section.items.map((item) => {
                  const available =
                    availableLayers?.[item.id] ?? item.available;
                  return (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={checked[item.id] ?? false}
                        disabled={isLayerFilter && !available}
                        onChange={(event) => {
                          const nextChecked = event.currentTarget.checked;
                          if (isLayerFilter) {
                            onLayerToggle(item.id, nextChecked);
                          } else {
                            setLocalChecked((current) => ({
                              ...current,
                              [item.id]: nextChecked,
                            }));
                          }
                        }}
                      />
                      <span>
                        {item.label}
                        {isLayerFilter && (
                          <small>
                            {available
                              ? item.id === "tropomi"
                                ? "MONTHLY GRID AVAILABLE"
                                : item.id === "merra"
                                  ? "REGIONAL CONTEXT ONLY"
                                  : "AVAILABLE ON GLOBE"
                              : item.unavailableReason ??
                                (item.available
                                  ? "NO ASSET FOR MONTH"
                                  : "NOT LOADED")}
                          </small>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="ai-checklist-note">
        {isLayerFilter
          ? "TROPOMI is a monthly QA-screened 0.1° grid. MERRA-2 shows broad-area wind context, not a local map layer. Sentinel-2 remains disabled until imagery is connected."
          : "Analyst checklist for this demonstration. Checks do not run models or change dataset readiness."}
      </p>
    </section>
  );
}
