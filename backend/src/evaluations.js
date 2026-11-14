import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evaluationRoot = resolve(root, "models/evaluation");

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(evaluationRoot, relativePath), "utf8"));
  } catch {
    return null;
  }
}

function splitCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseValue(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function readCsv(relativePath) {
  try {
    const lines = readFileSync(resolve(evaluationRoot, relativePath), "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(splitCsvLine);
    if (!lines.length) return [];
    const headers = lines[0].map((header, index) => header || `column_${index}`);
    return lines.slice(1).map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, parseValue(values[index] ?? "")]),
      ),
    );
  } catch {
    return [];
  }
}

function readMatrix(relativePath) {
  const rows = readCsv(relativePath);
  if (!rows.length) return null;
  const labels = Object.keys(rows[0]).filter((key) => key !== "column_0");
  return {
    labels,
    rows: rows.map((row) => ({
      label: String(row.column_0 ?? ""),
      values: labels.map((label) => row[label]),
    })),
  };
}

export function loadEvaluations() {
  return {
    blackmarble: {
      metrics: readJson("blackmarble/metrics.json"),
      model_comparison: [],
      confusion_matrix: null,
      artifacts: [
        "accuracy.png",
        "accuracy_95_interval.png",
        "balanced_accuracy.png",
        "class_balance.png",
        "confusion_matrix.png",
        "feature_importance.png",
        "radiance_predictions.png",
        "recall.png",
        "roc_auc.png",
        "specificity.png",
      ],
    },
    merra: {
      metrics: readJson("merra/metrics.json"),
      data_quality: readJson("merra/data_quality_report.json"),
      model_comparison: readCsv("merra/model_comparison.csv"),
      confusion_matrix: readMatrix("merra/confusion_matrix.csv"),
      artifacts: [
        "plots/confusion_matrix.png",
        "plots/error_by_month.png",
        "plots/feature_importance.png",
        "plots/predictions_vs_actual.png",
        "plots/residuals.png",
      ],
    },
    tropomi: {
      metrics: readJson("tropomi/metrics.json"),
      data_quality: readJson("tropomi/data_quality_report.json"),
      band_metrics: readJson("tropomi/band_metrics.json"),
      forward_metrics: readJson(
        "tropomi/forward_2026_c9f3615a/forward_metrics.json",
      ),
      model_comparison: readCsv("tropomi/model_comparison.csv"),
      forward_model_comparison: readCsv(
        "tropomi/forward_2026_c9f3615a/model_comparison.csv",
      ),
      band_model_comparison: readCsv("tropomi/band_model_comparison.csv"),
      confusion_matrix: readMatrix("tropomi/confusion_matrix.csv"),
      artifacts: [
        "plots/confusion_matrix.png",
        "plots/error_by_month.png",
        "plots/error_by_valid_count.png",
        "plots/error_by_year.png",
        "plots/mean_anomaly_map.png",
        "plots/predictions_vs_actual.png",
        "plots/residual_histogram.png",
      ],
    },
  };
}
