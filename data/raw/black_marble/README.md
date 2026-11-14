# Black Marble raw inputs

Place NASA VNP46A3 Collection 2 `.h5` granules here for the Bicol radiance
processor. `python -m modules.radiance.download` and
`python -m modules.radiance.analysis` use this directory by default.

Raw granules and partial downloads are ignored by Git. The existing processed
time-series manifest retains the original `BlackMarbles/` source path as
historical provenance; rerun processing here when raw granules are available.
`nasa_archive_inventory.json` is the downloader's cached source listing.
