# LSD Report

Report UI for **lsd-mono-core**. Sources live in `modules/lsd-mono-core/report`. The parent module's Gradle build runs this package (`reportSingle`, `reportTest`) and packages `dist/lsd-report.html` into the jar as `lsd-report.single.html`. Build output is not committed. The JVM façade injects captured `ReportJson` as `window.__LSD_REPORT__`. Opening the shell with no payload falls back to the sample report.

It is not published on its own.

## Tests

Virtualisation math (row window from `scrollTop` + viewport, overscan, sticky header) lives in `src/lib/layout.ts` and is locked by `src/lib/layout.test.ts`.

```bash
cd modules/lsd-mono-core/report
npm ci
npm test
```

`npm test` runs Vitest with v8 coverage and fails below the thresholds in `vitest.config.ts`; the HTML report is in `../build/reports/coverage/report-ui/`. Before you push:

```bash
npm run typecheck   # tsc on the app (tsconfig.json), then on the tests, checks and configs (tsconfig.test.json)
npm run lint        # ESLint, then prettier --check
npm run format      # prettier --write
```

Markup is built from strings, so ESLint's `lsd/escaped-markup` rule (`lint/eslint-plugin-lsd.js`) requires every value interpolated into markup, `innerHTML` or `insertAdjacentHTML` to go through `src/lib/escape.ts`, be markup by name (`*Html`, `*Svg`), or be proven safe by its type (a number, or a string literal union such as `Status`). Escaping entities and markup-character replacements are rejected outside `escape.ts`.

Axe and screenshot checks are separate from vitest (Playwright downloads nothing extra when the 1.55 Chromium cache is already present):

```bash
cd modules/lsd-mono-core/report
npm run check:ux
```

Vitest is also on `./gradlew :modules:lsd-mono-core:build` via `reportTest`, and the type-check and lint via `reportLint`. `npm run check:ux` builds the single-file report first (`checks/offline.spec.ts` opens it from `file://`), then runs the checks. It is not on the Gradle build; CI runs it in its own job, without the `@screenshot` tests, whose baselines are macOS screenshots that Linux renders differently (see `docs/ci.md`). Use Node 22.6 or later (`engines` in `package.json`). Each diagram opens fitted to its panel, shrinking a wide one but never enlarging past 100%, and never below 95%, so labels stay readable (a wider diagram scrolls sideways, with a "More lanes" cue while lanes lie to the right; Out still goes to 25%). It refits when the panel width changes until you zoom in or out; Fit fills the width and turns refitting back on. Sections are `kind: "section"` rows with a jump list. A diagram taller than the screen extends the page: the stage is as tall as the drawing, the toolbar and participant header stay in view, and the page scroll drives the windowed painting (`src/lib/diagram/page-scroll.ts`). Horizontal scrolling stays inside the panel.

## Open the demo

From the repo root:

```bash
cd modules/lsd-mono-core/report
npm ci
npm run dev          # http://localhost:5173/
# or
npm run build && npm run preview   # http://localhost:4173/
```

**Chrome `file://` (single self-contained HTML):**

```bash
npm run build:single
# then open:
#   modules/lsd-mono-core/report/dist/lsd-report.html
# (its built-in demo loads dist/lsd-report-payloads.js, written beside it)
```

**Multi-file `dist/` after build** (Vite `base: './'`; prefer preview if modules are blocked on `file://`):

```bash
npm run build
# then open modules/lsd-mono-core/report/dist/index.html
```

| Mode | Path / URL |
|------|------------|
| Dev | `http://localhost:5173/` |
| Preview | `http://localhost:4173/` |
| Built static (multi-file) | `modules/lsd-mono-core/report/dist/index.html` |
| Chrome `file://` | `modules/lsd-mono-core/report/dist/lsd-report.html` |
| Source entry | `modules/lsd-mono-core/report/index.html` |

Gradle produces the same shell without a manual npm build:

