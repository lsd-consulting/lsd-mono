# LSD Report

Report UI for **lsd-mono-core**. Sources live in `modules/lsd-mono-core/report`. The parent module's Gradle build runs this package (`reportSingle`, `reportTest`) and packages `dist/lsd-report.html` into the jar as `lsd-report.single.html`. Build output is not committed. The JVM façade injects captured `ReportJson` as `window.__LSD_REPORT__`. Opening the shell with no payload falls back to the sample report.

This is the live UI, not a separate experiment, and it is not published on its own.

## Tests

Virtualisation math (row window from `scrollTop` + viewport, overscan, sticky header) lives in `src/lib/layout.ts` and is locked by `src/lib/layout.test.ts`.

```bash
cd modules/lsd-mono-core/report
npm ci
npm test
```

Axe and screenshot checks are separate from vitest (Playwright downloads nothing extra when the 1.55 Chromium cache is already present):

```bash
cd modules/lsd-mono-core/report
npm run check:ux
```

Vitest is also on `./gradlew :modules:lsd-mono-core:build` via `reportTest`. `npm run check:ux` stays manual, because its baselines are macOS screenshots and Linux CI renders fonts differently (see `docs/ci.md`). Use Node 22.6 or later (`engines` in `package.json`). Each diagram opens fitted to its panel, shrinking a wide one but never enlarging past 100%. It refits when the panel width changes until you zoom in or out; Fit fills the width and turns refitting back on. Sections are `kind: "section"` rows with a jump list; the diagram stays one continuous scrollport with a sticky participant header.

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
| Tooling | **Vite 7 + TypeScript** | Fast local DX; `base: './'` for `file://` / CI artifact drops |
| Runtime | **Vanilla TS** (no React/Vue) | Tiny shipped JS; reports stay self-contained |
| Diagrams | **Custom SVG** from domain events | CSS and accessibility control, clickable messages, activations, notes, dividers — no PlantUML or Mermaid runtime in the browser |
| Colour | **OKLCH tokens** + dark/light/high contrast | `d` or the theme button cycles dark → light → high contrast. Persisted as `lsd-report-theme`. Print uses a light page. |
| Inspector | **Side panel** | Keeps the diagram active; lazy payloads, copy, focus return, and `#msg=` deep links |
| Typography | Geist → system-ui fallback | Product feel when online; readable offline via system fonts |
| State | In-memory filter/selection | Enough for the report shell; no UI framework |

The shell does not depend on PlantUML, so diagram UX is not tied to golden SVG output from that engine.

## Compared with legacy lsd-core

| Capability | lsd-core today | report |
|------------|----------------|-------------|
| Sequence look | PlantUML mono SVG | Custom SVG with participant cards, activation bars, duration chips, glow-on-hover |
| Message detail | CSS `:target` hash overlays | Side inspector + lazy payload + copy + type/from→to pills |
| Navigation | Sticky chips + jump menu | Sidebar + status histogram + `j`/`k` keyboard nav, diagram Up/Down/Enter, minimap, and deep links |
| Search | Scenario title filter | Title + description + facts, plus in-diagram message/note find |
| Theme | Light-only GitHub-ish tokens | Dark-first + light + high contrast, persisted |
| Mobile | Improved in the shell refresh | Sidebar collapses to grid; toolbar wraps; diagram scrolls horizontally |
| Offline chrome | CDN d3 / hljs / mark.js unless assets are embedded | No diagram CDN; fonts optional |
| Accessibility | Partial | Focus rings, `aria-pressed` / `aria-current`, one tab stop with message navigation, real position metadata, reduced-motion, and axe checks |

Remaining gaps: sprite includes and full PlantUML colour/skinparam fidelity are intentionally out; payload pretty-print/size limits and density modes remain open. Sections, short arrows, notes, delays, spacers, clickable arrows, the in-page component diagram, and the major accessibility checks are shipped.

## Sample data

`src/data/sample-report.ts` mirrors multi-scenario reports:

1. **success** — happy-path checkout (reserve → pay → event)
2. **warn** — payment timeout + retry
3. **error** — insufficient stock → 409, payment skipped

The shape stays close to `ScenarioModel` + `SequenceEvent` / `Message` / `DataHolder` so the JVM `ReportJson` writer can feed the same shell. Captured reports come from the parent façade; this file is only the no-payload demo.

## Keyboard

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `j` / `k` | Next / previous scenario |
| `Enter` | Open / close selected |
| `d` | Cycle theme: dark, light, high contrast (`HC`) |
| `?` | Help |
| `Esc` | Close dialog / help / blur search |

Inside the diagram, Tab lands once, then Up and Down move between messages and Enter opens the inspector.
