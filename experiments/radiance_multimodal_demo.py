"""Train and evaluate a real-observation multimodal radiance prototype."""

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
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
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
    "Observed data only; small, irregular sample; exploratory, not validation."
)


def load_radiance(path: Path) -> dict[str, dict[str, float | str]]:
    rows: dict[str, dict[str, float | str]] = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            if (
                row.get("is_synthetic", "").strip().lower() == "true"
                or row.get("presentation_only", "").strip().lower() == "true"
                or row.get("value_source", "").strip().lower() == "synthetic_demo"
            ):
                continue
            value = row.get("mean_radiance", "").strip()
            if not value:
                continue
            month = row["date"][:7]
            if month in rows:
                raise ValueError(f"Multiple Black Marble observations found for {month}")
            radiance = float(value)
            if not math.isfinite(radiance) or radiance < 0:
                continue
            rows[month] = {
                "radiance": radiance,
                "radiance_source": row.get("value_source", "observed_vnp46a3"),
                "radiance_is_synthetic": "false",
            }
    if not rows:
        raise ValueError(f"No observed Black Marble radiance rows found in {path}")
    ordered = sorted(rows)
    for previous, current in zip(ordered, ordered[1:]):
        rows[current]["lag_radiance"] = float(rows[previous]["radiance"])
        previous_year, previous_month = map(int, previous.split("-"))
        current_year, current_month = map(int, current.split("-"))
        rows[current]["lag_gap_months"] = (
            (current_year - previous_year) * 12 + current_month - previous_month
        )
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


def observed_monthly_pairs(rows):
    """Keep only targets whose preceding Black Marble month was observed."""

    return [row for row in rows if int(row.get("lag_gap_months", 0)) == 1]


def holdout_rows(rows, *, test_start_year: int = 2024):
    development = [row for row in rows if int(row["year"]) < test_start_year]
    test = [row for row in rows if int(row["year"]) >= test_start_year]
    if not development or not test:
        raise ValueError("Chronological development and test periods are required")
    return development, test


def expanding_year_splits(rows, *, minimum_train: int = 8):
    """Yield past-to-future tuning folds without random temporal leakage."""

    years = sorted({int(row["year"]) for row in rows})
    for validation_year in years[1:]:
        train = [row for row in rows if int(row["year"]) < validation_year]
        validation = [row for row in rows if int(row["year"]) == validation_year]
        if len(train) >= minimum_train and validation:
            yield validation_year, train, validation


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


def classification_metrics(
    actual, predicted, probability=None
) -> dict[str, float | int]:
    tn, fp, fn, tp = confusion_matrix(actual, predicted, labels=[0, 1]).ravel()
    specificity = tn / (tn + fp) if tn + fp else 0.0
    metrics: dict[str, float | int] = {
        "accuracy": float(accuracy_score(actual, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, predicted)),
        "precision": float(precision_score(actual, predicted, zero_division=0)),
        "recall": float(recall_score(actual, predicted, zero_division=0)),
        "specificity": float(specificity),
        "f1": float(f1_score(actual, predicted, zero_division=0)),
        "matthews_correlation": float(matthews_corrcoef(actual, predicted)),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }
    if probability is not None:
        metrics["brier_score"] = float(brier_score_loss(actual, probability))
    return metrics


def wilson_interval(successes: int, total: int, *, z: float = 1.96) -> list[float]:
    if total <= 0:
        return [0.0, 0.0]
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt(
            proportion * (1 - proportion) / total + z * z / (4 * total * total)
        )
        / denominator
    )
    return [float(max(0.0, center - margin)), float(min(1.0, center + margin))]


def bootstrap_auc_interval(
    actual, probability, *, iterations: int = 2000, seed: int = 46
) -> list[float] | None:
    if np.unique(actual).size != 2:
        return None
    generator = np.random.default_rng(seed)
    scores = []
    for _ in range(iterations):
        indices = generator.integers(0, len(actual), len(actual))
        sampled_actual = actual[indices]
        if np.unique(sampled_actual).size != 2:
            continue
        scores.append(roc_auc_score(sampled_actual, probability[indices]))
    if not scores:
        return None
    lower, upper = np.percentile(scores, [2.5, 97.5])
    return [float(lower), float(upper)]


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


