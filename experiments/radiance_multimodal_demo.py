"""Train a presentation-only multimodal radiance demo and render charts."""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from datetime import date
import gzip
import json
import math
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402
import numpy as np
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:
    from xgboost import XGBClassifier, XGBRegressor
except ImportError:  # Installed through the optional project requirement.
    XGBClassifier = None
    XGBRegressor = None


BICOL_BOUNDS = (122.3, 11.4, 124.7, 14.6)
DISCLAIMER = (
    "PRESENTATION DEMO: missing Black Marble months are simulated. Metrics are "
    "prototype results, not scientific validation or performance claims."
)


def load_radiance(path: Path) -> dict[str, dict[str, float | str]]:
    rows: dict[str, dict[str, float | str]] = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            month = row["date"][:7]
            rows[month] = {
                "radiance": float(row["mean_radiance"]),
                "radiance_source": row["value_source"],
                "radiance_is_synthetic": row["is_synthetic"],
            }
    ordered = sorted(rows)
    for previous, current in zip(ordered, ordered[1:]):
        rows[current]["lag_radiance"] = float(rows[previous]["radiance"])
    return rows


def load_tropomi(path: Path) -> dict[str, dict[str, float]]:
    west, south, east, north = BICOL_BOUNDS
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0] * 6)
    with gzip.open(path, "rt", newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            lon = float(row["longitude"])
            lat = float(row["latitude"])
            if not (west <= lon <= east and south <= lat <= north):
                continue
            month = row["month"]
            weight = max(float(row["valid_pixel_count"]), 1.0)
            values = totals[month]
            values[0] += float(row["tropospheric_no2_mean_mol_m2"]) * weight
            values[1] += float(row["tropospheric_no2_std_mol_m2"]) * weight
            values[2] += float(row["qa_mean"]) * weight
            values[3] += weight
            values[4] += float(row["valid_orbit_count"])
            values[5] += 1.0
    return {
        month: {
            "no2_mean": values[0] / values[3],
            "no2_std": values[1] / values[3],
            "no2_qa": values[2] / values[3],
            "no2_valid_pixels": values[3],
            "no2_mean_orbits": values[4] / values[5],
        }
        for month, values in totals.items()
    }


def load_giovanni(directory: Path) -> dict[str, dict[str, float]]:
    monthly: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(lambda: [0.0, 0.0])
    )
    for path in sorted(directory.glob("*.csv")):
        with path.open(newline="", encoding="utf-8-sig") as stream:
            for _ in range(5):
                next(stream)
            reader = csv.DictReader(stream)
            value_field = next(name for name in reader.fieldnames or [] if name != "time")
            variable = value_field.rsplit("_", 1)[-1].lower()
            for row in reader:
                value_text = row.get(value_field, "")
                if not value_text:
                    continue
                value = float(value_text)
                if abs(value) >= 1e14:
                    continue
                accumulator = monthly[row["time"][:7]][variable]
                accumulator[0] += value
                accumulator[1] += 1
    return {
        month: {
            variable: values[0] / values[1]
            for variable, values in variables.items()
            if values[1]
        }
        for month, variables in monthly.items()
    }


def align_sources(
    radiance: dict[str, dict[str, float | str]],
    tropomi: dict[str, dict[str, float]],
    giovanni: dict[str, dict[str, float]],
) -> list[dict[str, float | int | str]]:
    rows: list[dict[str, float | int | str]] = []
    for month in sorted(set(radiance) & set(tropomi) & set(giovanni)):
        if "lag_radiance" not in radiance[month]:
            continue
        year, month_number = map(int, month.split("-"))
        row: dict[str, float | int | str] = {
            "month": month,
            "year": year,
            "month_number": month_number,
            "month_sin": math.sin(2 * math.pi * (month_number - 1) / 12),
            "month_cos": math.cos(2 * math.pi * (month_number - 1) / 12),
            **radiance[month],
            **tropomi[month],
            **giovanni[month],
        }
        row["radiance_increased"] = int(
            float(row["radiance"]) > float(row["lag_radiance"])
        )
        rows.append(row)
    return rows


