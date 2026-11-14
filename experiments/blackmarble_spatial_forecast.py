"""Export observed Bicol cell grids and a next-month spatial Random Forest forecast."""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import h5py
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)

from modules.radiance.acquisition import Granule, discover_granules
from modules.radiance.preprocessing import (
    BICOL_BOUNDS,
    COUNT_LAYER,
    DATA_FIELDS,
    LAND_CODES,
    LAND_WATER_LAYER,
    QUALITY_LAYER,
    RADIANCE_LAYER,
)

FEATURE_NAMES = [
    "longitude",
    "latitude",
    "previous_month_radiance",
    "target_month_sin",
    "target_month_cos",
]
FORECAST_START_YEAR = 2024
RANDOM_STATE = 46


def _month_before(month: str) -> str:
    year, number = map(int, month.split("-"))
    if number == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{number - 1:02d}"


def _month_after(month: str) -> str:
    year, number = map(int, month.split("-"))
    if number == 12:
        return f"{year + 1:04d}-01"
    return f"{year:04d}-{number + 1:02d}"


def _month_phase(month: str) -> tuple[float, float]:
    month_number = int(month.split("-")[1])
    angle = 2 * np.pi * (month_number - 1) / 12
    return float(np.sin(angle)), float(np.cos(angle))


def _attribute(dataset: h5py.Dataset, name: str, default: float) -> float:
    value = np.asarray(dataset.attrs.get(name, default)).reshape(-1)
    return float(value[0]) if value.size else float(default)


def _grid_definition(
    granule: Granule, bounds: tuple[float, float, float, float]
) -> tuple[
    slice,
    slice,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
]:
    west, south, east, north = bounds
    with h5py.File(granule.path, "r") as handle:
        fields = handle[DATA_FIELDS]
        latitudes = np.asarray(fields["lat"][:], dtype=np.float64)
        longitudes = np.asarray(fields["lon"][:], dtype=np.float64)
        latitude_indices = np.flatnonzero((latitudes >= south) & (latitudes <= north))
        longitude_indices = np.flatnonzero((longitudes >= west) & (longitudes <= east))
        if not latitude_indices.size or not longitude_indices.size:
            raise ValueError(f"Bicol bounds do not intersect {granule.path.name}")
        rows = slice(int(latitude_indices.min()), int(latitude_indices.max()) + 1)
        columns = slice(
            int(longitude_indices.min()), int(longitude_indices.max()) + 1
        )
        latitude_window = latitudes[rows]
        longitude_window = longitudes[columns]
        spatial = (
            (latitude_window[:, None] >= south)
            & (latitude_window[:, None] <= north)
            & (longitude_window[None, :] >= west)
            & (longitude_window[None, :] <= east)
        )
        land = np.isin(fields[LAND_WATER_LAYER][rows, columns], LAND_CODES)
        cell_mask = spatial & land
    latitude_grid, longitude_grid = np.meshgrid(
        latitude_window, longitude_window, indexing="ij"
    )
    flat_indices = np.flatnonzero(cell_mask)
    if not flat_indices.size:
        raise ValueError("No land cells intersect the Bicol bounds")
    return (
        rows,
        columns,
        latitudes,
        longitudes,
        latitude_grid.ravel()[flat_indices].astype("<f4"),
        longitude_grid.ravel()[flat_indices].astype("<f4"),
        flat_indices,
    )


def _read_month(
    granule: Granule,
    grid: tuple[slice, slice, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray],
) -> tuple[np.ndarray, np.ndarray]:
    rows, columns, reference_lat, reference_lon, _, _, flat_indices = grid
    with h5py.File(granule.path, "r") as handle:
        fields = handle[DATA_FIELDS]
        if not np.array_equal(fields["lat"][:], reference_lat) or not np.array_equal(
            fields["lon"][:], reference_lon
        ):
            raise ValueError(f"Cell coordinates changed in {granule.path.name}")
        dataset = fields[RADIANCE_LAYER]
        raw = np.asarray(dataset[rows, columns], dtype=np.float64).ravel()[
            flat_indices
        ]
        quality = np.asarray(fields[QUALITY_LAYER][rows, columns]).ravel()[
            flat_indices
        ]
        observations = np.asarray(fields[COUNT_LAYER][rows, columns]).ravel()[
            flat_indices
        ]
        land = np.asarray(fields[LAND_WATER_LAYER][rows, columns]).ravel()[
            flat_indices
        ]
        fill = _attribute(dataset, "_FillValue", -999.9)
        radiance = raw * _attribute(dataset, "scale_factor", 1.0) + _attribute(
            dataset, "offset", 0.0
        )
        valid = (
            np.isin(land, LAND_CODES)
            & (quality == 0)
            & np.isfinite(raw)
            & (raw != fill)
            & np.isfinite(radiance)
            & (radiance >= 0)
            & (observations > 0)
            & (observations != 65535)
        )
    values = np.full(len(flat_indices), np.nan, dtype="<f4")
    counts = np.zeros(len(flat_indices), dtype="<u2")
    values[valid] = radiance[valid].astype("<f4")
    counts[valid] = observations[valid].astype("<u2")
    return values, counts


