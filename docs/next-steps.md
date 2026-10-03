# LSD Mono — next steps

**Status:** local `main` only. Completed porting and UX slices are recorded in `docs/porting-gap.md` and `docs/perf-results.md`. This file is the runbook for open work.

---

## 1. README examples and usage instructions

Extend the root `README.md` with example-led guidance adapted from the upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) README style, for Mono rather than copied from the legacy API. Show how to depend on `lsd-mono-core`, use `LsdContext` from `io.lsdconsulting.lsd.mono.core`, and capture a small scenario with the Kotlin DSL. Explain how to complete the report and open/view the generated modern report HTML, including a short realistic scenario and the key capture/report steps. Keep the examples focused on the modern web report and do not introduce PlantUML markup or legacy names.

This is documentation of the current Mono API, not a request to change the API in this step.

---

## 2. Gradle-wired Vite `build:single` — done

`modules/lsd-mono-core/build.gradle.kts` runs the shell build. `reportSingle` (`npm ci` then `npm run build:single`) writes the single-file HTML, `copyReportShell` places it at `build/generated/resources/lsd-mono-core/report/lsd-report-next.single.html`, and `processResources` depends on that copy so `jar` / `:modules:lsd-mono-core:build` ship it. `reportTest` (`npm test`, vitest) is on `check`. The hand-maintained classpath HTML under `src/main/resources` is gone; sample payloads stay there. The tasks prepend Node 22 when it is installed and do not change the nvm default alias.

---

## 3. Interceptor modules (`lsd-mono-*`)

This remains open.

Legacy interceptors, Cucumber, and similar call `LsdContext` capture. Mono does not have those modules yet. `lsd-mono-junit-jupiter` is the pattern: a project under `modules/`, depending on `:modules:lsd-mono-core` only, package `io.lsdconsulting.lsd.mono.*`. No dependency on Maven `lsd-core`.

Next integrations, in an order driven by what people actually migrate, not a big-bang port:

- One logging or HTTP interceptor that records messages through `LsdContext.capture` / the Kotlin DSL.
- Cucumber only if a real suite is moving.

Each new module gets a contract test that the events it captures land in `ReportJson`. The component graph stays opt-in (`lsd.mono.components.enabled`).

---

## Trailing notes (not new projects)

- **No GitHub remote.** `main` is local. Do not add a remote or push until asked. CI (Java 21 `./gradlew build`, which now includes the Vite shell and vitest tasks, later publish) waits on that.
- **Publish later.** Maven Central for `lsd-mono-core` and `lsd-mono-junit-jupiter` (Central Portal, signing, Mono artifact names so they do not clash with legacy). Not part of steps 1–3.
- Small leftovers, still not a slice of their own: `CONTROL` / `COLLECTIONS` only if a migration needs a distinct icon; component SVG is not drawn inside the sequence shell; no in-memory `renderReport`; hide-stacktrace has a property but no dedicated test; virtualisation rebuilds the window SVG on scroll instead of recycling nodes. Density mode is still unscoped.