def split_rows(rows):
    train = [row for row in rows if int(row["year"]) <= 2022]
    validation = [row for row in rows if int(row["year"]) == 2023]
    test = [row for row in rows if int(row["year"]) >= 2024]
    if min(map(len, (train, validation, test))) == 0:
        raise ValueError("Chronological train, validation, and test splits are required")
    return train, validation, test


def regression_metrics(actual, predicted) -> dict[str, float]:
    nonzero = np.abs(actual) > 1e-8
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "mape_percent": float(
            np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero]))
            * 100
        ),
    }


def classification_metrics(actual, predicted) -> dict[str, float | int]:
    tn, fp, fn, tp = confusion_matrix(actual, predicted, labels=[0, 1]).ravel()
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision": float(precision_score(actual, predicted, zero_division=0)),
        "recall": float(recall_score(actual, predicted, zero_division=0)),
        "specificity": float(specificity),
        "f1": float(f1_score(actual, predicted, zero_division=0)),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }


def _arrays(rows, feature_names):
    x = np.asarray(
        [[float(row[name]) for name in feature_names] for row in rows], dtype=float
    )
    y_regression = np.asarray([float(row["radiance"]) for row in rows], dtype=float)
    y_classification = np.asarray(
        [int(row["radiance_increased"]) for row in rows], dtype=int
    )
    return x, y_regression, y_classification


def _feature_importance(pipeline: Pipeline, feature_names: list[str]) -> list[tuple[str, float]]:
    estimator = pipeline.named_steps["model"]
    if hasattr(estimator, "feature_importances_"):
        values = np.asarray(estimator.feature_importances_, dtype=float)
    else:
        values = np.abs(np.asarray(estimator.coef_, dtype=float).reshape(-1))
    return sorted(zip(feature_names, values, strict=True), key=lambda item: item[1])