```bash
./gradlew :modules:lsd-mono-core:reportSingle
```

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Tooling | **Vite 8 + TypeScript** | Fast local DX; `base: './'` for `file://` / CI artifact drops. Dependencies are pinned to exact versions (Renovate bumps them). Two TypeScript packages are installed on purpose: `@typescript/native` (TypeScript 7, `tsc`) and `typescript` (TypeScript 6, for typescript-eslint); see `docs/ci.md` |
| Runtime | **Vanilla TS** (no React/Vue) | Tiny shipped JS; reports stay self-contained |
| Diagrams | **Custom SVG** from domain events | CSS and accessibility control, clickable messages, activations, notes, dividers — no PlantUML or Mermaid runtime in the browser |
| Colour | **OKLCH tokens** + dark/light/high contrast | Until you choose, follows the OS live: `prefers-color-scheme` picks dark or light, and `prefers-contrast: more` picks high contrast. A head script sets it before first paint, so there is no flash. `d` or the theme button cycles Auto → dark → light → high contrast. A fixed choice is persisted as `lsd-report-theme` and wins over the OS; Auto clears it and resumes following the OS. The button names the mode, e.g. "A. Theme: Auto (dark)"; a text glyph (A, HC) leads the name so it matches what is shown. Print uses a light page. |
| Inspector | **Side panel** | Keeps the diagram active; lazy payloads, copy, focus return, and `#msg=` deep links |
| Usage ping | `src/lib/usage-ping.ts` | A release build's page requests one version-pinned jsDelivr file per event (`report-open`, `metrics-open`, `components-open`, `source-*`), once per page load, never awaited. Off when the report's `usagePing` option is not `true`, for snapshot versions, and on the dev server (checks opt in with `?lsd-usage-ping-check`). See the root README's "Usage ping" |
| Typography | Inter and JetBrains Mono, embedded | Latin variable fonts from `@fontsource-variable` (SIL Open Font License 1.1), inlined into the single-file report by `src/styles/fonts.css`, so it looks the same offline. About 115 KB of the file. Other scripts fall back to system fonts |
| State | One scenario at a time, in the URL hash | The sidebar chooses the scenario; only it is drawn. `#scenario=<id>` (or `#msg=<id>/<message>`) survives a reload or a shared link. Search, status filters and per-diagram views stay in memory |

The shell does not depend on PlantUML, so diagram UX is not tied to golden SVG output from that engine.

## Compared with legacy lsd-core

| Capability | lsd-core today | report |
|------------|----------------|-------------|
| Sequence look | PlantUML mono SVG | Custom SVG with participant cards, activation bars, duration chips, glow-on-hover |
| Message detail | CSS `:target` hash overlays | Side inspector + lazy payload + copy + type/from→to pills |
| Timing | Durations on arrows | Accuracy per scenario, summary strip, swim lanes and waterfall; clock-ordered and guessed-pairing badges |
| Navigation | Sticky chips + jump menu | Sidebar + status histogram + `j`/`k` keyboard nav, diagram Up/Down/Enter, and deep links |
| Search | Scenario title filter | Title + description + facts, plus in-diagram find over messages, notes and payloads |
| Theme | Light-only GitHub-ish tokens | Auto follows the OS (dark, light, more contrast); a fixed choice persists until you pick Auto again |
| Mobile | Improved in the shell refresh | Sidebar collapses to grid; toolbar wraps; diagram scrolls horizontally |
| Offline chrome | CDN d3 / hljs / mark.js unless assets are embedded | No network at all: script, styles and fonts are in the file. The only request is the optional usage ping (`checks/offline.spec.ts`) |
| Accessibility | Partial | Focus rings, `aria-pressed` / `aria-current`, one tab stop with message navigation, real position metadata, reduced-motion, and axe checks |

Not supported by design: PlantUML sprite includes and skinparam colours. Still open: a compact density mode. Sections, short arrows, notes, delays, spacers, clickable arrows, the in-page component diagram, and the major accessibility checks are shipped.

## Sample data

`src/data/sample-report.ts` mirrors multi-scenario reports:

1. **success** — happy-path checkout (reserve → pay → event)
2. **warn** — payment timeout + retry
3. **error** — insufficient stock → 409, payment skipped

The shape stays close to `ScenarioModel` + `SequenceEvent` / `Message` / `DataHolder` so the JVM `ReportJson` writer can feed the same shell. Captured reports come from the parent façade; this file is only the no-payload demo. Its JSON bodies are in `src/data/sample-payloads.ts`, loaded when the side panel or Find first needs them. Try Find with `snowdrop`: it is only in the checkout's payload (its voucher code), so it shows a payload match.

## Keyboard

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `j` / `k` | Next / previous scenario |
| `Enter` | Open / close selected |
| `d` | Cycle theme: Auto (`A`, follows the OS), dark, light, high contrast (`HC`) |
| `?` | Help |
| `Esc` | Close dialog / help / blur search |

Inside the diagram, Tab lands once, then Up and Down move between messages and Enter opens the inspector.

In the diagram's Find, Enter / Shift+Enter, F3 or Cmd/Ctrl+G step through the matches. Find also searches message payloads unless the `{}` button in the field (*Payloads*) is off.
