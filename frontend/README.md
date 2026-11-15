# CSTAR-Energy frontend

The active React and TypeScript workspace presents the generated Black Marble
dataset and its existing spatial Random Forest outputs. It does not display
synthetic event records or infer transition causes.

## Development

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite. Verify changes with:

```powershell
npm.cmd run typecheck
npm.cmd run test:ui
npm.cmd run build
```

## Workspace views

- Dashboard pages fit the desktop viewport with side information panels.
  AI Analytics and Cell Screening can scroll internally when their content
  exceeds the available space. On narrow screens, panels flow into a single
  page column.
- **Intelligence overview:** rotating Mapbox globe, with location-specific
  observed values and the trained cell-level forecast in side panels. Scroll or
  pinch to zoom and drag to rotate; the AI Analytics checklist toggles available
Black Marble, Sentinel-5P TROPOMI, and Random Forest map layers. TROPOMI is
available for Bicol by month from January 2019 through December 2025 as
QA-screened 0.1° grid cells; they are not native satellite footprints.
MERRA-2 hourly U10M/V10M data is available as monthly wind-component context,
averaged over the supplied Giovanni bounding box; it is not shown as a
cell-level map layer. Sentinel-2 remains disabled until a real imagery source
is configured. Unloaded datasets and models are not represented with
placeholder data. AI Insights distinguish observed radiance from forecasts,
compare the selected cell with an earlier month when both cell observations
are available, and state model limitations and verification steps. Basemap
terrain shading and boundaries add context without creating radiance
observations.
- **Regional transition map:** synchronized baseline and current Black Marble
  maps, observed/forecast selection, month controls, and a fixed right sidebar
  for model validation and selected-cell details.
- **Observation coverage:** calendar-month availability from the generated
  manifest; absent months are not interpolated.
- **Model evaluation:** holdout metrics and limitations read from the same
  manifest as the map.
- **Data provenance:** region bounds, product, quality rule, data formats, and
  model features from that manifest.

## Admin portal

Authenticated accounts with the `ADMIN` role are routed to `/admin/dashboard`.
The portal loads its dashboard, users, jurisdictions, reports, dataset catalog,
publication list, health status, and audit history from the backend API. User
and report changes and jurisdiction creation are submitted to their
corresponding admin endpoints; backend role guards remain the authorization
boundary.

Controls are shown only for operations supported by the current API. Password
resets, jurisdiction editing and archiving, satellite ingestion/retries,
publication workflow changes, and expanded infrastructure monitoring are not
implemented in the current backend and are not presented as working actions.
Non-admin roles that visit `/admin/*` receive an access-denied view.

## Data and map setup

The browser reads `/data/blackmarble/manifest.json` and the compressed grid,
observation, and forecast assets in `public/data/blackmarble/`. Regenerate
these files from the quality-screened VNP46A3 source data with the spatial
forecast command documented in the repository root README.

The TROPOMI globe layer reads its monthly grid from
`public/data/tropomi/manifest.json` and the compressed GeoJSON files beside it.
Regenerate these Bicol-only assets from the root `TROPOMI NO₂` monthly exports
with `node experiments\prepare_tropomi_globe.mjs`. The exports preserve monthly
NO₂ column means, standard deviations, QA means, and valid observation counts.
They do not contain native pixel footprints. The workspace has no Sentinel-2
imagery assets or Copernicus provider configuration, so that layer stays
unavailable rather than showing unrelated or fabricated data.

The MERRA-2 context reads `public/data/merra/manifest.json`, generated from the
NASA Giovanni U10M/V10M area-average exports in the root `Giovani` folder with
`node experiments\prepare_merra_context.mjs`. The hourly wind components are
reduced to monthly regional means over the export bounding box and are never
represented as local or cell-level measurements.

Set `VITE_MAPBOX_ACCESS_TOKEN` in `frontend/.env.local` for the interactive
globe, basemap, and optional reverse geocoding. The map uses only the region,
months, observations, and forecasts described by the generated manifest.
Forecasts remain exploratory screening outputs; probabilities are not
calibrated and do not establish causal impact.