def render_charts(
    output: Path,
    test_rows,
    actual_regression,
    predicted_regression,
    classification: dict[str, float | int],
    regression: dict[str, float],
    importance: list[tuple[str, float]],
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    months = [date.fromisoformat(f"{row['month']}-01") for row in test_rows]
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(months, actual_regression, marker="o", label="Demo target")
    ax.plot(months, predicted_regression, marker="s", label="Model prediction")
    ax.set_title("Multimodal Radiance Demo: Test-Period Predictions")
    ax.set_ylabel("Mean radiance")
    ax.grid(alpha=0.25)
    ax.legend()
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=8, color="firebrick")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output / "radiance_predictions.png", dpi=180)
    plt.close(fig)

    matrix = np.asarray(
        [[classification["tn"], classification["fp"]],
         [classification["fn"], classification["tp"]]],
        dtype=int,
    )
    fig, ax = plt.subplots(figsize=(6, 5))
    image = ax.imshow(matrix, cmap="Blues")
    for (row, column), value in np.ndenumerate(matrix):
        ax.text(column, row, str(value), ha="center", va="center", fontsize=16)
    ax.set_xticks([0, 1], ["No increase", "Increase"])
    ax.set_yticks([0, 1], ["No increase", "Increase"])
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Demo target")
    ax.set_title("Radiance Direction Confusion Matrix")
    fig.colorbar(image, ax=ax)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=7, color="firebrick")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output / "confusion_matrix.png", dpi=180)
    plt.close(fig)

    metric_names = ["Accuracy", "Precision", "Recall", "Specificity", "F1", "MAPE"]
    metric_values = [
        classification["accuracy"] * 100,
        classification["precision"] * 100,
        classification["recall"] * 100,
        classification["specificity"] * 100,
        classification["f1"] * 100,
        regression["mape_percent"],
    ]
    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.bar(metric_names, metric_values, color=["#2563eb"] * 5 + ["#f59e0b"])
    ax.bar_label(bars, fmt="%.1f%%", padding=3)
    ax.set_ylim(0, max(105, max(metric_values) * 1.15))
    ax.set_ylabel("Percent")
    ax.set_title("Presentation Demo Metrics")
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=8, color="firebrick")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output / "metrics.png", dpi=180)
    plt.close(fig)

    labels, values = zip(*importance[-12:], strict=True)
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(labels, values, color="#0f766e")
    ax.set_title("Top Multimodal Demo Features")
    ax.set_xlabel("Model importance")
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=8, color="firebrick")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output / "feature_importance.png", dpi=180)
    plt.close(fig)

    fig = plt.figure(figsize=(16, 9), facecolor="#f8fafc")
    canvas = fig.add_axes([0, 0, 1, 1])
    canvas.axis("off")
    fig.text(
        0.06,
        0.91,
        "CSTAR Energy | Multimodal Radiance Prototype",
        fontsize=27,
        weight="bold",
        color="#0f172a",
    )
    fig.text(
        0.06,
        0.865,
        "Black Marble + TROPOMI NO₂ + Giovanni/MERRA-2 | 2019–2025",
        fontsize=15,
        color="#475569",
    )

    cards = [
        ("MAPE", f"{regression['mape_percent']:.2f}%", "Regression error", "#2563eb"),
        ("Accuracy", f"{classification['accuracy'] * 100:.2f}%", "Direction classifier", "#7c3aed"),
        ("F1 score", f"{classification['f1'] * 100:.2f}%", "Positive-class balance", "#0f766e"),
        ("Test months", str(len(test_rows)), "Chronological holdout", "#c2410c"),
    ]
    for index, (label, value, detail, color) in enumerate(cards):
        x = 0.06 + index * 0.225
        patch = FancyBboxPatch(
            (x, 0.66),
            0.195,
            0.14,
            boxstyle="round,pad=0.012,rounding_size=0.015",
            facecolor="white",
            edgecolor="#e2e8f0",
            linewidth=1.5,
            transform=fig.transFigure,
        )
        fig.patches.append(patch)
        fig.text(x + 0.015, 0.755, label, fontsize=12, color="#64748b")
        fig.text(x + 0.015, 0.705, value, fontsize=25, weight="bold", color=color)
        fig.text(x + 0.015, 0.675, detail, fontsize=10, color="#64748b")

    fig.text(0.06, 0.57, "What the prototype demonstrates", fontsize=17, weight="bold")
    fig.text(
        0.075,
        0.50,
        "• A reproducible monthly pipeline aligning satellite radiance,\n"
        "  NO₂, and weather features.\n"
        "• Chronological evaluation prevents random future-to-past leakage.\n"
        "• Regression tracks the presentation radiance curve with low relative error.",
        fontsize=13,
        linespacing=1.6,
        color="#334155",
        va="top",
    )
    fig.text(0.56, 0.57, "How to present the classifier", fontsize=17, weight="bold")
    fig.text(
        0.575,
        0.50,
        f"• Precision: {classification['precision'] * 100:.1f}% | "
        f"Recall: {classification['recall'] * 100:.1f}%\n"
        f"• Specificity: {classification['specificity'] * 100:.1f}% | "
        f"F1: {classification['f1'] * 100:.1f}%\n"
        "• Current limitation: the model over-predicts monthly increases.",
        fontsize=13,
        linespacing=1.6,
        color="#334155",
        va="top",
    )
    warning = FancyBboxPatch(
        (0.06, 0.20),
        0.87,
        0.16,
        boxstyle="round,pad=0.015,rounding_size=0.015",
        facecolor="#fff7ed",
        edgecolor="#fdba74",
        linewidth=1.5,
        transform=fig.transFigure,
    )
    fig.patches.append(warning)
    fig.text(0.08, 0.315, "Presentation scope", fontsize=15, weight="bold", color="#9a3412")
    fig.text(
        0.08,
        0.265,
        "Missing Black Marble months are simulated for this prototype. Use these results to demonstrate the workflow,\n"
        "not as a claim of validated 90% real-world accuracy. The next milestone is complete measured VNP46A3 coverage.",
        fontsize=12.5,
        color="#7c2d12",
        linespacing=1.5,
    )
    fig.text(
        0.06,
        0.08,
        "Recommended message: strong multimodal regression prototype; classification requires real event labels and additional observed radiance.",
        fontsize=12,
        weight="bold",
        color="#0f172a",
    )
    fig.savefig(output / "presentation_summary.png", dpi=180, facecolor=fig.get_facecolor())
    plt.close(fig)


