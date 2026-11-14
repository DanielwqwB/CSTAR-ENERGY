# CSTAR—ENERGY

React Native + TypeScript frontend adapted from the supplied [Figma reference](https://olive-export-07938535.figma.site/). Built with Expo for Android, iOS, and web, using native components rather than embedding the website in a WebView.

## Run

Run the commands below from `app/mobile` (use `cd app/mobile` from the repository root). Frontend source, assets, dependencies, and tests are isolated here from the repository's Python/backend folders.

Requirements: Node.js 20.19+ and npm (Node 22.18+ or 24 for tests). This project uses Expo SDK 54; use a matching Expo Go client or a development build.

```sh
npm install
npm start
```

Scan the development QR code with a compatible Expo Go client, or run:

```sh
npm run android    # Android emulator / connected device
npm run ios        # iOS simulator, requires macOS + Xcode
npm run web        # Browser preview
```

On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks `npm.ps1`. Android requires an installed emulator/SDK. Windows cannot launch the iOS simulator.

Choose **Open demo workspace**, or enter any valid email and any demo password containing at least four characters. No password is transmitted or saved. Remembered access is a local convenience, not secure authentication.

## File organization

```text
App.tsx                         App providers and screen selection
index.ts                        Expo entry point
assets/city-night.jpg            Bundled reference sign-in photograph
src/
  components/                   Shared controls, shell, maps, charts, event list
  context/WorkspaceContext.tsx  Navigation, event state, profile, local persistence
  data/                         Reference events, sample series, datasets, navigation
  screens/                      Sign-in and the 14 workspace sections
  utils/                        Catalogue filtering and platform-specific exports
  theme.ts                      Shared colors and typography
  types.ts                      Typed domain models
tests/                          Event filtering and CSV export tests
```

## Implemented

- Reference navy/cyan styling, city photograph, grouped sidebar, collapsible desktop navigation, mobile drawer, and safe-area support.
- Demo sign-in, sign-out, remembered access, and a six-step guided tour.
- Intelligence overview, transition map, and searchable/filterable event catalogue.
- Event investigation, editable review status, saved analyst notes, and verification flags.
- Evidence timeline, source–plume screening, descriptive counterfactual chart, and CCTF assessment.
- Dataset explorer, locally added intervention records, research analytics readiness, and derived alerts.
- JSON, CSV, and text reports: file download on web; native share sheet on Android/iOS.
- Local profile and study-region preferences, persisted with AsyncStorage.

## Checks

```sh
npm run typecheck
npm test
npx expo install --check
npm run build:web
npx expo export --platform all
```

`expo export` checks JavaScript bundling; it does not replace testing an installed native application.

## Scope and integration points

This is a frontend research demonstration. The four events, five dataset entries, historical series, and scientific caveats come from the supplied reference. Maps are interactive SVG diagrams, not geographic basemaps. Charts are illustrative; changing a comparison cohort does not run a model. There are no live satellite feeds, backend authentication, actual user administration, processing jobs, or validated attribution results.

Replace bundled fixtures and local state in `WorkspaceContext.tsx` with API-backed services when a backend is available. Authentication should be implemented separately before production use. Local state uses the key `cstar-workspace-v1`; sign-out clears remembered access while retaining saved research work.

Reference adaptations: desktop layouts adapt to native mobile controls; exports use native sharing instead of browser printing; configuration values without a processing backend are read-only; the dark reference theme is retained. Automated browser preview was unavailable during implementation, so pixel-perfect visual parity is not verified. Device interaction and visual QA remain to be performed.

Photograph: Dennis Kummer / Unsplash, using the same image as the supplied reference. The bundled asset loads without an external image request.
