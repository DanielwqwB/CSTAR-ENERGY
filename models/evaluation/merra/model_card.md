# MERRA-2 next-hour T2M baseline

## Scope

This model predicts Philippines-wide area-averaged next-hour MERRA-2 `T2M`.
It is a pipeline and evaluation baseline for Developer 3; it is not a TROPOMI
NO2 model, local plume model, or transition-mechanism classifier.

## Selected model

- Model: `hist_gradient_boosting`
- Test MAE: `0.0133 K`
- Test RMSE: `0.0191 K`
- Test R2: `0.9997`
- MAE improvement over persistence: `86.72%`
- Acceptance gate passed: `True`

## Validation design

- Training: 2016-2023
- Validation/model selection: 2024
- Held-out test: 2025 through September 2026
- No random row split was used.
- Split periods are assigned by the next-hour target timestamp.

## Classification diagnostic

The confusion matrix converts actual and predicted next-hour temperature
changes into cooling, stable, and warming classes using a 0.1 K threshold.
Its accuracy is a secondary diagnostic only and must not be reported as
TROPOMI, CCTF, or infrastructure-transition accuracy.

## Limitations

The source CSVs are area averages for the bounding box 116E-127E, 4N-22N.
They contain no local spatial grid and cannot support local wind/plume claims.
