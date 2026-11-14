# CSTAR—ENERGY frontend

React + TypeScript application connected to the local workspace API built with Vite. The interface is adapted from the supplied [design reference](https://olive-export-07938535.figma.site/).

## Development

Use Node.js 22.18+ or 24. From the repository root:

```sh
cd frontend
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Open the URL printed by Vite. `npm start` is also available.

Configure Supabase using [backend setup](../backend/README.md), then start the API in a second terminal (`cd backend` then `npm.cmd run dev` from the repository root). Sign in with an email/password account from your Supabase project. **Open demo workspace** requires anonymous sign-ins and `DEMO_ACCESS=true`.

## Project layout

```text
frontend/
  index.html                  Browser entry document
  App.tsx                     App providers and screen selection
  vite.config.ts              Development and production build
  assets/city-night.jpg        Bundled sign-in photograph
  src/
    main.tsx                  React DOM entry point
    styles.css                Browser styles and responsive layout
    styles.ts                 Typed CSS style composition
    theme.ts                  Shared palette and typography
    components/               HTML controls, sidebar, SVG charts and map
    screens/                  Sign-in and all 14 workspace sections
    context/                  Shared state and API persistence
    hooks/                    Browser viewport hook
    data/                     Synthetic events, datasets, sample series
    utils/                    Filters and browser file exports
    types.ts                  Domain models
  tests/                      Data/export tests and browser interaction tests
```

## Functionality

- Responsive sidebar, navigation menu for narrow windows, and guided tour.
- Regional overview with a rotating Black Marble globe, location-linked cell details, interactive Mapbox maps, selectable event markers, event search and filters.
- Event review, persisted analyst notes, evidence charts, plume screening, CCTF assessment.
- Data explorer, persisted intervention records, alerts, reports, and profile preferences.
- JSON, CSV, and text file downloads through browser APIs.
- Persistence through `/api/workspace` in Supabase PostgreSQL, with one private workspace per Auth user. Sign-out clears the cookie session while preserving research work. Old localStorage and SQLite data are not automatically imported.

There are no React Native or Expo runtime dependencies. Charts use standard SVG, forms use HTML inputs/selects/textareas, and icons use Lucide React. This project does not produce Android or iOS apps.

## Verification and build

```sh
npm run typecheck
npm test
npm run test:ui
npm run build
npm run preview
```

The production site is written to `dist/`. UI tests use React Testing Library and jsdom; they verify browser interactions but do not replace visual inspection in an actual browser.

## Data scope

The map uses quality-screened monthly NASA VNP46A3 Collection 2 Black Marble
observations for Bicol Region (75 usable months from 2016-01 through 2026-10).
The 2026-11 source granule contains no valid cells and is excluded. Its Random
Forest makes an exploratory one-calendar-month-ahead
prediction at each fixed land cell, with chronological held-out results
included in the map data. This screening model is not a causal impact model,
its probabilities are not calibrated, and its performance is not a guarantee
for an individual location. Only months present in the irregular source archive
are selectable; forecast months are identified in the controls. Click a map
cell to view its coordinates, radiance, source observation count, and available
forecast screening values. Event pins and atmospheric footprints elsewhere in
the interface remain illustrative. Cookie sessions and optional configured
account sign-in are connected. Live satellite feeds and multi-user account
administration remain unconnected.

## Mapbox configuration

Create `frontend/.env.local` with `VITE_MAPBOX_ACCESS_TOKEN=<your-public-token>`. Restart Vite after changing it. `.env.local` is ignored by Git. For Render or another deployment, set `VITE_MAPBOX_ACCESS_TOKEN` in the hosting service's build environment and redeploy; a local `.env.local` does not configure the hosted site. Restrict the public token to the required URL origins in Mapbox.

The overview uses a slowly rotating Mapbox globe; clicking pauses it and updates
the side panels for a selected cell. The full-screen map retains synchronized,
resizable comparison panels, scroll zoom, zoom/compass controls, a metric scale,
and connected radiance layers. Month selectors distinguish observations from
forecasts. The Black Marble cell data covers Bicol only; other globe locations
show that coverage limitation. If map resources or WebGL are unavailable, an
explanation remains available. Demonstration event geometry is defined in
`src/data/mapGeometry.ts`.

Development API requests are proxied by Vite to port 3001. Production hosting must route `/api` to the backend under the same origin.

Sign-in photograph: Dennis Kummer / Unsplash, using the image from the supplied reference.