def load_grids(
    input_directory: Path,
    *,
    bounds: tuple[float, float, float, float] = BICOL_BOUNDS,
) -> tuple[dict[str, tuple[np.ndarray, np.ndarray]], np.ndarray, np.ndarray]:
    granules, _ = discover_granules(input_directory, tile="h30v07", product="VNP46A3")
    if not granules:
        raise ValueError(f"No valid VNP46A3 h30v07 granules in {input_directory}")
    grid = _grid_definition(granules[0], bounds)
    latitudes, longitudes = grid[4], grid[5]
    monthly: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for granule in granules:
        month = granule.observation_date.strftime("%Y-%m")
        if month in monthly:
            raise ValueError(f"Multiple Black Marble grids found for {month}")
        monthly[month] = _read_month(granule, grid)
    return monthly, latitudes, longitudes


def make_features(
    latitude: np.ndarray,
    longitude: np.ndarray,
    previous_radiance: np.ndarray,
    target_month: str,
) -> np.ndarray:
    month_sin, month_cos = _month_phase(target_month)
    return np.column_stack(
        (
            longitude,
            latitude,
            previous_radiance,
            np.full(len(previous_radiance), month_sin),
            np.full(len(previous_radiance), month_cos),
        )
    ).astype(np.float32, copy=False)


def _paired_months(
    monthly: dict[str, tuple[np.ndarray, np.ndarray]],
) -> list[tuple[str, np.ndarray, np.ndarray]]:
    return [
        (month, monthly[_month_before(month)][0], current[0])
        for month, current in sorted(monthly.items())
        if _month_before(month) in monthly
    ]


def _exclude_empty_months(
    monthly: dict[str, tuple[np.ndarray, np.ndarray]],
) -> list[str]:
    empty_months = sorted(
        month
        for month, (radiance, _) in monthly.items()
        if not np.isfinite(radiance).any()
    )
    for month in empty_months:
        del monthly[month]
    if not monthly:
        raise ValueError("No Black Marble month contains valid Bicol cells")
    return empty_months


