"""Load and validate NASA Giovanni MERRA-2 time-series exports."""

from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class MerraFileMetadata:
    """Provenance retained from one Giovanni CSV export."""

    path: str
    variable: str
    product: str
    user_start_date: str
    user_end_date: str
    bounding_box: str
    fill_value: float | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _read_preamble(path: Path) -> dict[str, str]:
    metadata: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        for _ in range(5):
            row = next(reader, [])
            if len(row) >= 2 and row[0].strip():
                metadata[row[0].strip().rstrip(":")] = row[1].strip()
    return metadata


def _parse_fill_value(raw_value: str | None) -> float | None:
    if not raw_value:
        return None
    try:
        return float(raw_value)
    except ValueError:
        return None


def load_merra_file(path: str | Path) -> tuple[pd.DataFrame, MerraFileMetadata]:
    """Read one Giovanni CSV and return `time` plus one canonical variable."""

    source = Path(path)
    preamble = _read_preamble(source)
    frame = pd.read_csv(source, skiprows=5)

    if "time" not in frame.columns:
        raise ValueError(f"Missing time column in {source.name}")

    value_columns = [column for column in frame.columns if column != "time"]
    if len(value_columns) != 1:
        raise ValueError(
            f"Expected exactly one value column in {source.name}; found {value_columns}"
        )

    value_column = value_columns[0]
    variable = value_column.rsplit("_", maxsplit=1)[-1].lower()
    product = value_column.removeprefix("mean_").removesuffix(
        f"_{variable.upper()}"
    )

    frame = frame.rename(columns={value_column: variable})[["time", variable]]
    frame["time"] = pd.to_datetime(frame["time"], utc=True, errors="raise")
    frame[variable] = pd.to_numeric(frame[variable], errors="coerce")

    fill_value = _parse_fill_value(preamble.get("Fill Value"))
    if fill_value is not None:
        frame.loc[np.isclose(frame[variable], fill_value), variable] = np.nan
    frame.loc[frame[variable].abs() >= 1e14, variable] = np.nan

    if frame["time"].duplicated().any():
        raise ValueError(f"Duplicate timestamps found in {source.name}")

    frame = frame.sort_values("time").reset_index(drop=True)
    metadata = MerraFileMetadata(
        path=str(source),
        variable=variable,
        product=product,
        user_start_date=preamble.get("User Start Date", ""),
        user_end_date=preamble.get("User End Date", ""),
        bounding_box=preamble.get("User Bounding Box", ""),
        fill_value=fill_value,
    )
    return frame, metadata


def load_merra_directory(
    directory: str | Path,
) -> tuple[pd.DataFrame, list[MerraFileMetadata]]:
    """Outer-join every MERRA CSV on its UTC timestamp."""

    root = Path(directory)
    paths = sorted(root.glob("*.csv"))
    if not paths:
        raise FileNotFoundError(f"No CSV files found in {root}")

    combined: pd.DataFrame | None = None
    metadata: list[MerraFileMetadata] = []
    variables: set[str] = set()

    for path in paths:
        frame, file_metadata = load_merra_file(path)
        if file_metadata.variable in variables:
            raise ValueError(f"Duplicate MERRA variable: {file_metadata.variable}")
        variables.add(file_metadata.variable)
        metadata.append(file_metadata)
        combined = (
            frame
            if combined is None
            else combined.merge(frame, on="time", how="outer", validate="one_to_one")
        )

    assert combined is not None
    combined = combined.sort_values("time").reset_index(drop=True)
    return combined, metadata
