# Black Marble baseline evaluation

Run `python experiments/radiance_baseline.py` from the repository root. The
script writes `metrics.json` and `test_predictions.csv` here using observed
VNP46A3 radiance only. The model checkpoint is saved separately in
`models/checkpoints/blackmarble/`.

Presentation-only multimodal results remain under
`artifacts/radiance_multimodal_demo/`; they use simulated radiance months and
are not scientific evaluation results.
