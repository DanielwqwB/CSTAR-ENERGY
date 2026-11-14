# TROPOMI NO₂ band training

This stage uses monthly Philippine TROPOMI observations. MERRA is reserved for
the later weather-adjustment stage. The three band cutoffs (8.002 and
12.183 µmol/m²) are fitted on 2019-2023 observations and remain
fixed. Models fit 2020-2023; 2024 selects the winner; 2025 is the locked test.

Historical features contain only earlier observations: 2024 validation uses
history through 2023, and 2025 test uses history through 2024. No 2025 target
value becomes a feature. Missing months are kept missing, and every valid
held-out cell-month contributes to accuracy.

- Climatology 2025 accuracy: 68.48%; balanced accuracy 69.31%; macro F1 68.93%.
- Best 2024 candidate: `annual_blend_25`. Its 2025 accuracy is 68.19%; balanced accuracy 69.04%; macro F1 68.63%.
- Selected by 2024 validation: `spatial_seasonal_climatology`; selected 2025 accuracy 68.48%.
- The 90% full-coverage band target was met: `False`.
- Total run time: 35.0 seconds.

This classifies NO₂ concentration bands. It does not estimate weather-adjusted
anomalies; the existing regression evaluation remains separate. The 2025
period was inspected in earlier work, so it is a locked temporal test rather
than a never-seen blind test. See `band_model_comparison.csv` and the two confusion
matrices for the full comparison.
