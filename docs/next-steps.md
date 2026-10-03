# LSD Mono — next steps

**Status:** local `main` only. P0–P2 porting slices through `41423cf` are in `docs/porting-gap.md`. This file is the runbook for what comes after that. Nothing here has been run yet.

Do these in order. Do not start 2 until 1 has recorded numbers. Do not start 3 until 1 is done.

---

## 1. Browser performance check vs legacy (first)

Compare the greenfield report-next shell with legacy PlantUML HTML on the **same** synthetic scenario. Documentation only until someone runs it. Do not invent results.

### Fixture (both sides)

One scenario, four participants: `Client`, `Api`, `Payments`, `Database`.

Repeat this cycle until the event count is exact:

1. `Client` → `Api` synchronous, label `place order`
2. `Api` → `Payments` synchronous, label `charge`
3. `Payments` → `Database` synchronous, label `insert`
4. `Database` → `Payments` synchronous response, label `ok`

Sizes: **100**, **500**, and **2000** events (25, 125, and 500 cycles). No `newpage` / section events, so the only split is legacy’s event cap.

Put a note over `Api` with label `needle-<N>` on the last cycle (for example `needle-2000`). That is the search target.

Generate the legacy report and the mono report from that same sequence. Do not compare against report-next sample data.

### Legacy (`modules/lsd-core`)

Legacy is the git submodule, not a mono Gradle project. Build and run it with its own wrapper (`modules/lsd-core/gradlew`). Capture through `com.lsd.core.LsdContext` and `ReportOptions.maxEventsPerDiagram` (property `lsd.core.diagram.sequence.maxEventsPerDiagram`).

Default in `DefaultProperties.kt` is **50**. `SequenceDiagramGenerator` chunks the event list by that cap and, when `events.size > maxEventsPerDiagram`, **drops lifeline activations** before rendering. Each chunk becomes PlantUML, then its own SVG, inside one HTML report.

Run **both** of these for every size, including 2000:

| Run | Cap | What you get at 2000 events |
|-----|-----|------------------------------|
| Default split | `50` (do not set the property) | 40 diagrams. Activations removed. This is how legacy stays small today. |
| One SVG | `10000` (above the event count; `ReportOptions` builder `maxEventsPerDiagram`) | A single PlantUML SVG of the whole scenario. This is the comparison that matters. |

Open the written HTML (the Handlebars report that embeds the SVG), not the `.puml` source.

### Mono (`integrations/lsd-mono-core`)

Same events via `io.lsdconsulting.lsd.mono.core.LsdContext`, then `completeReport`. `ReportWriter` writes `<title>-diagram.html`: the packaged single-file shell with `window.__LSD_REPORT__` injected. Open **that** file, not the minimal `*-report.html` listing and not sample-data `report-next/lsd-report-next.single.html`.

Virtualisation is always on (`virtualRowRange` in `report-next/src/lib/layout.ts`). There is no flag to turn it off. The check is with that windowing in place. The participant header is sticky inside the diagram scrollport.

### What to measure

Primary tool: **Playwright, Chromium**, driving `file://` URLs of the generated HTML. One script, three sizes, three pages each (mono, legacy default split, legacy one SVG). Record Chrome version and the machine.

For each page:

1. **Time to first interactive paint.** From navigation start until the diagram is actually on screen: mono, the participant header in the sequence scrollport; legacy, the first `svg` in the report. Also record `first-contentful-paint` from `PerformanceObserver` (or `performance.getEntriesByType('paint')`).
2. **Scroll jank.** Script a scroll through the whole diagram (mono: the diagram scrollport; legacy: the page). During the scroll, timestamp frames with `requestAnimationFrame`. Record frame count, p95 frame time, and the longest frame. Count long tasks over 50 ms if `PerformanceObserver` of type `longtask` is available.
3. **Memory, if easy.** After load and again after the scroll, CDP `Performance.getMetrics` → `JSHeapUsedSize`. Skip if the CDP call fails. Do not block the check on memory.
4. **Search and zoom still usable.** Mono only (legacy has no equivalent): zoom in once from the toolbar, then find `needle-<N>`. Pass if the `[match]` cue shows and both actions finish without a multi-second freeze. Time each action.

