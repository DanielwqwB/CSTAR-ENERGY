import { useEffect, useState } from "react";
import { Database, Expand, Layers, MapPin, Moon } from "lucide-react";
import cellSummary from "../data/blackMarbleCellSummary.json";
import evaluation from "../data/blackMarbleRegionalEvaluation.json";
import {
  parseBlackMarbleCellCsv,
  type BlackMarbleCell,
  type BlackMarbleCellCollection,
} from "../data/blackMarble";
import { TransitionMap } from "../components/TransitionMap";

const latestPrediction = evaluation.predictions.at(-1);

export function MapScreen() {
  const [cells, setCells] = useState<BlackMarbleCellCollection>();
  const [cellError, setCellError] = useState("");
  const [selectedCell, setSelectedCell] = useState<BlackMarbleCell>();
  const [predictionMonth, setPredictionMonth] = useState(
    latestPrediction?.month ?? "",
  );
  const [showCells, setShowCells] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/blackmarble_cells_2026-06.csv", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            `Black Marble cell data could not be loaded (HTTP ${response.status}).`,
          );
        return response.text();
      })
      .then((csv) => setCells(parseBlackMarbleCellCsv(csv)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCellError(
          error instanceof Error
            ? error.message
            : "Black Marble cell data could not be loaded.",
        );
      });
    return () => controller.abort();
  }, []);

  const prediction =
    evaluation.predictions.find((item) => item.month === predictionMonth) ??
    latestPrediction;

  return (
    <section
      className={`blackmarble-map-screen${expanded ? " expanded" : ""}`}
      aria-label="Black Marble Bicol radiance map"
    >
      <header className="blackmarble-map-header">
        <span className="blackmarble-map-icon">
          <Moon />
        </span>
        <div>
          <h2>Black Marble · Bicol Region</h2>
          <p>
            Observed nighttime radiance cells with historical regional model
            predictions
          </p>
        </div>
        <label className="blackmarble-cell-toggle">
          <input
            type="checkbox"
            checked={showCells}
            onChange={(event) => setShowCells(event.target.checked)}
          />
          <span>Observed cells</span>
        </label>
        <button
          type="button"
          className="blackmarble-expand"
          aria-label={expanded ? "Exit expanded map" : "Expand map"}
          onClick={() => setExpanded((value) => !value)}
        >
          <Expand size={17} />
        </button>
      </header>

      <div className="blackmarble-map-layout">
        <div className="blackmarble-map-column">
          <TransitionMap
            events={[]}
            onSelect={() => {}}
            cells={false}
            plume={false}
            candidates={false}
            showLegend={false}
            showDetails={false}
            basemapStyle="mapbox://styles/mapbox/dark-v11"
            observedRadianceCells={cells}
            showObservedRadianceCells={showCells}
            onObservedCellSelect={setSelectedCell}
            mapCaption={`BICOL REGION · BLACK MARBLE · ${cellSummary.month}`}
            mapAriaLabel="Observed Black Marble nighttime radiance cells in Bicol Region"
            disclaimerText="Observed quality-screened VNP46A3 cells. Cell colors show measured radiance, not local model predictions."
            height={620}
          />
          <div className="blackmarble-map-legend" aria-label="Radiance legend">
            <span>Lower radiance</span>
            <i />
            <span>Higher radiance</span>
            <small>{cellSummary.units}</small>
          </div>
          <div className="blackmarble-map-meta">
            <span>
              <Database size={15} />
              {cellSummary.mappedCells.toLocaleString()} positive-radiance cells
            </span>
            <span>
              {cellSummary.validCells.toLocaleString()} valid observed cells in
              the source grid
            </span>
            {cellError && (
              <span className="blackmarble-data-error" role="alert">
                {cellError}
              </span>
            )}
          </div>
        </div>

        <aside className="blackmarble-map-sidebar">
          <section className="blackmarble-info-card">
            <header>
              <MapPin size={18} />
              <div>
                <h3>Selected observed cell</h3>
                <p>Click a bright cell on the map to inspect its location.</p>
              </div>
            </header>
            {selectedCell ? (
              <dl className="blackmarble-cell-details">
                <div>
                  <dt>Latitude</dt>
                  <dd>{selectedCell.latitude.toFixed(5)}°</dd>
                </div>
                <div>
                  <dt>Longitude</dt>
                  <dd>{selectedCell.longitude.toFixed(5)}°</dd>
                </div>
                <div>
                  <dt>Observed radiance</dt>
                  <dd>
                    {selectedCell.radiance.toFixed(3)}{" "}
                    <small>{cellSummary.units}</small>
                  </dd>
                </div>
                <div>
                  <dt>Valid observations</dt>
                  <dd>{selectedCell.observationCount.toLocaleString()}</dd>
                </div>
              </dl>
            ) : (
              <p className="blackmarble-empty-cell">
                <Layers size={17} />
                {cells
                  ? "No cell selected."
                  : "Loading observed cell locations…"}
              </p>
            )}
            <p className="blackmarble-source-note">
              {cellSummary.product} · {cellSummary.layer} · {cellSummary.month}
            </p>
          </section>

          <section className="blackmarble-info-card regional-prediction-card">
            <header>
              <span className="regional-prediction-icon">
                <Database size={18} />
              </span>
              <div>
                <h3>Bicol regional model</h3>
                <p>Historical held-out monthly mean predictions</p>
              </div>
            </header>
            <label className="regional-prediction-picker">
              Holdout month
              <select
                value={prediction?.month ?? ""}
                onChange={(event) => setPredictionMonth(event.target.value)}
              >
                {evaluation.predictions.map((item) => (
                  <option key={item.month} value={item.month}>
                    {item.month}
                  </option>
                ))}
              </select>
            </label>
            {prediction && (
              <dl className="blackmarble-cell-details regional-values">
                <div>
                  <dt>Predicted regional mean</dt>
                  <dd>{prediction.predicted.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>Observed regional mean</dt>
                  <dd>{prediction.actual.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>Test MAE</dt>
                  <dd>{evaluation.testMetrics.mae.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>Test MAPE</dt>
                  <dd>{evaluation.testMetrics.mape_percent.toFixed(2)}%</dd>
                </div>
              </dl>
            )}
            <p className="regional-prediction-warning">
              This trained model predicts one Bicol-wide monthly mean. It does
              not predict the selected cell. These are historical test results,
              not a current forecast.
            </p>
          </section>
        </aside>
      </div>
      <p className="blackmarble-map-disclaimer">
        The Bicol boundary is approximated by a bounding box. The regional test
        accuracy was{" "}
        {(evaluation.classificationMetrics.accuracy * 100).toFixed(1)}% across{" "}
        {evaluation.classificationMetrics.tp +
          evaluation.classificationMetrics.tn +
          evaluation.classificationMetrics.fp +
          evaluation.classificationMetrics.fn}{" "}
        held-out month pairs; use these exploratory results cautiously.
      </p>
    </section>
  );
}
