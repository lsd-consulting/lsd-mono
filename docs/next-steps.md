# LSD Mono — next steps

**Status:** local `main` only. Completed porting and UX slices are recorded in `docs/porting-gap.md` and `docs/perf-results.md`. This file is the runbook for open work.

---

## 1. README examples and usage instructions

Extend the root `README.md` with the example-led guidance that `modules/lsd-core/README.md` provides, adapted for Mono rather than copied from the legacy API. Show how to depend on `lsd-mono-core`, use `LsdContext` from `io.lsdconsulting.lsd.mono.core`, and capture a small scenario with the Kotlin DSL. Explain how to complete the report and open/view the generated modern report-next HTML, including a short realistic scenario and the key capture/report steps. Keep the examples focused on the modern web report and do not introduce PlantUML markup or legacy names.

This is documentation of the current Mono API, not a request to change the API in this step.

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
5. After the first green Gradle build, delete the hand-maintained classpath copy if the generated resource replaces it.

Keep the build wiring separate from the already-recorded browser performance results.

---

## 3. Interceptor modules (`lsd-mono-*`)

This remains open.

Legacy interceptors, Cucumber, and similar call `LsdContext` capture. Mono does not have those modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `integrations/`, depending on `integrations:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on `modules/lsd-core` or on Maven `lsd-core`.

Next integrations, in an order driven by what people actually migrate, not a big-bang port:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL.
- Cucumber only if a real suite is moving.

Each new module gets a contract test that the events it captures land in `ReportJson`. The component graph stays opt-in (`lsd.mono.components.enabled`).

---

## Trailing notes (not new projects)

- **No GitHub remote.** `main` is local. Do not add a remote or push until asked. CI (Java 21 `./gradlew build`, later the Vite task, later publish) waits on that.
- **Publish later.** Maven Central for `lsd-mono-core` and `lsd-mono-junit-jupiter` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; component SVG is not drawn inside the sequence shell; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes. Density mode is still unscoped.
