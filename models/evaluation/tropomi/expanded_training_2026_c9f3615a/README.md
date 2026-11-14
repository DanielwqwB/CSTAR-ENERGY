# TROPOMI weather experiment

The fixed monthly Philippines experiment trained on 2019-2023, selected a
candidate on January-June 2024, calibrated a 90% interval on July-September
2024, checked interval coverage on October-December 2024, and evaluated 2025
once in this fixed run. Earlier baseline work already inspected 2025, so this
is a locked temporal test rather than a never-seen blind test. The source
TROPOMI table contains monthly cell means; MERRA weather is a
Philippines-wide area average, so 05:30 UTC summaries cannot be matched to
each cell's exact valid orbit dates.

The climatology uses 2019-2023. Residual regressors fit 2020-2023 examples:
each training-row climatology and neighbor prior uses strictly earlier years,
with 2019 supplying the first prior.

## Result

- Selected: `spatial_seasonal_climatology`; best weather candidate: `ensemble_spatial_weather`.
- Candidate validation MAE: 2.225 µmol/m².
- January-June 2024 selection MAE: candidate 2.317
  versus climatology 2.160 µmol/m².
- Candidate test MAE: 2.200 µmol/m²; test change versus climatology: +7.34%.
- Weather beat its matched no-weather control on the selection period: `True`.
- The 5% test MAE condition was met: `True`.
- The full weather-adjustment gate passed: `False`.
- Anomaly interpretation: `climatology residual`.
- Empirical 90% interval coverage on October-December 2024: 90.7%.
- Empirical interval coverage on 2025: 87.6%.

The weather claim requires the fixed 5% test MAE improvement, R² at least
0.70, and selection-period MAE better than both climatology and the matched
no-weather control. This candidate lost to climatology in January-June 2024,
so its 2025 gain cannot be used to select it after seeing the test result. A
year trend alone cannot establish a weather correction. Climatology remains
the predictor and significant anomalies are only climatology residuals outside
the calibrated interval.

## Diagnostics

- Largest selected-model errors by month: 2025-03, 2025-10, 2025-04.
- Largest selected-model errors by cell ID: x0050_y0105 (n=11), x0050_y0106 (n=8), x0049_y0106 (n=11).
- Sparse observation count: 5-9 valid-orbit cell-months have MAE 2.630 µmol/m².
- Top permutation features of the best weather candidate: training_baseline_no2_umol_m2, neighbor_prior_no2_umol_m2, merra_0530_wind_speed_10m_mean, merra_u10m_std, merra_wind_speed_50m_std.
- Positive bias means overprediction; the current selected test bias is +0.616 µmol/m².
- The observed 2025 mean is 10.775 µmol/m²
  versus 11.399 µmol/m² for the
  2019-2023 annual-mean average. The test year is lower, consistent with the
  positive baseline bias. Sampling coverage changes, so this is not proof of
  a physical long-term trend.
- Observed yearly means and coverage counts are in `mean_no2_by_year.csv`;
  varying coverage makes their trend descriptive, not causal.

See `model_comparison.csv`, `feature_importance.csv`, `error_by_month.csv`,
`error_by_year.csv`, `error_by_valid_count.csv`, `error_by_cell.csv`, and `plots/`.
The per-cell monthly observation counts, including explicit zero counts, are
in `observation_counts.csv.gz`. Classification band accuracy is a secondary
diagnostic, not the accuracy of NO₂ regression or CCTF source attribution.


## Forward holdout

- Year: 2026; evaluated months: 2026-01, 2026-02, 2026-03, 2026-04, 2026-05, 2026-06, 2026-07, 2026-08, 2026-09.
- Rows: 19,900; candidate selected on 2024 validation:
  `ensemble_spatial_weather`.
- Climatology MAE: 2.958 µmol/m²;
  candidate MAE: 2.355 µmol/m².
- Matched no-weather control `ensemble_spatial_control` MAE:
  2.392 µmol/m².
- Candidate MAE improvement versus climatology:
  +20.38%.
- Weather MAE improvement versus matched control:
  +1.54%.

This later-year score is reported only after model selection and is not used to
change the fixed weather-model selection or acceptance gate.


## Expanded-training development

- Training years: 2020-2025.
- Best refit candidate: `ensemble_spatial_weather`; MAE:
  2.325 µmol/m².
- Best weather candidate: `ensemble_spatial_weather`; matched control: `ensemble_spatial_control`; weather MAE improvement over control: +23.67%.
- 2026 was used for development comparison, not independent testing or
  production selection.
