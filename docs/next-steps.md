# LSD Mono — next steps

**Status:** `main` is on origin (https://github.com/lsd-consulting/lsd-mono.git). Completed porting and UX slices are recorded in `docs/porting-gap.md` and `docs/perf-results.md`. This file is the runbook for open work.

---

## 1. README examples and usage instructions — done

The root `README.md` is example-led for the current Mono API: depend on `lsd-mono-core`, `lsd-mono-junit-jupiter`, and `lsd-mono-cucumber-8`, capture with `LsdContext` and the Kotlin DSL (`"A" messages "B"`), set participant types, `completeReport`, and open `*-diagram.html`. `LsdExtension` is the JUnit Jupiter 6 path. `LsdCucumberPlugin` is the Cucumber 8 path. Sample images live in `docs/readme/` (`diagram.png`, `inspector.png`, `zoom.gif`).

`:modules:lsd-mono-core:readmeSamples` regenerates them. It runs `captureReadmeReport` (the README scenario through `LsdContext`) and then headless Chromium against that shell, using Node 22 via nvm the same way as the other npm tasks. It is not on `build` or `check`.

`./gradlew readmeSamples` depends on the core, JUnit, and Cucumber `readmeSamples` tasks.

---

## 2. Gradle-wired Vite `build:single` — done

`modules/lsd-mono-core/build.gradle.kts` runs the shell build. `reportSingle` (`npm ci` then `npm run build:single`) writes the single-file HTML, `copyReportShell` places it at `build/generated/resources/lsd-mono-core/report/lsd-report.single.html`, and `processResources` depends on that copy so `jar` / `:modules:lsd-mono-core:build` ship it. `reportTest` (`npm test`, vitest) is on `check`. The hand-maintained classpath HTML under `src/main/resources` is gone; sample payloads stay there. The tasks prepend Node 22 when it is installed and do not change the nvm default alias.

---

## 3. Interceptor modules (`lsd-mono-*`)

This remains open.

Legacy logging and HTTP interceptors call `LsdContext` capture. Mono does not have those interceptor modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `modules/`, depending on `:modules:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on Maven `lsd-core`.

`modules/lsd-mono-cucumber-8` is in the build. It is a Cucumber 8 plugin (`io.cucumber:cucumber-plugin`, catalog `8.0.4`, constrained to strictly `[8,9)`) that completes a scenario per Cucumber scenario through `LsdContext` and writes `ReportJson`. `:modules:lsd-mono-cucumber-8:readmeSamples` regenerates `modules/lsd-mono-cucumber-8/docs/readme/`. It is not on `build` or `check`.

Still open, in an order driven by what people actually migrate:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL. Those modules are not in the tree.

Each new module gets a contract test that the events it captures land in `ReportJson`.

---

## Trailing notes (not new projects)

- **CI.** Origin is `https://github.com/lsd-consulting/lsd-mono.git` and `main` has been pushed. `.github/workflows/gradle.yml` runs on push to `main` and on pull requests: Java 21, Node 22, `./gradlew build --no-daemon` (Vite shell and vitest included). `readmeSamples` is not on that workflow. Publishing is still open; see `docs/versioning-notes.md`.
- **Publish later.** Maven Central for `lsd-mono-core`, `lsd-mono-junit-jupiter`, and `lsd-mono-cucumber-8` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3. The checklist stays in `docs/versioning-notes.md`.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes. Density mode is still unscoped. An in-page component diagram is issue #4.
- `docs/readme/fit.gif` is the fit-to-screen motion: the diagram zooms and pans, rather than a static zoomed frame. `docs/readme/zoom.gif` is still the zoom-until-the-diagram-scrolls clip.
- `docs/readme/inspector-drag.gif` is a mouse drag widening the JSON inspector. It is not a click on an expand button.
- Cucumber scenario screenshots leave a lot of empty space to the left of the description card and the diagram, and a smaller margin on the right that may not matter by itself. Worth exploring later whether the capture can use the available space better overall, not only by closing the left gap. Nice-to-have, not urgent.
- Cucumber scenario report, later. Not taking the stats section down. "the metrics, I wonder if we could kind of have a think about the design of that section as well, um, at a later point." Nice-to-have, not urgent.
