"""Inventory and download monthly NASA Black Marble granules from LAADS."""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import date
import io
import json
import os
from pathlib import Path
import shutil
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .acquisition import has_hdf5_signature


ARCHIVE_ROOT = "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A3"
TOKEN_ENV = "NASA_EARTHDATA_TOKEN"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
FREE_SPACE_RESERVE_BYTES = 1024**3
NETWORK_ATTEMPTS = 4


@dataclass(frozen=True, slots=True)
class RemoteGranule:
    """One file advertised by a LAADS monthly-directory CSV."""

    name: str
    observation_date: str
    size: int
    url: str


def month_starts(start_year: int, end_year: int, *, today: date) -> list[date]:
    """Return available month starts, excluding future months."""

    if start_year > end_year:
        raise ValueError("start year must not be after end year")
    months: list[date] = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            item = date(year, month, 1)
            if item <= today:
                months.append(item)
    return months


def directory_csv_url(month: date) -> str:
    doy = month.timetuple().tm_yday
    return f"{ARCHIVE_ROOT}/{month.year}/{doy:03d}.csv"


def select_tile_row(csv_text: str, *, month: date, tile: str) -> RemoteGranule:
    """Select exactly one Collection 2 tile from a LAADS directory listing."""

    acquisition = f"A{month.year}{month.timetuple().tm_yday:03d}"
    expected = f"VNP46A3.{acquisition}.{tile}.002."
    matches = [
        row
        for row in csv.DictReader(io.StringIO(csv_text))
        if row.get("name", "").startswith(expected)
        and row.get("name", "").endswith(".h5")
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one {expected}*.h5 file, found {len(matches)}"
        )
    row = matches[0]
    return RemoteGranule(
        name=row["name"],
        observation_date=month.isoformat(),
        size=int(row["size"]),
        url=row["downloadsLink"],
    )


def fetch_inventory(
    start_year: int,
    end_year: int,
    *,
    tile: str = "h30v07",
    today: date | None = None,
) -> list[RemoteGranule]:
    """Read official LAADS CSV listings and return the requested tile files."""

    effective_today = today or date.today()
    inventory: list[RemoteGranule] = []
    months = month_starts(start_year, end_year, today=effective_today)
    for index, month in enumerate(months, start=1):
        url = directory_csv_url(month)
        csv_text = _read_text_with_retries(url)
        inventory.append(select_tile_row(csv_text, month=month, tile=tile))
        print(f"Inventory [{index}/{len(months)}]: {month:%Y-%m}")
    return inventory


def _read_text_with_retries(url: str) -> str:
    """Read an HTTPS text resource, retrying transient connection failures."""

    last_error: Exception | None = None
    for attempt in range(1, NETWORK_ATTEMPTS + 1):
        try:
            request = Request(url, headers={"User-Agent": "CSTAR-Energy/1.0"})
            with urlopen(request, timeout=60) as response:  # noqa: S310 - fixed HTTPS host
                return response.read().decode("utf-8-sig")
        except (HTTPError, URLError, ConnectionError, TimeoutError) as exc:
            last_error = exc
            if attempt < NETWORK_ATTEMPTS:
                delay = 2 ** (attempt - 1)
                print(
                    f"NASA connection failed (attempt {attempt}/{NETWORK_ATTEMPTS}); "
                    f"retrying in {delay}s"
                )
                time.sleep(delay)
    raise RuntimeError(f"Could not read NASA listing {url}: {last_error}") from last_error


def is_complete_local_file(path: Path, expected_size: int) -> bool:
    return (
        path.is_file()
        and path.stat().st_size == expected_size
        and has_hdf5_signature(path)
    )


def required_download_bytes(inventory: list[RemoteGranule], destination: Path) -> int:
    return sum(
        item.size
        for item in inventory
        if not is_complete_local_file(destination / item.name, item.size)
    )


