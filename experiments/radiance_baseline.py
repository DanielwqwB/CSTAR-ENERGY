"""Train an honest, small radiance forecasting baseline.

This experiment predicts the next available mean-radiance observation from the
previous observation and calendar timing. The source series is sparse and
irregular, so results validate the training pipeline only; they are not a
transition classifier or a substitute for the planned multimodal ST-GNN.
"""

from __future__ import annotations

import argparse
import csv
from datetime import date
import json
import math
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


FEATURE_NAMES = [
    "lag_radiance",
    "elapsed_days",
    "year_offset",
    "month_sin",
    "month_cos",
]


def load_examples(path: str | Path) -> list[dict[str, float | int | str]]:
    """Create next-observation examples from the processed radiance series."""

    observations: list[tuple[date, float]] = []
    with Path(path).open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            if row.get("presentation_only", "").lower() == "true" or row.get(
                "is_synthetic", ""
            ).lower() == "true":
                raise ValueError(
                    "Presentation-only synthetic radiance cannot be used for "
                    "training or evaluation. Use the observed time series."
                )
            value = row.get("mean_radiance")
            if not value:
                continue
            observations.append((date.fromisoformat(row["date"]), float(value)))
    observations.sort(key=lambda item: item[0])
    if len(observations) < 4:
        raise ValueError("At least four dated radiance observations are required")

    examples: list[dict[str, float | int | str]] = []
    for (previous_date, previous_value), (target_date, target_value) in zip(
        observations, observations[1:]
    ):
        month_angle = 2 * math.pi * (target_date.month - 1) / 12
        examples.append(
            {
                "date": target_date.isoformat(),
                "year": target_date.year,
                "lag_radiance": previous_value,
                "elapsed_days": (target_date - previous_date).days,
                "year_offset": target_date.year - 2016,
                "month_sin": math.sin(month_angle),
                "month_cos": math.cos(month_angle),
                "target": target_value,
            }
        )
    return examples


def split_examples(examples):
    """Use chronological splits with no random temporal leakage."""

    train = [row for row in examples if int(row["year"]) <= 2022]
    validation = [row for row in examples if 2023 <= int(row["year"]) <= 2024]
    test = [row for row in examples if int(row["year"]) >= 2025]
    if min(map(len, (train, validation, test))) == 0:
        raise ValueError("Train, validation, and test periods must all contain data")
    return train, validation, test


def arrays(rows):
    features = np.asarray(
        [[float(row[name]) for name in FEATURE_NAMES] for row in rows],
        dtype=np.float64,
    )
    targets = np.asarray([float(row["target"]) for row in rows], dtype=np.float64)
    return features, targets


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    """Compute regression metrics; MAPE excludes zero/near-zero targets."""

    threshold = 1e-6
    nonzero = np.abs(actual) > threshold
    mape = (
        float(np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])) * 100)
        if np.any(nonzero)
        else float("nan")
    )
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "mape_percent": mape,
    }


def train(source: Path, output_directory: Path) -> dict[str, object]:
    examples = load_examples(source)
    train_rows, validation_rows, test_rows = split_examples(examples)
    x_train, y_train = arrays(train_rows)
    x_validation, y_validation = arrays(validation_rows)
    x_test, y_test = arrays(test_rows)

    candidates: list[tuple[float, Pipeline, float]] = []
    for alpha in (0.01, 0.1, 1.0, 10.0, 100.0):
        model = Pipeline(
            [
                ("scale", StandardScaler()),
                ("ridge", Ridge(alpha=alpha)),
            ]
        )
        model.fit(x_train, y_train)
        validation_mae = mean_absolute_error(y_validation, model.predict(x_validation))
        candidates.append((alpha, model, float(validation_mae)))
    alpha, selected_model, validation_mae = min(candidates, key=lambda item: item[2])

    model_predictions = selected_model.predict(x_test)
    persistence_predictions = x_test[:, FEATURE_NAMES.index("lag_radiance")]
    results: dict[str, object] = {
        "task": "next-observation radiance regression",
        "selected_alpha": alpha,
        "feature_names": FEATURE_NAMES,
        "split_counts": {
            "train": len(train_rows),
            "validation": len(validation_rows),
            "test": len(test_rows),
        },
        "validation_mae": validation_mae,
        "test_metrics": regression_metrics(y_test, model_predictions),
        "persistence_baseline_test_metrics": regression_metrics(
            y_test, persistence_predictions
        ),
        "classification_metrics": {
            "accuracy": None,
            "precision": None,
            "recall": None,
            "specificity": None,
            "f1": None,
            "reason": "No independently verified binary transition labels are available.",
        },
        "limitations": [
            "Only sparse, irregular VNP46A3 observations are available.",
            "Observation months differ, so seasonal effects may confound the forecast.",
            "The sample is too small for claims about generalization or 90% accuracy.",
            "This is not the multimodal ST-GNN.",
        ],
    }

    output_directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(selected_model, output_directory / "radiance_ridge.joblib")
    (output_directory / "metrics.json").write_text(
        json.dumps(results, indent=2, allow_nan=False), encoding="utf-8"
    )
    with (output_directory / "test_predictions.csv").open(
        "w", newline="", encoding="utf-8"
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(["date", "actual", "prediction", "persistence_prediction"])
        for row, actual, predicted, persistence in zip(
            test_rows,
            y_test,
            model_predictions,
            persistence_predictions,
            strict=True,
        ):
            writer.writerow([row["date"], actual, predicted, persistence])
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/processed/radiance/radiance_time_series.csv"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/radiance_baseline"),
    )
    args = parser.parse_args()
    results = train(args.input, args.output)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

