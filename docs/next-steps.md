# LSD Mono — next steps

**Status:** local `main` only. Completed porting and UX slices are recorded in `docs/porting-gap.md` and `docs/perf-results.md`. This file is the runbook for open work.

---

## 1. README examples and usage instructions — done

The root `README.md` is example-led for the current Mono API: depend on `lsd-mono-core` / `lsd-mono-junit-jupiter`, capture with `LsdContext` and the Kotlin DSL (`"A" messages "B"`), set participant types, `completeReport`, and open `*-diagram.html`. `LsdExtension` is the JUnit Jupiter 6 path. Sample images live in `docs/readme/` (`diagram.png`, `inspector.png`, `zoom.gif`).

`:modules:lsd-mono-core:readmeSamples` regenerates them. It runs `captureReadmeReport` (the README scenario through `LsdContext`) and then headless Chromium against that shell, using Node 22 via nvm the same way as the other npm tasks. It is not on `build` or `check`.

---

## 2. Gradle-wired Vite `build:single` — done

`modules/lsd-mono-core/build.gradle.kts` runs the shell build. `reportSingle` (`npm ci` then `npm run build:single`) writes the single-file HTML, `copyReportShell` places it at `build/generated/resources/lsd-mono-core/report/lsd-report.single.html`, and `processResources` depends on that copy so `jar` / `:modules:lsd-mono-core:build` ship it. `reportTest` (`npm test`, vitest) is on `check`. The hand-maintained classpath HTML under `src/main/resources` is gone; sample payloads stay there. The tasks prepend Node 22 when it is installed and do not change the nvm default alias.

---

## 3. Interceptor modules (`lsd-mono-*`)

This remains open.

Legacy interceptors, Cucumber, and similar call `LsdContext` capture. Mono does not have those modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `modules/`, depending on `:modules:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on Maven `lsd-core`.

`modules/lsd-mono-cucumber-8` is in the build. It is a Cucumber 8 plugin (`io.cucumber:cucumber-plugin`, catalog `8.0.4`, constrained to strictly `[8,9)`) that completes a scenario per Cucumber scenario through `LsdContext` and writes `ReportJson`. `:modules:lsd-mono-cucumber-8:readmeSamples` regenerates `modules/lsd-mono-cucumber-8/docs/readme/`. It is not on `build` or `check`.

Still open, in an order driven by what people actually migrate:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL. Those modules are not in the tree.

Each new module gets a contract test that the events it captures land in `ReportJson`. The component graph stays opt-in (`lsd.mono.components.enabled`).

---

## Trailing notes (not new projects)

- **Do not push.** Origin is `https://github.com/lsd-consulting/lsd-mono.git` and was empty when this note was written. `.github/workflows/gradle.yml` runs Java 21 `./gradlew build` (Vite shell and vitest included) with Node 22. It is local until a push is asked for. `readmeSamples` is not on that workflow.
- **Publish later.** Maven Central for `lsd-mono-core` and `lsd-mono-junit-jupiter` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; component SVG is not drawn inside the sequence shell; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes. Density mode is still unscoped.