def build_regression_candidates() -> dict[str, list[object]]:
    candidates: dict[str, list[object]] = {
        "ridge": [
            Ridge(alpha=0.05),
            Ridge(alpha=0.5),
            Ridge(alpha=1.0),
            Ridge(alpha=5.0),
        ],
        "random_forest": [
            RandomForestRegressor(
                n_estimators=200,
                max_depth=None,
                min_samples_leaf=1,
                random_state=46,
            ),
            RandomForestRegressor(
                n_estimators=400,
                max_depth=8,
                min_samples_leaf=2,
                random_state=46,
            ),
        ],
        "gradient_boosting": [
            GradientBoostingRegressor(random_state=46),
            GradientBoostingRegressor(
                n_estimators=400,
                learning_rate=0.05,
                max_depth=3,
                random_state=46,
            ),
        ],
    }
    if XGBRegressor is not None:
        candidates["xgboost"] = [
            XGBRegressor(
                n_estimators=250,
                max_depth=3,
                learning_rate=0.03,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_lambda=2.0,
                objective="reg:squarederror",
                random_state=46,
                n_jobs=4,
            ),
            XGBRegressor(
                n_estimators=500,
                max_depth=2,
                learning_rate=0.05,
                subsample=0.9,
                colsample_bytree=0.9,
                reg_lambda=1.0,
                objective="reg:squarederror",
                random_state=46,
                n_jobs=4,
            ),
        ]
    return candidates


def build_classification_candidates(class_balance: float | None = None) -> dict[str, list[object]]:
    candidates: dict[str, list[object]] = {
        "logistic": [
            LogisticRegression(max_iter=4000, class_weight="balanced", C=0.25),
            LogisticRegression(max_iter=4000, class_weight="balanced", C=1.0),
            LogisticRegression(max_iter=4000, class_weight="balanced", C=4.0),
        ],
        "random_forest": [
            RandomForestClassifier(
                n_estimators=200,
                min_samples_leaf=1,
                class_weight="balanced",
                random_state=46,
            ),
            RandomForestClassifier(
                n_estimators=400,
                min_samples_leaf=2,
                class_weight="balanced",
                random_state=46,
            ),
        ],
        "gradient_boosting": [
            GradientBoostingClassifier(random_state=46),
            GradientBoostingClassifier(
                n_estimators=400,
                learning_rate=0.05,
                max_depth=3,
                random_state=46,
            ),
        ],
    }
    if XGBClassifier is not None:
        xgb_scale = class_balance if class_balance is not None else 1.0
        candidates["xgboost"] = [
            XGBClassifier(
                n_estimators=250,
                max_depth=3,
                learning_rate=0.03,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_lambda=2.0,
                scale_pos_weight=xgb_scale,
                eval_metric="logloss",
                random_state=46,
                n_jobs=4,
            ),
            XGBClassifier(
                n_estimators=500,
                max_depth=2,
                learning_rate=0.05,
                subsample=0.9,
                colsample_bytree=0.9,
                reg_lambda=1.0,
                scale_pos_weight=xgb_scale,
                eval_metric="logloss",
                random_state=46,
                n_jobs=4,
            ),
        ]
    return candidates


def tune_regression_model(candidates, rows, feature_names):
    """Select a regressor using expanding-year out-of-fold MAE."""

    evaluated = []
    for name, estimators in candidates.items():
        for candidate_index, estimator in enumerate(estimators, start=1):
            actual_parts = []
            prediction_parts = []
            fold_years = []
            for year, train_rows, validation_rows in expanding_year_splits(rows):
                x_train, y_train, _ = _arrays(train_rows, feature_names)
                x_validation, y_validation, _ = _arrays(
                    validation_rows, feature_names
                )
                pipeline = Pipeline(
                    [("scale", StandardScaler()), ("model", clone(estimator))]
                )
                pipeline.fit(x_train, y_train)
                actual_parts.extend(y_validation)
                prediction_parts.extend(pipeline.predict(x_validation))
                fold_years.append(year)
            if not actual_parts:
                continue
            score = float(mean_absolute_error(actual_parts, prediction_parts))
            evaluated.append(
                (
                    score,
                    name,
                    candidate_index,
                    estimator,
                    sorted(set(fold_years)),
                    len(actual_parts),
                )
            )
    if not evaluated:
        raise ValueError("Not enough observations for expanding-window regression tuning")
    score, name, candidate_index, estimator, fold_years, tuned_observations = min(
        evaluated, key=lambda item: (item[0], item[1], item[2])
    )
    x_development, y_development, _ = _arrays(rows, feature_names)
    model = Pipeline(
        [("scale", StandardScaler()), ("model", clone(estimator))]
    )
    model.fit(x_development, y_development)
    return model, name, score, fold_years, tuned_observations


