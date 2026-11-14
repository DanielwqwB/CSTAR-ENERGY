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
- Regional overview, interactive Mapbox basemap, selectable event markers, event search and filters.
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

The four events, five dataset entries, and historical series are synthetic reference data. Mapbox provides a real geographic basemap, but the fictional Aurelia events are placed in Bicol Region only for demonstration. Their positions, lighting cells, and atmospheric footprints are not verified observations. Comparison selectors do not run scientific models. Cookie sessions and optional configured account sign-in are connected. Live satellite feeds, multi-user account administration, and scientific processing remain unconnected.

## Mapbox configuration

Copy `.env.example` to `.env.local` and set `VITE_MAPBOX_ACCESS_TOKEN` to your public Mapbox browser token. Restart Vite after changing it. The supplied token is configured locally; `.env.local` is ignored by Git. For deployment, set the same variable before building. Vite exposes this public token to the browser as required by Mapbox.

The map uses Mapbox's light basemap, zoom/compass controls, metric scale, numbered, clickable demonstration markers, and toggleable GeoJSON overlays. A resize observer keeps the canvas aligned when the sidebar or window changes size. If map resources or WebGL are unavailable, an explanation and selectable event list remain available. Demonstration geometry is defined in `src/data/mapGeometry.ts`; replace it with verified geographic coordinates when available.

Development API requests are proxied by Vite to port 3001. Production hosting must route `/api` to the backend under the same origin.

Sign-in photograph: Dennis Kummer / Unsplash, using the image from the supplied reference.