def train(args) -> dict[str, object]:
    rows = align_sources(
        load_radiance(args.radiance),
        load_tropomi(args.tropomi),
        load_giovanni(args.giovanni),
    )
    feature_names = sorted(
        key
        for key in rows[0]
        if key
        not in {
            "month",
            "year",
            "month_number",
            "radiance",
            "radiance_source",
            "radiance_is_synthetic",
            "radiance_increased",
        }
    )
    train_rows, validation_rows, test_rows = split_rows(rows)
    x_train, y_train_reg, y_train_cls = _arrays(train_rows, feature_names)
    x_val, y_val_reg, y_val_cls = _arrays(validation_rows, feature_names)
    x_test, y_test_reg, y_test_cls = _arrays(test_rows, feature_names)

    regression_candidates = {
        "ridge": Ridge(alpha=1.0),
        "random_forest": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=46
        ),
        "gradient_boosting": GradientBoostingRegressor(random_state=46),
    }
    if XGBRegressor is not None:
        regression_candidates["xgboost"] = XGBRegressor(
            n_estimators=300,
            max_depth=3,
            learning_rate=0.03,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=2.0,
            objective="reg:squarederror",
            random_state=46,
            n_jobs=4,
        )
    regression_models = {}
    for name, estimator in regression_candidates.items():
        pipeline = Pipeline([("scale", StandardScaler()), ("model", estimator)])
        pipeline.fit(x_train, y_train_reg)
        regression_models[name] = (
            pipeline,
            float(mean_absolute_error(y_val_reg, pipeline.predict(x_val))),
        )
    regression_name, (regression_model, validation_mae) = min(
        regression_models.items(), key=lambda item: item[1][1]
    )

    classification_candidates = {
        "logistic": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "random_forest": RandomForestClassifier(
            n_estimators=300, min_samples_leaf=2, class_weight="balanced", random_state=46
        ),
        "gradient_boosting": GradientBoostingClassifier(random_state=46),
    }
    if XGBClassifier is not None:
        negative_count = max(int(np.sum(y_train_cls == 0)), 1)
        positive_count = max(int(np.sum(y_train_cls == 1)), 1)
        classification_candidates["xgboost"] = XGBClassifier(
            n_estimators=300,
            max_depth=3,
            learning_rate=0.03,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=2.0,
            scale_pos_weight=negative_count / positive_count,
            eval_metric="logloss",
            random_state=46,
            n_jobs=4,
        )
    classification_models = {}
    for name, estimator in classification_candidates.items():
        pipeline = Pipeline([("scale", StandardScaler()), ("model", estimator)])
        pipeline.fit(x_train, y_train_cls)
        validation_probability = pipeline.predict_proba(x_val)[:, 1]
        thresholds = np.linspace(0.2, 0.8, 25)
        threshold_results = []
        for threshold in thresholds:
            validation_prediction = (validation_probability >= threshold).astype(int)
            threshold_results.append(
                (
                    float(balanced_accuracy_score(y_val_cls, validation_prediction)),
                    float(f1_score(y_val_cls, validation_prediction, zero_division=0)),
                    float(threshold),
                )
            )
        validation_balanced_accuracy, validation_f1, threshold = max(
            threshold_results, key=lambda item: (item[0], item[1])
        )
        classification_models[name] = (
            pipeline,
            validation_balanced_accuracy,
            validation_f1,
            threshold,
        )
    classification_name, (
        classification_model,
        validation_balanced_accuracy,
        validation_f1,
        classification_threshold,
    ) = max(
        classification_models.items(), key=lambda item: (item[1][1], item[1][2])
    )

    regression_prediction = regression_model.predict(x_test)
    classification_prediction = (
        classification_model.predict_proba(x_test)[:, 1] >= classification_threshold
    ).astype(int)
    regression = regression_metrics(y_test_reg, regression_prediction)
    classification = classification_metrics(y_test_cls, classification_prediction)
    importance = _feature_importance(classification_model, feature_names)

    args.output.mkdir(parents=True, exist_ok=True)
    joblib.dump(regression_model, args.output / "regression_model.joblib")
    joblib.dump(classification_model, args.output / "classification_model.joblib")
    with (args.output / "aligned_dataset.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (args.output / "test_predictions.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(
            ["month", "actual_radiance", "predicted_radiance", "actual_increase", "predicted_increase"]
        )
        for row, actual_reg, predicted_reg, actual_cls, predicted_cls in zip(
            test_rows,
            y_test_reg,
            regression_prediction,
            y_test_cls,
            classification_prediction,
            strict=True,
        ):
            writer.writerow([row["month"], actual_reg, predicted_reg, actual_cls, predicted_cls])

    results: dict[str, object] = {
        "disclaimer": DISCLAIMER,
        "task": {
            "regression": "predict monthly demo mean radiance",
            "classification": "predict whether demo radiance increased month over month",
        },
        "sources": {
            "black_marble": "15 observed months plus labelled simulated missing months",
            "tropomi": "Bicol-cropped monthly NO2 grid aggregates",
            "giovanni": "monthly aggregates of Philippines-area MERRA-2 hourly means",
        },
        "period": {"start": rows[0]["month"], "end": rows[-1]["month"]},
        "split_counts": {
            "train": len(train_rows),
            "validation": len(validation_rows),
            "test": len(test_rows),
        },
        "selected_models": {
            "regression": regression_name,
            "classification": classification_name,
            "classification_threshold": classification_threshold,
            "xgboost_available": XGBClassifier is not None,
        },
        "validation": {
            "mae": validation_mae,
            "balanced_accuracy": validation_balanced_accuracy,
            "f1": validation_f1,
        },
        "regression_test_metrics": regression,
        "classification_test_metrics": classification,
        "feature_names": feature_names,
    }
    (args.output / "metrics.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )
    (args.output / "PRESENTATION_NOTES.md").write_text(
        "# CSTAR Energy multimodal prototype\n\n"
        "## Suggested presentation message\n\n"
        "This prototype aligns Black Marble nighttime radiance, Bicol-cropped "
        "TROPOMI NO2, and Giovanni/MERRA-2 weather features on a monthly timeline. "
        f"The regression test MAPE is **{regression['mape_percent']:.2f}%**, with "
        f"MAE **{regression['mae']:.4f}** and RMSE **{regression['rmse']:.4f}**.\n\n"
        "## Classification results\n\n"
        f"- Accuracy: **{classification['accuracy'] * 100:.2f}%**\n"
        f"- Precision: **{classification['precision'] * 100:.2f}%**\n"
        f"- Recall: **{classification['recall'] * 100:.2f}%**\n"
        f"- Specificity: **{classification['specificity'] * 100:.2f}%**\n"
        f"- F1 score: **{classification['f1'] * 100:.2f}%**\n\n"
        "The classifier currently over-predicts increases, so classification is "
        "presented as work in progress. Missing Black Marble months are simulated "
        "for the presentation and must not be described as measured NASA data or "
        "validated real-world performance.\n",
        encoding="utf-8",
    )
    render_charts(
        args.output,
        test_rows,
        y_test_reg,
        regression_prediction,
        classification,
        regression,
        importance,
    )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--radiance",
        type=Path,
        default=Path("data/processed/radiance/radiance_demo_monthly_2016_2026.csv"),
    )
    parser.add_argument(
        "--tropomi",
        type=Path,
        default=Path("TROPOMI NO₂/tropomi_no2_2019-01-01_2025-12-31.csv.gz"),
    )
    parser.add_argument("--giovanni", type=Path, default=Path("Giovani"))
    parser.add_argument(
        "--output", type=Path, default=Path("artifacts/radiance_multimodal_demo")
    )
    args = parser.parse_args()
    print(json.dumps(train(args), indent=2))


if __name__ == "__main__":
    main()
