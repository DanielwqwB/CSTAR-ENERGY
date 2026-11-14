# CSTAR—ENERGY frontend

Browser-only React + TypeScript application built with Vite. The interface is adapted from the supplied [design reference](https://olive-export-07938535.figma.site/).

## Development

Use Node.js 22.18+ or 24. From the repository root:

```sh
cd frontend
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Open the URL printed by Vite. `npm start` is also available.

Choose **Open demo workspace**, or enter any valid email and a demo password of at least four characters. This is frontend-only access; no password is stored or transmitted.

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
    context/                  Shared state and browser persistence
    hooks/                    Browser viewport hook
    data/                     Synthetic events, datasets, sample series
    utils/                    Filters and browser file exports
    types.ts                  Domain models
  tests/                      Data/export tests and browser interaction tests
```

## Functionality

- Responsive sidebar, navigation menu for narrow windows, and guided tour.
- Regional overview, interactive Mapbox basemap, selectable event markers, event search and filters.
- Event review, local analyst notes, evidence charts, plume screening, CCTF assessment.
- Data explorer, local intervention records, alerts, reports, and profile preferences.
- JSON, CSV, and text file downloads through browser APIs.
- Persistence in `localStorage` using `cstar-workspace-v1`. Sign-out clears remembered access while preserving research work.

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

The four events, five dataset entries, and historical series are synthetic reference data. Mapbox provides a real geographic basemap, but the fictional Aurelia events are placed in Bicol Region only for demonstration. Their positions, lighting cells, and atmospheric footprints are not verified observations. Comparison selectors do not run scientific models. Live satellite feeds, authentication, account management, and backend processing are not connected.

## Mapbox configuration

Copy `.env.example` to `.env.local` and set `VITE_MAPBOX_ACCESS_TOKEN` to your public Mapbox browser token. Restart Vite after changing it. The supplied token is configured locally; `.env.local` is ignored by Git. For deployment, set the same variable before building. Vite exposes this public token to the browser as required by Mapbox.

The map uses Mapbox's light basemap, zoom/compass controls, metric scale, numbered, clickable demonstration markers, and toggleable GeoJSON overlays. A resize observer keeps the canvas aligned when the sidebar or window changes size. If map resources or WebGL are unavailable, an explanation and selectable event list remain available. Demonstration geometry is defined in `src/data/mapGeometry.ts`; replace it with verified geographic coordinates when available.

Browser storage is scoped to the origin. Data saved on a previous Expo web port will not automatically appear on Vite's port.

Sign-in photograph: Dennis Kummer / Unsplash, using the image from the supplied reference.
