# Philippines TROPOMI NO2 training dataset

This directory contains the Philippines-priority TROPOMI nitrogen-dioxide
training extract for CSTAR-Energy.

## Coverage and source

- Period: 2019-01-01 through 2025-12-31
- Extraction envelope: 116-127 degrees east, 4-22 degrees north (WGS84)
- Output grid: 0.1 degree
- Source product: Sentinel-5P TROPOMI Level-2 tropospheric NO2
- Processing streams: RPRO preferred, OFFL fallback
- Source archive: https://registry.opendata.aws/sentinel5p/
- Copernicus product reference:
  https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel5P.html
- Quality rule: `qa_value >= 0.75`; values below -0.001 mol/m2 are excluded as
  outliers while valid negative retrievals are retained.

The extractor reads only the Philippine window from public cloud-optimized
orbit files. It does not store the roughly 600 MB global NetCDF file for every
orbit.

## Files

- `tropomi_no2_2019-01-01_2025-12-31.csv.gz` - combined training table.
- `monthly/tropomi_no2_YYYY-MM.csv.gz` - resumable monthly tables.
- `monthly/*.manifest.json` - source orbit keys, counts, settings, and failures.
- `tropomi_extraction_summary.json` - run-level provenance and status.
- `SHA256SUMS.txt` - integrity hashes for generated tables and manifests.

## Columns

- `month` - calendar month in `YYYY-MM` form.
- `cell_id` - stable cell identifier within the extraction envelope.
- `longitude`, `latitude` - 0.1-degree cell center in WGS84.
- `tropospheric_no2_mean_mol_m2` - monthly mean tropospheric NO2 column.
- `tropospheric_no2_std_mol_m2` - within-month pixel standard deviation.
- `qa_mean` - mean quality value after filtering.
- `valid_pixel_count` - number of accepted source pixels.
- `valid_orbit_count` - number of daily orbit observations contributing.
- `source_product` - source product description.

## Scientific boundary

This is a gridded training fallback and does not preserve native Level-2 pixel
corner polygons. Use the native Level-2 NetCDF product later for the final
footprint map and source-plume visualization. The national envelope also
contains surrounding water and small neighboring areas; subset it to the
selected pilot locality or an approved Philippines boundary during feature
preparation.

## 2026 forward holdout

`forward_holdout_2026/` contains the separate January-September 2026 extract.
It is kept apart from the original 2019-2025 table. The original weather
models were not trained or selected on 2026; 2026 was later used as
development data to compare candidates, so January-September is not an
untouched test. The combined historical-plus-holdout table is
`forward_holdout_2026/combined_2019-2026-through-09.csv.gz`; its SHA-256 is
recorded in the evaluation `run_config.json`. Monthly extraction hashes and
source manifests are in the same folder.

`forward_holdout_2026_q4/` contains the separately extracted October 2026
TROPOMI table. It has 19,795 cells, 2,471,269 valid pixels, and zero extraction
failures; its `SHA256SUMS.txt` records the generated-file hashes. October has
not been used to compare or select candidates and is reserved for a frozen
temporal evaluation. The available local MERRA-2 exports currently end at
2026-09-30 23:30 UTC, and NASA CMR lists only the October 1 hourly granule for
the requested MERRA-2 product. Since the weather model requires a complete
monthly MERRA summary, do not score the frozen weather candidate on October
until matching full-month MERRA data is available.
