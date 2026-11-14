"""Quality-aware preprocessing for VNP46A3 monthly radiance composites."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import h5py
import numpy as np

from .acquisition import Granule, parse_granule_name


# Bounding-box approximation used for the MVP. A formal administrative polygon
# should replace this mask when the team provides one.
BICOL_BOUNDS = (122.3, 11.4, 124.7, 14.6)  # west, south, east, north
DATA_FIELDS = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
RADIANCE_LAYER = "AllAngle_Composite_Snow_Free"
QUALITY_LAYER = f"{RADIANCE_LAYER}_Quality"
COUNT_LAYER = f"{RADIANCE_LAYER}_Num"
LAND_WATER_LAYER = "Land_Water_Mask"
LAND_CODES = (0, 1, 5)  # land/desert, land, coastal


@dataclass(frozen=True, slots=True)
class RadianceStats:
    source_file: str
    product: str
    collection: str
    tile: str
    date: str
    year: int
    month: int
    day_of_year: int
    layer: str
    units: str
    west: float
    south: float
    east: float
    north: float
    total_pixels: int
    land_pixels: int
    direct_good_pixels: int
    poor_quality_pixels: int
    gap_filled_pixels: int
    fill_quality_pixels: int
    valid_pixels: int
    invalid_pixels: int
    observation_count_sum: int
    mean_radiance: float | None
    median_radiance: float | None
    std_radiance: float | None
    p10_radiance: float | None
    p90_radiance: float | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _scalar_attribute(dataset: h5py.Dataset, name: str, default: float) -> float:
    value = dataset.attrs.get(name, default)
    array = np.asarray(value).reshape(-1)
    return float(array[0]) if array.size else float(default)


def _coordinate_window(
    latitudes: np.ndarray,
    longitudes: np.ndarray,
    bounds: tuple[float, float, float, float],
) -> tuple[slice, slice, np.ndarray, np.ndarray]:
    west, south, east, north = bounds
    lat_positions = np.flatnonzero((latitudes >= south) & (latitudes <= north))
    lon_positions = np.flatnonzero((longitudes >= west) & (longitudes <= east))
    if not lat_positions.size or not lon_positions.size:
        raise ValueError(f"Bounds {bounds} do not intersect the granule")
    row_slice = slice(int(lat_positions.min()), int(lat_positions.max()) + 1)
    col_slice = slice(int(lon_positions.min()), int(lon_positions.max()) + 1)
    lat_mask = (latitudes[row_slice] >= south) & (latitudes[row_slice] <= north)
    lon_mask = (longitudes[col_slice] >= west) & (longitudes[col_slice] <= east)
    return row_slice, col_slice, lat_mask, lon_mask


def summarize_granule(
    granule: Granule | str | Path,
    *,
    bounds: tuple[float, float, float, float] = BICOL_BOUNDS,
    land_codes: Iterable[int] = LAND_CODES,
) -> RadianceStats:
    """Summarize direct, good-quality, snow-free radiance within bounds.

    Quality value 0 is the primary direct observation set. Poor-quality (1),
    gap-filled (2), and fill (255) pixels are counted but excluded from the
    radiance statistics.
    """

    item = granule if isinstance(granule, Granule) else parse_granule_name(granule)
    with h5py.File(item.path, "r") as handle:
        fields = handle[DATA_FIELDS]
        latitudes = np.asarray(fields["lat"][:], dtype=np.float64)
        longitudes = np.asarray(fields["lon"][:], dtype=np.float64)
        row_slice, col_slice, lat_mask, lon_mask = _coordinate_window(
            latitudes, longitudes, bounds
        )
        spatial_mask = lat_mask[:, None] & lon_mask[None, :]

        dataset = fields[RADIANCE_LAYER]
        raw_radiance = np.asarray(dataset[row_slice, col_slice], dtype=np.float64)
        quality = np.asarray(fields[QUALITY_LAYER][row_slice, col_slice])
        observations = np.asarray(fields[COUNT_LAYER][row_slice, col_slice])
        land_water = np.asarray(fields[LAND_WATER_LAYER][row_slice, col_slice])

        fill_value = _scalar_attribute(dataset, "_FillValue", -999.9)
        scale = _scalar_attribute(dataset, "scale_factor", 1.0)
        offset = _scalar_attribute(dataset, "offset", 0.0)
        radiance = raw_radiance * scale + offset
        units = dataset.attrs.get("units", "nWatts/(cm^2 sr)")
        if isinstance(units, bytes):
            units = units.decode("utf-8", errors="replace")

    land_mask = np.isin(land_water, tuple(land_codes)) & spatial_mask
    finite_radiance = (
        np.isfinite(raw_radiance)
        & (raw_radiance != fill_value)
        & np.isfinite(radiance)
        & (radiance >= 0)
    )
    direct_good = land_mask & (quality == 0)
    valid = direct_good & finite_radiance & (observations > 0) & (observations != 65535)
    values = radiance[valid]

    def metric(function) -> float | None:
        return float(function(values)) if values.size else None

    total_pixels = int(np.count_nonzero(spatial_mask))
    valid_pixels = int(np.count_nonzero(valid))
    observation_count_sum = int(np.sum(observations[valid], dtype=np.uint64))
    return RadianceStats(
        source_file=item.path.name,
        product=item.product,
        collection=item.collection,
        tile=item.tile,
        date=item.observation_date.isoformat(),
        year=item.observation_date.year,
        month=item.observation_date.month,
        day_of_year=item.observation_date.timetuple().tm_yday,
        layer=RADIANCE_LAYER,
        units=str(units),
        west=bounds[0],
        south=bounds[1],
        east=bounds[2],
        north=bounds[3],
        total_pixels=total_pixels,
        land_pixels=int(np.count_nonzero(land_mask)),
        direct_good_pixels=int(np.count_nonzero(direct_good)),
        poor_quality_pixels=int(np.count_nonzero(land_mask & (quality == 1))),
        gap_filled_pixels=int(np.count_nonzero(land_mask & (quality == 2))),
        fill_quality_pixels=int(np.count_nonzero(spatial_mask & (quality == 255))),
        valid_pixels=valid_pixels,
        invalid_pixels=total_pixels - valid_pixels,
        observation_count_sum=observation_count_sum,
        mean_radiance=metric(np.mean),
        median_radiance=metric(np.median),
        std_radiance=metric(np.std),
        p10_radiance=metric(lambda data: np.percentile(data, 10)),
        p90_radiance=metric(lambda data: np.percentile(data, 90)),
    )


def filtered_points(
    granule: Granule | str | Path,
    *,
    bounds: tuple[float, float, float, float] = BICOL_BOUNDS,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return lat, lon, radiance, and observation-count arrays for map export."""

    item = granule if isinstance(granule, Granule) else parse_granule_name(granule)
    with h5py.File(item.path, "r") as handle:
        fields = handle[DATA_FIELDS]
        latitudes = np.asarray(fields["lat"][:], dtype=np.float64)
        longitudes = np.asarray(fields["lon"][:], dtype=np.float64)
        row_slice, col_slice, lat_mask, lon_mask = _coordinate_window(
            latitudes, longitudes, bounds
        )
        dataset = fields[RADIANCE_LAYER]
        raw_radiance = np.asarray(dataset[row_slice, col_slice], dtype=np.float64)
        fill_value = _scalar_attribute(dataset, "_FillValue", -999.9)
        scale = _scalar_attribute(dataset, "scale_factor", 1.0)
        offset = _scalar_attribute(dataset, "offset", 0.0)
        radiance = raw_radiance * scale + offset
        quality = np.asarray(fields[QUALITY_LAYER][row_slice, col_slice])
        observations = np.asarray(fields[COUNT_LAYER][row_slice, col_slice])
        land_water = np.asarray(fields[LAND_WATER_LAYER][row_slice, col_slice])
        latitude_grid, longitude_grid = np.meshgrid(
            latitudes[row_slice], longitudes[col_slice], indexing="ij"
        )
        spatial = lat_mask[:, None] & lon_mask[None, :]
        valid = (
            spatial
            & np.isin(land_water, LAND_CODES)
            & (quality == 0)
            & (raw_radiance != fill_value)
            & np.isfinite(radiance)
            & (radiance >= 0)
            & (observations > 0)
            & (observations != 65535)
        )
        return (
            latitude_grid[valid],
            longitude_grid[valid],
            radiance[valid],
            observations[valid],
        )

