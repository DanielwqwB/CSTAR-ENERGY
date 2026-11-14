# CSTAR Energy observed-data multimodal prototype

## Scope

This prototype aligns Black Marble nighttime radiance, Bicol-cropped TROPOMI NO2, and Giovanni/MERRA-2 weather features on a monthly timeline. Synthetic and presentation-only radiance rows are excluded. The regression test MAPE is **28.69%**, with MAE **0.0539** and RMSE **0.0683**.

The persistence baseline MAPE is **40.06%**.

## Classification results

- Accuracy: **66.67%**
- Precision: **75.00%**
- Recall: **60.00%**
- Specificity: **75.00%**
- F1 score: **66.67%**

- Majority-class baseline accuracy: **55.56%**

- ROC AUC: **0.8000**

The 95% Wilson interval for accuracy is **35.4%–87.9%**. Accuracy was outside the requested 65–75% range during expanding-window validation and inside that range on the held-out test. Classification uses consecutive calendar-month Black Marble pairs only with a fixed 0.5 classifier threshold. The target is still not an independently verified lighting-transition label. The small holdout is exploratory and must not be described as validated real-world performance.
