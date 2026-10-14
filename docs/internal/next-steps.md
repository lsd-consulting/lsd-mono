# LSD Mono — next steps

**Status:** `main` is on origin (https://github.com/lsd-consulting/lsd-mono.git). Completed porting and UX slices are recorded in `docs/internal/porting-gap.md` and `docs/perf-results.md`. This file is the runbook for open work.

---

## 1. Interceptor modules (`lsd-mono-*`)

This remains open.

Legacy logging and HTTP interceptors call `LsdContext` capture. Mono does not have those interceptor modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `modules/`, depending on `:modules:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on Maven `lsd-core`.

`modules/lsd-mono-cucumber-8` is in the build. It is a Cucumber 8 plugin (`io.cucumber:cucumber-plugin`, catalog `8.0.4`, the build fails if anything resolves to another major) that completes a scenario per Cucumber scenario through `LsdContext` and writes `ReportJson`. `:modules:lsd-mono-cucumber-8:readmeSamples` regenerates `modules/lsd-mono-cucumber-8/docs/readme/`. It is not on `build` or `check`.

Still open, in an order driven by what people actually migrate:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL. Those modules are not in the tree.

Each new module gets a contract test that the events it captures land in `ReportJson`.

---

## Trailing notes (not new projects)

- **CI.** Origin is `https://github.com/lsd-consulting/lsd-mono.git` and `main` has been pushed. `.github/workflows/gradle.yml` runs on push to `main` and on pull requests: Java 17 toolchain (the baseline) with Java 25 running Gradle, JVM tests also on 21 and 25, Node from `.nvmrc`, `./gradlew build verifyGenerated` (Vite shell, vitest and build-logic tests included). See `docs/ci.md`. `readmeSamples` is not on that workflow. Publishing is still open; see `docs/versioning-notes.md`.
- **Publish later.** Maven Central for `lsd-mono-core`, `lsd-mono-junit-jupiter`, `lsd-mono-cucumber-8`, and `lsd-mono-coroutines` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3. The checklist stays in `docs/versioning-notes.md`.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes. Density mode is still unscoped.
- `docs/readme/feature-tour.gif` replaced the root README's `diagram.png`, `inspector.png`, `zoom.gif`, `fit.gif`, and `inspector-drag.gif`. It shows zoom and Fit, and a mouse drag widening the JSON panel, in one pass.
- Cucumber scenario screenshots leave a lot of empty space to the left of the description card and the diagram, and a smaller margin on the right that may not matter by itself. Worth exploring later whether the capture can use the available space better overall, not only by closing the left gap. Nice-to-have, not urgent.
- Cucumber scenario report, later. Not taking the stats section down. "the metrics, I wonder if we could kind of have a think about the design of that section as well, um, at a later point." Nice-to-have, not urgent.