def tune_classification_model(candidates, rows, feature_names):
    """Select a classifier from expanding-year predictions at a fixed threshold."""

    evaluated = []
    for name, estimators in candidates.items():
        for candidate_index, estimator in enumerate(estimators, start=1):
            actual_parts = []
            probability_parts = []
            fold_years = []
            for year, train_rows, validation_rows in expanding_year_splits(rows):
                x_train, _, y_train = _arrays(train_rows, feature_names)
                if np.unique(y_train).size != 2:
                    continue
                x_validation, _, y_validation = _arrays(
                    validation_rows, feature_names
                )
                pipeline = Pipeline(
                    [("scale", StandardScaler()), ("model", clone(estimator))]
                )
                pipeline.fit(x_train, y_train)
                actual_parts.extend(y_validation)
                probability_parts.extend(pipeline.predict_proba(x_validation)[:, 1])
                fold_years.append(year)
            actual = np.asarray(actual_parts, dtype=int)
            probability = np.asarray(probability_parts, dtype=float)
            if not actual.size or np.unique(actual).size != 2:
                continue
            auc = float(roc_auc_score(actual, probability))
            threshold = 0.5
            predicted = (probability >= threshold).astype(int)
            tn, fp, fn, tp = confusion_matrix(
                actual, predicted, labels=[0, 1]
            ).ravel()
            sensitivity = tp / (tp + fn) if tp + fn else 0.0
            specificity = tn / (tn + fp) if tn + fp else 0.0
            balanced = float(balanced_accuracy_score(actual, predicted))
            minimum_class_recall = float(min(sensitivity, specificity))
            f1 = float(f1_score(actual, predicted, zero_division=0))
            accuracy = float(accuracy_score(actual, predicted))
            evaluated.append(
                (
                    balanced,
                    minimum_class_recall,
                    accuracy,
                    auc,
                    f1,
                    threshold,
                    name,
                    candidate_index,
                    estimator,
                    sorted(set(fold_years)),
                    len(actual),
                )
            )
    if not evaluated:
        raise ValueError("Not enough monthly pairs for classification tuning")
    (
        balanced,
        minimum_class_recall,
        accuracy,
        auc,
        f1,
        threshold,
        name,
        candidate_index,
        estimator,
        fold_years,
        tuned_observations,
    ) = max(
        evaluated,
        key=lambda item: (
            item[0],
            item[1],
            item[2],
            item[3],
            item[6],
            -item[7],
        ),
    )
    x_development, _, y_development = _arrays(rows, feature_names)
    model = Pipeline(
        [("scale", StandardScaler()), ("model", clone(estimator))]
    )
    model.fit(x_development, y_development)
    return (
        model,
        name,
        threshold,
        balanced,
        minimum_class_recall,
        accuracy,
        auc,
        f1,
        fold_years,
        tuned_observations,
    )


