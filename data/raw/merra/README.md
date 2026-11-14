# MERRA-2 raw exports

Place NASA Giovanni area-average `M2T1NXSLV` CSV exports in this directory.
Raw CSV files are intentionally ignored by Git.

The current baseline expects these variables with a common hourly timeline:

- `CLDTMP`, `PS`, `T2M`, `TO3`, `TQV`, `TS`
- `U10M`, `V10M`, `U50M`, `V50M`

The loader preserves the Giovanni metadata, treats timestamps as UTC, and
rejects duplicate timestamps or duplicate variables. The current files are
Philippines-wide area averages and must not be represented as local gridded
meteorology.