def _sample_pair(
    month: str,
    previous: np.ndarray,
    current: np.ndarray,
    latitude: np.ndarray,
    longitude: np.ndarray,
    *,
    maximum: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    valid = np.isfinite(previous) & np.isfinite(current)
    indices = np.flatnonzero(valid)
    if not indices.size:
        return (
            np.empty((0, len(FEATURE_NAMES)), dtype=np.float32),
            np.empty(0, dtype=np.float32),
            np.empty(0, dtype=np.uint8),
        )
    if len(indices) > maximum:
        indices = np.random.default_rng(seed).choice(indices, maximum, replace=False)
    features = make_features(
        latitude[indices], longitude[indices], previous[indices], month
    )
    target = current[indices]
    increased = (target > previous[indices]).astype(np.uint8)
    return features, target, increased


def _training_data(
    pairs: list[tuple[str, np.ndarray, np.ndarray]],
    latitude: np.ndarray,
    longitude: np.ndarray,
    *,
    maximum_per_month: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    feature_rows: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    directions: list[np.ndarray] = []
    for index, (month, previous, current) in enumerate(pairs):
        x, y, direction = _sample_pair(
            month,
            previous,
            current,
            latitude,
            longitude,
            maximum=maximum_per_month,
            seed=RANDOM_STATE + index,
        )
        if len(y):
            feature_rows.append(x)
            targets.append(y)
            directions.append(direction)
    if not targets:
        raise ValueError("No consecutive valid Black Marble month pairs")
    return (
        np.concatenate(feature_rows),
        np.concatenate(targets),
        np.concatenate(directions),
    )


def _models() -> tuple[RandomForestRegressor, RandomForestClassifier]:
    return (
        RandomForestRegressor(
            n_estimators=120,
            max_depth=16,
            min_samples_leaf=25,
            max_features=0.9,
            n_jobs=-1,
            random_state=RANDOM_STATE,
        ),
        RandomForestClassifier(
            n_estimators=120,
            max_depth=16,
            min_samples_leaf=25,
            max_features=0.9,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=RANDOM_STATE,
        ),
    )


def _fit_models(
    pairs: list[tuple[str, np.ndarray, np.ndarray]],
    latitude: np.ndarray,
    longitude: np.ndarray,
    *,
    maximum_per_month: int,
) -> tuple[RandomForestRegressor, RandomForestClassifier, int]:
    x, target, direction = _training_data(
        pairs,
        latitude,
        longitude,
        maximum_per_month=maximum_per_month,
    )
    if np.unique(direction).size != 2:
        raise ValueError("Spatial direction training data must contain both classes")
    regressor, classifier = _models()
    regressor.fit(x, target)
    classifier.fit(x, direction)
    return regressor, classifier, len(target)


def _forecast(
    month: str,
    previous_radiance: np.ndarray,
    latitude: np.ndarray,
    longitude: np.ndarray,
    regressor: RandomForestRegressor,
    classifier: RandomForestClassifier,
) -> tuple[np.ndarray, np.ndarray]:
    valid = np.isfinite(previous_radiance)
    predictions = np.full(previous_radiance.shape, np.nan, dtype="<f4")
    probabilities = np.full(previous_radiance.shape, np.nan, dtype="<f4")
    if not valid.any():
        return predictions, probabilities
    features = make_features(
        latitude[valid], longitude[valid], previous_radiance[valid], month
    )
    predictions[valid] = np.maximum(0, regressor.predict(features)).astype("<f4")
    probabilities[valid] = classifier.predict_proba(features)[:, 1].astype("<f4")
    return predictions, probabilities


def _write_gzip(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=6) as stream:
        stream.write(payload)


def _write_observed(path: Path, radiance: np.ndarray, counts: np.ndarray) -> None:
    _write_gzip(
        path,
        np.asarray(radiance, dtype="<f4").tobytes()
        + np.asarray(counts, dtype="<u2").tobytes(),
    )


def _write_forecast(
    path: Path, radiance: np.ndarray, increase_probability: np.ndarray
) -> None:
    _write_gzip(
        path,
        np.asarray(radiance, dtype="<f4").tobytes()
        + np.asarray(increase_probability, dtype="<f4").tobytes(),
    )


def train_and_export(
    input_directory: Path,
    data_output: Path,
    model_output: Path,
    metrics_output: Path,
    *,
    maximum_samples_per_month: int = 12_000,
) -> dict[str, object]:
    monthly, latitude, longitude = load_grids(input_directory)
    excluded_empty_months = _exclude_empty_months(monthly)
    observed_directory = data_output / "observations"
    forecast_directory = data_output / "forecasts"
    for month, (radiance, counts) in monthly.items():
        _write_observed(observed_directory / f"{month}.bin.gz", radiance, counts)
    _write_gzip(
        data_output / "grid.bin.gz",
        np.column_stack((longitude, latitude)).astype("<f4").tobytes(),
    )

    pairs = _paired_months(monthly)
    training_pairs = [pair for pair in pairs if int(pair[0][:4]) < FORECAST_START_YEAR]
    test_pairs = [pair for pair in pairs if int(pair[0][:4]) >= FORECAST_START_YEAR]
    if not training_pairs or not test_pairs:
        raise ValueError("Chronological training and test month pairs are required")
    test_regressor, test_classifier, training_samples = _fit_models(
        training_pairs,
        latitude,
        longitude,
        maximum_per_month=maximum_samples_per_month,
    )

    actual_values: list[np.ndarray] = []
    predicted_values: list[np.ndarray] = []
    actual_directions: list[np.ndarray] = []
    predicted_directions: list[np.ndarray] = []
    probabilities: list[np.ndarray] = []
    forecast_months: list[str] = []
    for index, (month, previous, current) in enumerate(test_pairs):
        x, y, direction = _sample_pair(
            month,
            previous,
            current,
            latitude,
            longitude,
            maximum=maximum_samples_per_month,
            seed=RANDOM_STATE + 10_000 + index,
        )
        if len(y):
            predicted = test_regressor.predict(x)
            probability = test_classifier.predict_proba(x)[:, 1]
            actual_values.append(y)
            predicted_values.append(predicted)
            actual_directions.append(direction)
            predicted_directions.append((probability >= 0.5).astype(np.uint8))
            probabilities.append(probability)
        predictions, increase_probability = _forecast(
            month, previous, latitude, longitude, test_regressor, test_classifier
        )
        _write_forecast(
            forecast_directory / f"{month}.bin.gz",
            predictions,
            increase_probability,
        )
        forecast_months.append(month)

    actual = np.concatenate(actual_values)
    predicted = np.concatenate(predicted_values)
    direction = np.concatenate(actual_directions)
    predicted_direction = np.concatenate(predicted_directions)
    probability = np.concatenate(probabilities)
    metrics: dict[str, object] = {
        "model": "spatial_random_forest",
        "target": "one-calendar-month-ahead cell radiance and direction",
        "training_period": {
            "start": training_pairs[0][0],
            "end": training_pairs[-1][0],
        },
        "test_period": {
            "start": test_pairs[0][0],
            "end": test_pairs[-1][0],
        },
        "training_pairs": len(training_pairs),
        "test_pairs": len(test_pairs),
        "training_samples": training_samples,
        "test_samples": int(len(actual)),
        "excluded_empty_months": excluded_empty_months,
        "test_months": [pair[0] for pair in test_pairs],
        "regression": {
            "mae": float(mean_absolute_error(actual, predicted)),
            "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        },
        "direction": {
            "accuracy": float(accuracy_score(direction, predicted_direction)),
            "balanced_accuracy": float(
                balanced_accuracy_score(direction, predicted_direction)
            ),
            "precision": float(precision_score(direction, predicted_direction, zero_division=0)),
            "recall": float(recall_score(direction, predicted_direction, zero_division=0)),
            "f1": float(f1_score(direction, predicted_direction, zero_division=0)),
            "roc_auc": (
                float(roc_auc_score(direction, probability))
                if np.unique(direction).size == 2
                else None
            ),
        },
        "feature_names": FEATURE_NAMES,
        "forecast_months": forecast_months,
        "disclaimer": (
            "Exploratory cell-level radiance screening. Probabilities are not "
            "calibrated; predictions do not establish causal impact."
        ),
    }

    forecast_model_pairs = pairs
    final_regressor, final_classifier, final_training_samples = _fit_models(
        forecast_model_pairs,
        latitude,
        longitude,
        maximum_per_month=maximum_samples_per_month,
    )
    latest_month = max(monthly)
    future_month = _month_after(latest_month)
    future_radiance, future_probability = _forecast(
        future_month,
        monthly[latest_month][0],
        latitude,
        longitude,
        final_regressor,
        final_classifier,
    )
    _write_forecast(
        forecast_directory / f"{future_month}.bin.gz",
        future_radiance,
        future_probability,
    )
    forecast_months.append(future_month)
    metrics["future_forecast"] = {
        "month": future_month,
        "based_on_observation_month": latest_month,
        "training_pairs": len(forecast_model_pairs),
        "training_samples": final_training_samples,
    }
    metrics["forecast_months"] = forecast_months

    model_output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "regressor": final_regressor,
            "classifier": final_classifier,
            "feature_names": FEATURE_NAMES,
            "target": metrics["target"],
            "training_months": [pair[0] for pair in forecast_model_pairs],
            "random_state": RANDOM_STATE,
        },
        model_output,
        compress=3,
    )
    metrics_output.parent.mkdir(parents=True, exist_ok=True)
    metrics_output.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    manifest = {
        "formatVersion": 1,
        "product": "VNP46A3 Collection 2",
        "layer": RADIANCE_LAYER,
        "units": "nWatts/(cm^2 sr)",
        "quality": (
            "Direct good-quality land/coastal cells with observations; "
            "invalid and unobserved values are omitted."
        ),
        "cellCount": int(len(latitude)),
        "months": sorted(monthly),
        "forecastMonths": forecast_months,
        "excludedEmptyMonths": excluded_empty_months,
        "latestObservedMonth": latest_month,
        "futureForecastMonth": future_month,
        "observedValueFormat": "float32-le radiance followed by uint16-le observation counts",
        "forecastValueFormat": "float32-le predicted radiance followed by float32-le probability of increase",
        "gridValueFormat": "interleaved float32-le longitude,latitude pairs",
        "model": "Random Forest cell-level one-calendar-month-ahead forecast",
        "metrics": metrics,
        "disclaimer": metrics["disclaimer"],
    }
    (data_output / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("BlackMarbles"))
    parser.add_argument(
        "--data-output",
        type=Path,
        default=Path("frontend/public/data/blackmarble"),
    )
    parser.add_argument(
        "--model-output",
        type=Path,
        default=Path("models/training/blackmarble/spatial_radiance_forecaster.joblib"),
    )
    parser.add_argument(
        "--metrics-output",
        type=Path,
        default=Path("models/evaluation/blackmarble/spatial_metrics.json"),
    )
    parser.add_argument("--maximum-samples-per-month", type=int, default=12_000)
    args = parser.parse_args()
    if args.maximum_samples_per_month < 100:
        parser.error("--maximum-samples-per-month must be at least 100")
    metrics = train_and_export(
        args.input,
        args.data_output,
        args.model_output,
        args.metrics_output,
        maximum_samples_per_month=args.maximum_samples_per_month,
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