Optional, not the primary record: a manual Chrome Performance trace (DevTools → Performance) on the 2000-event mono page and the 2000-event single legacy SVG, saved next to the results. Use it to explain a miss, not instead of the Playwright numbers.

### Pass bar

At **2000** events the mono diagram stays usable and the **single** legacy SVG does not.

Usable means all of:

- Participant header is visible.
- No scroll frame and no search/zoom action takes more than about a second (record the real longest frame; a p95 under 50 ms is a good result, not a requirement).
- Find shows `[match]` for `needle-2000`.

The single legacy SVG fails the bar if PlantUML or the browser does not finish in practical time, the tab goes unresponsive, or the first SVG appears only after a multi-second freeze. Write down which.

The **default split** (cap 50) is a second column, not a win condition. It may paint quickly because each SVG is small. It is a different product: many diagrams, activations removed. Do not treat a fast split report as beating mono.

100 and 500 are the ramp. Record them even when both sides feel fine.

### Where the numbers go

When the check is actually run, append a table to `docs/perf-results.md` (create that file then, not before). Columns: date, machine, Chrome, size, side (`mono` / `legacy-split-50` / `legacy-one-svg`), first interactive ms, FCP ms, p95 frame ms, longest frame ms, heap after load, heap after scroll, search ms, zoom ms, pass/fail, note. Link the Playwright script path once it exists. Do not paste guessed numbers into this runbook.

---

## 2. Gradle-wired Vite `build:single`

Today `./gradlew build` does **not** run Vite. `integrations/lsd-mono-core/build.gradle.kts` says the npm build is optional. The jar ships a hand-copied classpath shell:

`integrations/lsd-mono-core/src/main/resources/lsd-mono-core/report-next/lsd-report-next.single.html`

`npm run build:single` (in `report-next`) runs `tsc`, `vite build`, then `scripts/inline-single.mjs`, which writes `report-next/dist/lsd-report-next.html` and copies `report-next/lsd-report-next.single.html`. Nobody copies that into `src/main/resources` automatically. `ReportWriter` loads the classpath file (`SPIKE_RESOURCE`).

Wire it so a fresh shell is packaged without that hand copy:

1. Gradle `Exec` task `reportNextSingle` with working dir `integrations/lsd-mono-core/report-next`. It runs `npm ci` then `npm run build:single`. Node must be on `PATH` (Vite 7 / Vitest 3; same as the report-next README).
2. Copy `report-next/lsd-report-next.single.html` into the build output resources at `lsd-mono-core/report-next/lsd-report-next.single.html` (for example `build/generated/resources`). Do **not** overwrite the file under `src/main/resources` on every build.
3. `processResources` depends on that copy, so `jar` and `./gradlew :integrations:lsd-mono-core:build` ship the shell just built.
4. Sibling task (or the same one) runs `npm test` so vitest is on the Gradle path, not only a manual `npm test`.
5. After the first green Gradle build, delete the hand-maintained classpath copy if the generated resource replaces it, and fix the module README (it still says injection is deferred; injection already works).

Do this after the performance check so the check runs against the shell already in the tree, not against a build-script change at the same time.

---

## 3. Interceptor modules (`lsd-mono-*`)

Only after the performance check has a results file.

Legacy interceptors, Cucumber, and similar call `LsdContext` capture. Mono does not have those modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `integrations/`, depending on `integrations:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on `modules/lsd-core` or on Maven `lsd-core`.

Next integrations, in an order driven by what people actually migrate, not a big-bang port:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL.
- Cucumber only if a real suite is moving.

Each new module gets a contract test that the events it captures land in `ReportJson`. The component graph stays opt-in (`lsd.mono.components.enabled`).

---

## Trailing notes (not new projects)

- **No GitHub remote.** `main` is local. Do not add a remote or push until asked. CI (Java 21 `./gradlew build`, later the Vite task, later publish) waits on that.
- **Publish later.** Maven Central for `lsd-mono-core` and `lsd-mono-junit-jupiter` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; component SVG is not drawn inside the sequence shell; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes; no minimap or density mode.