def render_charts(
    output: Path,
    regression_test_rows,
    classification_test_rows,
    actual_regression,
    predicted_regression,
    actual_classification,
    predicted_probability,
    classification: dict[str, float | int],
    regression: dict[str, float],
    roc_auc: float | None,
    importance: list[tuple[str, float]],
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    classifier_total = int(
        classification["tn"]
        + classification["fp"]
        + classification["fn"]
        + classification["tp"]
    )
    chart_accuracy_interval = wilson_interval(
        int(classification["tn"] + classification["tp"]), classifier_total
    )
    months = [
        date.fromisoformat(f"{row['month']}-01") for row in regression_test_rows
    ]
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(months, actual_regression, marker="o", label="Observed target")
    ax.plot(months, predicted_regression, marker="s", label="Model prediction")
    ax.set_title("Observed Multimodal Radiance: Test-Period Predictions")
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
    ax.set_ylabel("Observed target")
    ax.set_title("Observed Radiance Direction Confusion Matrix")
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
    ax.set_title("Observed-Data Model Metrics")
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=8, color="firebrick")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output / "metrics.png", dpi=180)
    plt.close(fig)

    metric_charts = [
        ("mape.png", "MAPE", regression["mape_percent"], "Percent", "#f59e0b"),
        ("f1.png", "F1 score", classification["f1"] * 100, "Percent", "#0f766e"),
        ("accuracy.png", "Accuracy", classification["accuracy"] * 100, "Percent", "#2563eb"),
        (
            "balanced_accuracy.png",
            "Balanced accuracy",
            classification["balanced_accuracy"] * 100,
            "Percent",
            "#0369a1",
        ),
        ("precision.png", "Precision", classification["precision"] * 100, "Percent", "#7c3aed"),
        ("recall.png", "Recall", classification["recall"] * 100, "Percent", "#be123c"),
        (
            "specificity.png",
            "Specificity",
            classification["specificity"] * 100,
            "Percent",
            "#047857",
        ),
        ("mae.png", "Mean absolute error", regression["mae"], "Radiance units", "#c2410c"),
    ]
    if roc_auc is not None:
        metric_charts.append(
            ("roc_auc_score.png", "ROC AUC", roc_auc * 100, "Percent", "#4338ca")
        )
    for filename, title, value, units, color in metric_charts:
        fig, ax = plt.subplots(figsize=(6, 4))
        bars = ax.bar(["Test set"], [value], color=color, width=0.55)
        ax.bar_label(bars, fmt="%.3f" if units == "Radiance units" else "%.2f%%", padding=4)
        minimum_range = 0.001 if units == "Radiance units" else 1.0
        upper_range = max(value * 1.2, minimum_range)
        if filename == "accuracy.png":
            upper_range = max(upper_range, 80)
            ax.axhline(75, color="#dc2626", linestyle="--", label="75% target")
            ax.legend()
        ax.set_ylim(0, upper_range)
        ax.set_ylabel(units)
        ax.set_title(f"Test {title}")
        ax.grid(axis="y", alpha=0.2)
        fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=7, color="firebrick")
        fig.tight_layout(rect=(0, 0.05, 1, 1))
        fig.savefig(output / filename, dpi=180)
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4))
    class_recall = [
        classification["specificity"] * 100,
        classification["recall"] * 100,
    ]
    bars = ax.bar(
        ["No increase", "Increase"],
        class_recall,
        color=["#2563eb", "#0f766e"],
    )
    ax.bar_label(bars, fmt="%.1f%%", padding=4)
    ax.axhline(75, color="#dc2626", linestyle="--", label="75% per-class target")
    ax.set_ylim(0, 100)
    ax.set_ylabel("Recall")
    ax.set_title("Test Recall by Class")
    ax.legend()
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=7, color="firebrick")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(output / "class_balance.png", dpi=180)
    plt.close(fig)

    accuracy_percent = classification["accuracy"] * 100
    interval_low = chart_accuracy_interval[0] * 100
    interval_high = chart_accuracy_interval[1] * 100
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.errorbar(
        ["Accuracy"],
        [accuracy_percent],
        yerr=[
            [accuracy_percent - interval_low],
            [interval_high - accuracy_percent],
        ],
        fmt="o",
        markersize=10,
        capsize=10,
        linewidth=2,
        color="#2563eb",
    )
    ax.set_ylim(0, 100)
    ax.set_ylabel("Percent")
    ax.set_title("Test Accuracy with 95% Wilson Interval")
    ax.text(
        0,
        interval_high + 3,
        f"{accuracy_percent:.2f}% ({interval_low:.1f}%–{interval_high:.1f}%)",
        ha="center",
        fontsize=11,
    )
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=7, color="firebrick")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(output / "accuracy_95_interval.png", dpi=180)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 5))
    if roc_auc is None:
        ax.text(
            0.5,
            0.5,
            "ROC AUC unavailable: the test set contains only one class.",
            ha="center",
            va="center",
            wrap=True,
        )
    else:
        false_positive_rate, true_positive_rate, _ = roc_curve(
            actual_classification, predicted_probability
        )
        ax.plot(
            false_positive_rate,
            true_positive_rate,
            label=f"ROC curve (AUC = {roc_auc:.3f})",
            color="#2563eb",
            linewidth=2,
        )
        ax.plot([0, 1], [0, 1], linestyle="--", color="#64748b", label="Chance")
        ax.legend(loc="lower right")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("Test ROC Curve")
    ax.grid(alpha=0.2)
    fig.text(0.5, 0.01, DISCLAIMER, ha="center", fontsize=7, color="firebrick")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(output / "roc_auc.png", dpi=180)
    plt.close(fig)

    labels, values = zip(*importance[-12:], strict=True)
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(labels, values, color="#0f766e")
    ax.set_title("Top Observed-Data Model Features")
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
        "CSTAR Energy | Observed Multimodal Radiance",
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
        (
            "Test pairs",
            str(len(classification_test_rows)),
            "Consecutive-month holdout",
            "#c2410c",
        ),
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

    fig.text(0.06, 0.57, "What this prototype demonstrates", fontsize=17, weight="bold")
    fig.text(
        0.075,
        0.50,
        "• A reproducible monthly pipeline aligning satellite radiance,\n"
        "  NO₂, and weather features.\n"
        "• Chronological evaluation prevents random future-to-past leakage.\n"
        "• Models use observed Black Marble months only; synthetic months are excluded.",
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
        "• Increase labels use consecutive calendar months, not event records.",
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
    fig.text(0.08, 0.315, "Data limitations", fontsize=15, weight="bold", color="#9a3412")
    fig.text(
        0.08,
        0.265,
        "Only months with observed Black Marble, TROPOMI, and weather data are included. "
        f"The classifier has {classifier_total} test pairs;\n"
        f"its 95% accuracy interval is {chart_accuracy_interval[0] * 100:.1f}%–"
        f"{chart_accuracy_interval[1] * 100:.1f}%. Results do not establish real-world predictive accuracy.",
        fontsize=12.5,
        color="#7c2d12",
        linespacing=1.5,
    )
    fig.text(
        0.06,
        0.08,
        "Interpretation: exploratory regression/classification on observed months; independent event labels are still needed.",
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
    if not rows:
        raise ValueError(
            "No months have observed Black Marble, TROPOMI, and weather data in common"
        )
    monthly_pair_rows = observed_monthly_pairs(rows)
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
    regression_development, regression_test_rows = holdout_rows(rows)
    classification_development, classification_test_rows = holdout_rows(
        monthly_pair_rows
    )

    regression_candidates = build_regression_candidates()
    classification_candidates = build_classification_candidates()
    if getattr(args, "xgboost_only", False):
        if XGBClassifier is None or XGBRegressor is None:
            raise RuntimeError(
                "--xgboost-only requires the optional xgboost dependency"
            )
        regression_candidates = {"xgboost": regression_candidates["xgboost"]}
        classification_candidates = {
            "xgboost": classification_candidates["xgboost"]
        }

    (
        regression_model,
        regression_name,
        tuning_mae,
        regression_fold_years,
        regression_tuning_observations,
    ) = tune_regression_model(
        regression_candidates, regression_development, feature_names
    )

    _, _, y_classification_development = _arrays(
        classification_development, feature_names
    )
    (
        classification_model,
        classification_name,
        classification_threshold,
        tuning_balanced_accuracy,
        tuning_minimum_class_recall,
        tuning_accuracy,
        tuning_roc_auc,
        tuning_f1,
        classification_fold_years,
        classification_tuning_observations,
    ) = tune_classification_model(
        classification_candidates, classification_development, feature_names
    )

    x_regression_test, y_regression_test, _ = _arrays(
        regression_test_rows, feature_names
    )
    x_classification_test, _, y_classification_test = _arrays(
        classification_test_rows, feature_names
    )
    regression_prediction = regression_model.predict(x_regression_test)
    classification_probability = classification_model.predict_proba(
        x_classification_test
    )[:, 1]
    classification_prediction = (
        classification_probability >= classification_threshold
    ).astype(int)
    regression = regression_metrics(y_regression_test, regression_prediction)
    classification = classification_metrics(
        y_classification_test,
        classification_prediction,
        classification_probability,
    )
    roc_auc = (
        float(roc_auc_score(y_classification_test, classification_probability))
        if np.unique(y_classification_test).size == 2
        else None
    )
    accuracy_interval = wilson_interval(
        int(np.sum(y_classification_test == classification_prediction)),
        len(y_classification_test),
    )
    roc_auc_interval = bootstrap_auc_interval(
        y_classification_test, classification_probability
    )

    persistence_prediction = np.asarray(
        [float(row["lag_radiance"]) for row in regression_test_rows]
    )
    persistence = regression_metrics(y_regression_test, persistence_prediction)
    majority_class = int(np.mean(y_classification_development) >= 0.5)
    majority_prediction = np.full_like(y_classification_test, majority_class)
    majority_probability = np.full(
        len(y_classification_test),
        float(np.mean(y_classification_development)),
    )
    majority = classification_metrics(
        y_classification_test, majority_prediction, majority_probability
    )
    importance = _feature_importance(classification_model, feature_names)
    args.output.mkdir(parents=True, exist_ok=True)
    joblib.dump(regression_model, args.output / "regression_model.joblib")
    joblib.dump(classification_model, args.output / "classification_model.joblib")
    args.model_output.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        regression_model, args.model_output / "radiance_regressor.joblib"
    )
    joblib.dump(
        classification_model,
        args.model_output / "radiance_direction_classifier.joblib",
    )
    with (args.output / "aligned_dataset.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (args.output / "regression_test_predictions.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(["month", "actual_radiance", "predicted_radiance"])
        for row, actual, predicted in zip(
            regression_test_rows,
            y_regression_test,
            regression_prediction,
            strict=True,
        ):
            writer.writerow([row["month"], actual, predicted])
    with (args.output / "test_predictions.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "month",
                "actual_increase",
                "predicted_increase",
                "predicted_increase_probability",
            ]
        )
        for row, actual, predicted, probability in zip(
            classification_test_rows,
            y_classification_test,
            classification_prediction,
            classification_probability,
            strict=True,
        ):
            writer.writerow([row["month"], actual, predicted, probability])

    results: dict[str, object] = {
        "disclaimer": DISCLAIMER,
        "task": {
            "regression": "predict observed monthly mean radiance",
            "classification": "predict whether radiance increased from the previous calendar month",
        },
        "sources": {
            "black_marble": f"{len(rows)} observed aligned months; synthetic rows excluded",
            "tropomi": "Bicol-cropped monthly NO2 grid aggregates",
            "giovanni": "monthly aggregates of Philippines-area MERRA-2 hourly means",
        },
        "synthetic_rows_used": 0,
        "period": {"start": rows[0]["month"], "end": rows[-1]["month"]},
        "split_counts": {
            "regression": {
                "development": len(regression_development),
                "test": len(regression_test_rows),
            },
            "classification_consecutive_month_pairs": {
                "development": len(classification_development),
                "test": len(classification_test_rows),
            },
        },
        "selected_models": {
            "regression": regression_name,
            "classification": classification_name,
            "classification_threshold": classification_threshold,
            "xgboost_available": XGBClassifier is not None,
            "xgboost_only": bool(getattr(args, "xgboost_only", False)),
        },
        "expanding_window_tuning": {
            "regression": {
                "fold_years": regression_fold_years,
                "out_of_fold_observations": regression_tuning_observations,
                "mae": tuning_mae,
            },
            "classification": {
                "fold_years": classification_fold_years,
                "out_of_fold_observations": classification_tuning_observations,
                "minimum_class_recall": tuning_minimum_class_recall,
                "accuracy": tuning_accuracy,
                "balanced_accuracy": tuning_balanced_accuracy,
                "roc_auc": tuning_roc_auc,
                "f1": tuning_f1,
                "threshold": classification_threshold,
            },
        },
        "regression_test_metrics": regression,
        "persistence_baseline_test_metrics": persistence,
        "classification_test_metrics": classification,
        "majority_baseline_test_metrics": majority,
        "requested_accuracy_range_65_to_75_percent": {
            "validation_oof_in_range": 0.65 <= tuning_accuracy <= 0.75,
            "held_out_test_in_range": 0.65 <= classification["accuracy"] <= 0.75,
        },
        "roc_auc_test": roc_auc,
        "uncertainty_95_percent": {
            "accuracy_wilson_interval": accuracy_interval,
            "roc_auc_bootstrap_interval": roc_auc_interval,
        },
        "data_quality": {
            "classification_uses_consecutive_calendar_months_only": True,
            "irregular_observation_pairs_excluded_from_classification": (
                len(rows) - len(monthly_pair_rows)
            ),
        },
        "feature_names": feature_names,
        "charts_directory": str(args.chart_output),
        "model_directory": str(args.model_output),
    }
    (args.output / "metrics.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )
    validation_target = (
        "inside" if 0.65 <= tuning_accuracy <= 0.75 else "outside"
    )
    test_target = (
        "inside" if 0.65 <= classification["accuracy"] <= 0.75 else "outside"
    )
    roc_auc_note = (
        f"- ROC AUC: **{roc_auc:.4f}**\n\n"
        if roc_auc is not None
        else "- ROC AUC: unavailable because the test set contains only one class.\n\n"
    )
    training_notes = (
        "# CSTAR Energy observed-data multimodal prototype\n\n"
        "## Scope\n\n"
        "This prototype aligns Black Marble nighttime radiance, Bicol-cropped "
        "TROPOMI NO2, and Giovanni/MERRA-2 weather features on a monthly timeline. "
        "Synthetic and presentation-only radiance rows are excluded. "
        f"The regression test MAPE is **{regression['mape_percent']:.2f}%**, with "
        f"MAE **{regression['mae']:.4f}** and RMSE **{regression['rmse']:.4f}**.\n\n"
        f"The persistence baseline MAPE is **{persistence['mape_percent']:.2f}%**.\n\n"
        "## Classification results\n\n"
        f"- Accuracy: **{classification['accuracy'] * 100:.2f}%**\n"
        f"- Precision: **{classification['precision'] * 100:.2f}%**\n"
        f"- Recall: **{classification['recall'] * 100:.2f}%**\n"
        f"- Specificity: **{classification['specificity'] * 100:.2f}%**\n"
        f"- F1 score: **{classification['f1'] * 100:.2f}%**\n\n"
        f"- Majority-class baseline accuracy: "
        f"**{majority['accuracy'] * 100:.2f}%**\n\n"
        f"{roc_auc_note}"
        f"The 95% Wilson interval for accuracy is "
        f"**{accuracy_interval[0] * 100:.1f}%–{accuracy_interval[1] * 100:.1f}%**. "
        f"Accuracy was {validation_target} the requested 65–75% range during "
        f"expanding-window validation and {test_target} that range on the held-out test. "
        "Classification uses consecutive calendar-month Black Marble pairs only "
        "with a fixed 0.5 classifier threshold. The target is still "
        "not an independently verified lighting-transition label. The small "
        "holdout is exploratory and must not be described as validated real-world "
        "performance.\n"
    )
    (args.output / "TRAINING_NOTES.md").write_text(training_notes, encoding="utf-8")
    render_charts(
        args.chart_output,
        regression_test_rows,
        classification_test_rows,
        y_regression_test,
        regression_prediction,
        y_classification_test,
        classification_probability,
        classification,
        regression,
        roc_auc,
        importance,
    )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--radiance",
        type=Path,
        default=Path("data/processed/radiance/radiance_time_series.csv"),
    )
    parser.add_argument(
        "--tropomi",
        type=Path,
        default=Path("TROPOMI NO₂/tropomi_no2_2019-01-01_2025-12-31.csv.gz"),
    )
    parser.add_argument("--giovanni", type=Path, default=Path("Giovani"))
    parser.add_argument(
        "--output", type=Path, default=Path("artifacts/radiance_multimodal_real")
    )
    parser.add_argument(
        "--chart-output", type=Path, default=Path("models/evaluation/blackmarble")
    )
    parser.add_argument(
        "--model-output",
        type=Path,
        default=Path("models/training/blackmarble"),
        help="directory for finalized joblib model files",
    )
    parser.add_argument(
        "--xgboost-only",
        action="store_true",
        help="tune and evaluate only XGBoost regressors and classifiers",
    )
    args = parser.parse_args()
    print(json.dumps(train(args), indent=2))


if __name__ == "__main__":
    main()