def assert_free_space(destination: Path, required_bytes: int) -> None:
    """Fail before transfer when the volume cannot hold the missing files."""

    probe = destination if destination.exists() else destination.parent
    free = shutil.disk_usage(probe).free
    minimum = required_bytes + FREE_SPACE_RESERVE_BYTES
    if free < minimum:
        raise RuntimeError(
            f"Insufficient disk space: {free / 1024**3:.2f} GB free; "
            f"at least {minimum / 1024**3:.2f} GB required including reserve"
        )


def download_granule(item: RemoteGranule, destination: Path, token: str) -> str:
    """Download one file atomically, or report that it is already complete."""

    target = destination / item.name
    if is_complete_local_file(target, item.size):
        return "skipped"
    partial = target.with_suffix(target.suffix + ".part")
    request = Request(item.url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(request, timeout=120) as response, partial.open("wb") as stream:  # noqa: S310
            while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                stream.write(chunk)
    except (HTTPError, URLError) as exc:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Download failed for {item.name}: {exc}") from exc
    if not is_complete_local_file(partial, item.size):
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"NASA response was incomplete or not HDF5: {item.name}")
    partial.replace(target)
    return "downloaded"


def write_inventory(inventory: list[RemoteGranule], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "source": ARCHIVE_ROOT,
                "product": "VNP46A3",
                "collection": "002",
                "records": len(inventory),
                "total_bytes": sum(item.size for item in inventory),
                "files": [asdict(item) for item in inventory],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def load_inventory(
    path: Path,
    *,
    start_year: int,
    end_year: int,
    tile: str,
    today: date | None = None,
) -> list[RemoteGranule]:
    """Load and filter a previously verified archive inventory."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("product") != "VNP46A3" or payload.get("collection") != "002":
        raise RuntimeError(f"Unsupported inventory product or collection: {path}")
    effective_today = today or date.today()
    inventory = [RemoteGranule(**item) for item in payload.get("files", [])]
    selected = [
        item
        for item in inventory
        if start_year <= date.fromisoformat(item.observation_date).year <= end_year
        and date.fromisoformat(item.observation_date) <= effective_today
        and f".{tile}.002." in item.name
    ]
    expected = month_starts(start_year, end_year, today=effective_today)
    if len(selected) != len(expected):
        raise RuntimeError(
            f"Cached inventory has {len(selected)} requested records; "
            f"expected {len(expected)}. Run again with --refresh-inventory."
        )
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year", type=int, default=date.today().year)
    parser.add_argument("--tile", default="h30v07")
    parser.add_argument("--output", type=Path, default=Path("BlackMarbles"))
    parser.add_argument(
        "--inventory-output",
        type=Path,
        default=Path("data/processed/radiance/nasa_archive_inventory.json"),
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="inventory available files without downloading",
    )
    parser.add_argument(
        "--refresh-inventory",
        action="store_true",
        help="ignore the cached inventory and query every NASA monthly listing",
    )
    args = parser.parse_args()

    if args.inventory_output.is_file() and not args.refresh_inventory:
        inventory = load_inventory(
            args.inventory_output,
            start_year=args.start_year,
            end_year=args.end_year,
            tile=args.tile,
        )
        print(f"Using cached NASA inventory: {args.inventory_output}")
    else:
        inventory = fetch_inventory(args.start_year, args.end_year, tile=args.tile)
        write_inventory(inventory, args.inventory_output)
    missing_bytes = required_download_bytes(inventory, args.output)
    print(
        f"NASA inventory: {len(inventory)} monthly files; "
        f"{missing_bytes / 1024**3:.2f} GB missing"
    )
    if args.list_only:
        print(f"Wrote {args.inventory_output}")
        return

    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        sys.exit(
            f"Set {TOKEN_ENV} in this PowerShell session before downloading. "
            "Do not put the token in source code or command history."
        )
    args.output.mkdir(parents=True, exist_ok=True)
    assert_free_space(args.output, missing_bytes)
    counts = {"downloaded": 0, "skipped": 0}
    for index, item in enumerate(inventory, start=1):
        status = download_granule(item, args.output, token)
        counts[status] += 1
        print(f"[{index}/{len(inventory)}] {status}: {item.name}")
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
