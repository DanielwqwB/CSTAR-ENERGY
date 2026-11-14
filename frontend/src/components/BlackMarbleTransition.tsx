import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Expand,
  Map as MapIcon,
  MapPin,
} from "lucide-react";
import {
  loadBlackMarbleForecast,
  loadBlackMarbleManifest,
  loadBlackMarbleMonth,
  type BlackMarbleCell,
  type BlackMarbleCellCollection,
  type BlackMarbleMonthlyManifest,
} from "../data/blackMarble";
import { TransitionMap } from "./TransitionMap";

type DisplayMode = "observed" | "forecast";
type MapSide = "baseline" | "current";

const EMPTY_EVENTS: never[] = [];

function priorMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return value === 1
    ? `${year - 1}-${String(12).padStart(2, "0")}`
    : `${year}-${String(value - 1).padStart(2, "0")}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function BlackMarbleTransition({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [manifest, setManifest] = useState<BlackMarbleMonthlyManifest>();
  const [manifestError, setManifestError] = useState("");
  const [baselineMonth, setBaselineMonth] = useState("");
  const [currentMonth, setCurrentMonth] = useState("");
  const [baselineCells, setBaselineCells] =
    useState<BlackMarbleCellCollection>();
  const [currentObservedCells, setCurrentObservedCells] =
    useState<BlackMarbleCellCollection>();
  const [currentForecastCells, setCurrentForecastCells] =
    useState<BlackMarbleCellCollection>();
  const [previousObservedCells, setPreviousObservedCells] =
    useState<BlackMarbleCellCollection>();
  const [dataError, setDataError] = useState("");
  const [mode, setMode] = useState<DisplayMode>("observed");
  const [selectedCell, setSelectedCell] = useState<BlackMarbleCell>();
  const [selectedSide, setSelectedSide] = useState<MapSide>("current");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeError, setPlaceError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    loadBlackMarbleManifest()
      .then((value) => {
        if (!active) return;
        setManifest(value);
        setBaselineMonth(value.months[0]);
        setCurrentMonth(value.latestObservedMonth);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setManifestError(
          errorText(error, "Black Marble month index could not be loaded."),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!manifest || !baselineMonth || !currentMonth) return;
    let active = true;
    setDataError("");
    Promise.all([
      loadBlackMarbleMonth(baselineMonth),
      manifest.months.includes(currentMonth)
        ? loadBlackMarbleMonth(currentMonth)
        : Promise.resolve(undefined),
    ])
      .then(([baseline, current]) => {
        if (!active) return;
        setBaselineCells(baseline);
        setCurrentObservedCells(current);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDataError(
          errorText(error, "The selected Black Marble grids could not be loaded."),
        );
      });
    return () => {
      active = false;
    };
  }, [manifest, baselineMonth, currentMonth]);

  useEffect(() => {
    if (!manifest || !currentMonth) return;
    let active = true;
    setCurrentForecastCells(undefined);
    if (manifest.forecastMonths.includes(currentMonth)) {
      loadBlackMarbleForecast(currentMonth)
        .then((cells) => {
          if (active) setCurrentForecastCells(cells);
        })
        .catch((error: unknown) => {
          if (active)
            setDataError(
              errorText(error, "The Random Forest forecast could not be loaded."),
            );
        });
    }

    setPreviousObservedCells(undefined);
    const previous = priorMonth(currentMonth);
    if (manifest.months.includes(previous)) {
      loadBlackMarbleMonth(previous)
        .then((cells) => {
          if (active) setPreviousObservedCells(cells);
        })
        .catch((error: unknown) => {
          if (active)
            setDataError(
              errorText(error, "The preceding observed grid could not be loaded."),
            );
        });
    }
    return () => {
      active = false;
    };
  }, [manifest, currentMonth]);

  useEffect(() => {
    if (!selectedCell) {
      setPlaceName("");
      setPlaceError("");
      return;
    }
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      setPlaceName("");
      setPlaceError("Place-name lookup requires a Mapbox access token.");
      return;
    }
    const controller = new AbortController();
    setPlaceName("");
    setPlaceError("");
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${selectedCell.longitude},${selectedCell.latitude}.json`,
    );
    url.searchParams.set("types", "place,locality,neighborhood,district,region");
    url.searchParams.set("limit", "1");
    url.searchParams.set("access_token", token);
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Place lookup failed (HTTP ${response.status}).`);
        return response.json();
      })
      .then((value: { features?: { place_name?: string }[] }) => {
        const label = value.features?.[0]?.place_name;
        if (!label) throw new Error("No mapped place name was returned.");
        setPlaceName(label);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPlaceError(
          errorText(error, "Place name is unavailable; coordinates are shown."),
        );
      });
    return () => controller.abort();
  }, [selectedCell]);

  const availableMonths = useMemo(() => {
    if (!manifest) return [];
    return Array.from(
      new Set([...manifest.months, ...manifest.forecastMonths]),
    ).sort();
  }, [manifest]);
  const currentIsObserved = Boolean(manifest?.months.includes(currentMonth));
  const currentHasForecast = Boolean(
    manifest?.forecastMonths.includes(currentMonth),
  );
  const currentMode =
    !currentIsObserved || (mode === "forecast" && currentHasForecast)
      ? "forecast"
      : "observed";
  const currentCells =
    currentMode === "forecast"
      ? currentForecastCells
      : currentObservedCells;
  const currentModeError =
    currentMode === "forecast" && currentHasForecast && !currentForecastCells;

  const forecastByGridIndex = useMemo(() => {
    const index = new Map<number, BlackMarbleCell>();
    for (const feature of currentForecastCells?.features ?? []) {
      const { gridIndex } = feature.properties;
      if (gridIndex !== undefined) index.set(gridIndex, feature.properties);
    }
    return index;
  }, [currentForecastCells]);
  const selectedForecast =
    selectedCell?.gridIndex === undefined
      ? undefined
      : forecastByGridIndex.get(selectedCell.gridIndex);
  const previousByGridIndex = useMemo(() => {
    const index = new Map<number, BlackMarbleCell>();
    for (const feature of previousObservedCells?.features ?? []) {
      const { gridIndex } = feature.properties;
      if (gridIndex !== undefined) index.set(gridIndex, feature.properties);
    }
    return index;
  }, [previousObservedCells]);
  const previousCell =
    selectedCell?.gridIndex === undefined
      ? undefined
      : previousByGridIndex.get(selectedCell.gridIndex);

  function chooseCell(side: MapSide, month: string) {
    return (cell: BlackMarbleCell | null) => {
      setSelectedSide(side);
      setSelectedMonth(month);
      setSelectedCell(cell ?? undefined);
    };
  }

  function onCurrentMonthChange(month: string) {
    setCurrentMonth(month);
    setMode(
      manifest?.months.includes(month) ? "observed" : "forecast",
    );
    setSelectedCell(undefined);
  }

  const canChooseForecast = currentHasForecast && currentIsObserved;
  const currentDatasetLabel =
    currentMode === "forecast" ? "Random Forest forecast" : "Observed radiance";
  const comparisonError = manifestError || dataError;

  return (
    <section
      className={`radiance-transition${compact ? " compact" : ""}${expanded ? " expanded" : ""}`}
      aria-label="Bicol Black Marble transition comparison"
    >
      <header className="radiance-transition-header">
        <span className="radiance-transition-icon">
          <MapIcon size={19} />
        </span>
        <div>
          <h2>Black Marble transition map</h2>
          <p>
            Quality-screened observed light and cell-level one-month Random
            Forest screening
          </p>
        </div>
        {!compact && (
          <button
            type="button"
            className="radiance-transition-expand"
            aria-label={expanded ? "Exit expanded map" : "Expand map"}
            onClick={() => setExpanded((value) => !value)}
          >
            <Expand size={17} />
          </button>
        )}
      </header>

      <div className="radiance-transition-controls">
        <label>
          Baseline month
          <select
            aria-label="Baseline month"
            value={baselineMonth}
            onChange={(event) => setBaselineMonth(event.target.value)}
            disabled={!manifest}
          >
            {manifest?.months.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <label>
          Current month
          <select
            aria-label="Current month"
            value={currentMonth}
            onChange={(event) => onCurrentMonthChange(event.target.value)}
            disabled={!manifest}
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {month}
                {!manifest?.months.includes(month) ? " · forecast" : ""}
              </option>
            ))}
          </select>
        </label>
        {canChooseForecast && (
          <div className="radiance-transition-modes" aria-label="Current map layer">
            <button
              type="button"
              aria-pressed={currentMode === "observed"}
              onClick={() => setMode("observed")}
            >
              Observed
            </button>
            <button
              type="button"
              aria-pressed={currentMode === "forecast"}
              onClick={() => setMode("forecast")}
            >
              RF forecast
            </button>
          </div>
        )}
      </div>

      {manifest && (
        <div className="radiance-transition-timeline">
          <input
            aria-label="Browse observed and forecast months"
            type="range"
            min="0"
            max={Math.max(availableMonths.length - 1, 0)}
            value={Math.max(availableMonths.indexOf(currentMonth), 0)}
            onChange={(event) =>
              onCurrentMonthChange(
                availableMonths[Number(event.target.value)] ?? currentMonth,
              )
            }
          />
          <span>
            {manifest.months[0]} — {manifest.latestObservedMonth}
          </span>
          <output>{currentMonth}</output>
        </div>
      )}

      {comparisonError && (
        <p className="radiance-transition-error" role="alert">
          {comparisonError}
        </p>
      )}

      <div className="radiance-transition-maps">
        <div className="radiance-transition-map-panel">
          <span className="radiance-transition-map-label">
            OBSERVED · {baselineMonth || "Loading"}
          </span>
          <TransitionMap
            events={EMPTY_EVENTS}
            onSelect={() => {}}
            cells={false}
            plume={false}
            candidates={false}
            showLegend={false}
            showDetails={false}
            basemapStyle="mapbox://styles/mapbox/dark-v11"
            observedRadianceCells={baselineCells}
            showObservedRadianceCells
            onObservedCellSelect={chooseCell("baseline", baselineMonth)}
            mapCaption={`BICOL · OBSERVED · ${baselineMonth}`}
            mapAriaLabel={`Observed Black Marble radiance for ${baselineMonth}`}
            disclaimerText=""
            height={compact ? 350 : 600}
            syncGroup="bicol-radiance-comparison"
          />
        </div>
        <span className="radiance-transition-divider" aria-hidden="true">
          →
        </span>
        <div className="radiance-transition-map-panel">
          <span className="radiance-transition-map-label">
            {currentMode === "forecast" ? "RF FORECAST" : "OBSERVED"} ·{" "}
            {currentMonth || "Loading"}
          </span>
          <TransitionMap
            events={EMPTY_EVENTS}
            onSelect={() => {}}
            cells={false}
            plume={false}
            candidates={false}
            showLegend={false}
            showDetails={false}
            basemapStyle="mapbox://styles/mapbox/dark-v11"
            observedRadianceCells={currentCells}
            showObservedRadianceCells
            onObservedCellSelect={chooseCell("current", currentMonth)}
            mapCaption={`BICOL · ${currentDatasetLabel} · ${currentMonth}`}
            mapAriaLabel={`${currentDatasetLabel} for ${currentMonth}`}
            disclaimerText=""
            height={compact ? 350 : 600}
            syncGroup="bicol-radiance-comparison"
          />
          {currentModeError && !comparisonError && (
            <p className="radiance-transition-loading" role="status">
              Loading {currentDatasetLabel.toLowerCase()}…
            </p>
          )}
        </div>
      </div>

      <div className="radiance-transition-legend">
        <span>Lower measured / predicted radiance</span>
        <i />
        <span>Higher radiance</span>
        <small>{manifest?.units}</small>
      </div>

      {manifest && (
        <section
          className="radiance-transition-validation"
          aria-label="Chronological Random Forest validation"
        >
          <div className="radiance-transition-validation-heading">
            <strong>Spatial Random Forest holdout</strong>
            <span>
              {manifest.metrics.test_samples.toLocaleString()} cell-months ·{" "}
              {manifest.metrics.disclaimer}
            </span>
          </div>
          <div className="radiance-transition-validation-row">
            <label htmlFor="radiance-direction-accuracy">
              Increase-direction accuracy
            </label>
            <progress
              id="radiance-direction-accuracy"
              max="1"
              value={manifest.metrics.direction.accuracy}
            />
            <strong>
              {(manifest.metrics.direction.accuracy * 100).toFixed(1)}%
            </strong>
          </div>
          <div className="radiance-transition-validation-row">
            <label htmlFor="radiance-direction-balanced-accuracy">
              Balanced accuracy
            </label>
            <progress
              id="radiance-direction-balanced-accuracy"
              max="1"
              value={manifest.metrics.direction.balanced_accuracy}
            />
            <strong>
              {(manifest.metrics.direction.balanced_accuracy * 100).toFixed(1)}%
            </strong>
          </div>
          <small>
            Chronological holdout: {manifest.metrics.test_period.start}–
            {manifest.metrics.test_period.end}.{" "}
            {manifest.metrics.direction.accuracy >= 0.75
              ? "Direction accuracy meets "
              : "Direction accuracy is below "}
            the requested 75% target; balanced accuracy accounts for class
            imbalance. Radiance MAE:{" "}
            {manifest.metrics.regression.mae.toFixed(3)}{" "}
            {manifest.units}.
          </small>
        </section>
      )}

      {selectedCell && (
        <aside className="radiance-transition-selection" aria-live="polite">
          <header>
            <MapPin size={17} />
            <div>
              <strong>Selected cell · {placeName || "Resolving place name…"}</strong>
              {placeError && <small>{placeError}</small>}
            </div>
          </header>
          <dl>
            <div>
              <dt>Location</dt>
              <dd>
                {selectedCell.latitude.toFixed(5)}°,{" "}
                {selectedCell.longitude.toFixed(5)}°
              </dd>
            </div>
            <div>
              <dt>Selected layer</dt>
              <dd>
                {selectedSide === "baseline" ? "Observed" : currentDatasetLabel}{" "}
                · {selectedMonth}
              </dd>
            </div>
            <div>
              <dt>
                {selectedCell.isForecast ? "Predicted radiance" : "Observed radiance"}
              </dt>
              <dd>{selectedCell.radiance.toFixed(4)} {manifest?.units}</dd>
            </div>
            {!selectedCell.isForecast && (
              <div>
                <dt>Valid observations</dt>
                <dd>{selectedCell.observationCount.toLocaleString()}</dd>
              </div>
            )}
            {selectedForecast && (
              <>
                <div>
                  <dt>RF forecast · {currentMonth}</dt>
                  <dd>
                    {selectedForecast.radiance.toFixed(4)} {manifest?.units}
                  </dd>
                </div>
                <div>
                  <dt>Model probability of increase</dt>
                  <dd>
                    {((selectedForecast.increaseProbability ?? 0) * 100).toFixed(1)}%
                    <small> · exploratory, not calibrated</small>
                  </dd>
                </div>
              </>
            )}
            {(selectedCell.isForecast || selectedForecast) && previousCell && (
              <div>
                <dt>Change vs previous observed month</dt>
                <dd>
                  {(selectedForecast?.radiance ?? selectedCell.radiance) -
                    previousCell.radiance >=
                  0 ? (
                    <ArrowUpRight size={14} aria-label="increase" />
                  ) : (
                    <ArrowDownRight size={14} aria-label="decrease" />
                  )}
                  {(
                    (selectedForecast?.radiance ?? selectedCell.radiance) -
                    previousCell.radiance
                  ).toFixed(4)}{" "}
                  {manifest?.units}
                </dd>
              </div>
            )}
          </dl>
          {selectedForecast && (
            <p className="radiance-transition-action">
              {selectedForecast.increaseProbability !== undefined &&
              selectedForecast.increaseProbability >= 0.5
                ? "Review this cell against local lighting or construction records and corroborating imagery before taking action."
                : "Continue routine monitoring; verify any decision with independent imagery or local records."}
              {" "}This is a screening prompt, not a causal impact finding.
            </p>
          )}
        </aside>
      )}

      <p className="radiance-transition-note">
        {manifest?.disclaimer ??
          "Observed maps use quality-screened NASA VNP46A3 cells. Forecasts are exploratory and do not establish causal impact."}
        {" "}Map extent uses the available Bicol grid bounds, not an administrative boundary.
      </p>
    </section>
  );
}
