"""Inventory and validate locally acquired NASA Black Marble granules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
import re


HDF5_SIGNATURE = b"\x89HDF\r\n\x1a\n"
GRANULE_PATTERN = re.compile(
    r"^(?P<product>VNP46A[234])\.A(?P<year>\d{4})(?P<doy>\d{3})\."
    r"(?P<tile>h\d{2}v\d{2})\.(?P<collection>\d{3})\."
    r"(?P<production>\d+)\.h5$"
)


@dataclass(frozen=True, slots=True)
class Granule:
    """Metadata encoded in a Black Marble filename."""

    path: Path
    product: str
    observation_date: date
    tile: str
    collection: str
    production_id: str

    @property
    def year(self) -> int:
        return self.observation_date.year

    @property
    def canonical_name(self) -> str:
        return self.path.name.replace(" (1).h5", ".h5")


def parse_granule_name(path: str | Path) -> Granule:
    """Parse a VNP46 filename, accepting Chrome's `` (1)`` duplicate suffix."""

    source = Path(path)
    normalized = source.name.replace(" (1).h5", ".h5")
    match = GRANULE_PATTERN.fullmatch(normalized)
    if not match:
        raise ValueError(f"Unsupported Black Marble filename: {source.name}")
    year = int(match.group("year"))
    doy = int(match.group("doy"))
    try:
        observation_date = date(year, 1, 1) + timedelta(days=doy - 1)
    except ValueError as exc:
        raise ValueError(f"Invalid year/day-of-year in {source.name}") from exc
    if observation_date.year != year:
        raise ValueError(f"Day-of-year exceeds year in {source.name}")
    return Granule(
        path=source,
        product=match.group("product"),
        observation_date=observation_date,
        tile=match.group("tile"),
        collection=match.group("collection"),
        production_id=match.group("production"),
    )


def has_hdf5_signature(path: str | Path) -> bool:
    """Return whether a file begins with the HDF5 magic bytes."""

    source = Path(path)
    if not source.is_file() or source.stat().st_size < len(HDF5_SIGNATURE):
        return False
    with source.open("rb") as stream:
        return stream.read(len(HDF5_SIGNATURE)) == HDF5_SIGNATURE


def discover_granules(
    directory: str | Path,
    *,
    tile: str = "h30v07",
    product: str = "VNP46A3",
) -> tuple[list[Granule], list[dict[str, str]]]:
    """Find unique valid granules and describe every excluded file.

    Duplicate filenames such as ``file (1).h5`` are removed by canonical name.
    The original canonical filename is preferred when both copies exist.
    """

    root = Path(directory)
    if not root.is_dir():
        raise FileNotFoundError(f"Radiance input directory does not exist: {root}")

    accepted: dict[str, Granule] = {}
    excluded: list[dict[str, str]] = []
    candidates = sorted(root.iterdir(), key=lambda item: (" (1).h5" in item.name, item.name))
    for path in candidates:
        if not path.is_file():
            continue
        if path.suffix.lower() != ".h5":
            excluded.append({"file": path.name, "reason": "not_hdf5"})
            continue
        try:
            granule = parse_granule_name(path)
        except ValueError:
            excluded.append({"file": path.name, "reason": "unrecognized_filename"})
            continue
        if granule.product != product:
            excluded.append({"file": path.name, "reason": f"product_not_{product}"})
            continue
        if granule.tile != tile:
            excluded.append({"file": path.name, "reason": f"tile_not_{tile}"})
            continue
        if not has_hdf5_signature(path):
            excluded.append({"file": path.name, "reason": "invalid_hdf5_signature"})
            continue
        if granule.canonical_name in accepted:
            excluded.append({"file": path.name, "reason": "duplicate"})
            continue
        accepted[granule.canonical_name] = granule

    granules = sorted(
        accepted.values(),
        key=lambda item: (item.observation_date, item.path.name),
    )
    return granules, excluded

