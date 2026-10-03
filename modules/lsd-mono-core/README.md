# lsd-mono-core

First-party **LSD Mono** core library. This is the greenfield product path:
report UI in `report/` (Vite + TypeScript + custom SVG), plus a
thin Kotlin/JVM capture and report façade so integrations (e.g.
`lsd-mono-junit-jupiter`) can migrate off published Maven `lsd-core`.

## What this is / is not

| | |
|--|--|
| **Is** | Mono-owned artifact `lsd-mono-core`, package `io.lsdconsulting.lsd.mono.core` |
| **Is** | Report UI in `report/` (`modules/lsd-mono-core/report`) |
| **Is not** | A vendor of legacy Maven `io.github.lsd-consulting:lsd-core` sources |
| **Legacy reference** | Upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) for API / behaviour comparison |

## Layout

```
lsd-mono-core/
├── report/                 # Vite+TS report UI (dev with npm)
│   ├── src/                     # UI, custom SVG diagram, sample data
│   ├── lsd-report.single.html
│   └── README.md
├── src/main/kotlin/…/mono/core/ # Kotlin façade (capture + write reports)
├── src/main/resources/lsd-mono-core/report/
│   └── lsd-report-payloads.js        # sample payloads copied beside a report
└── build.gradle.kts                 # reportSingle + reportTest
```

## What runs today (`./gradlew build`)

**Works now**

- Kotlin library compiles and tests
- `LsdContext` façade: facts, `completeScenario`, `completeReport`, `createIndex`,
  `completeComponentsReport` (opt-in component graph), `clear`, id generation, HTML escape, popup helper
- Report writer emits:
  - `*-report.json` — ReportJson-shaped payload (aligned with `report/src/types.ts`)
  - `*-report.html` — minimal mono HTML listing scenarios (status, description, facts)
  - copies classpath `lsd-report.single.html` beside the report as the
    interactive shell with captured `ReportJson` injected (the demo falls back to sample data when opened directly)
  - `index.html` aggregating report files

**Deferred / optional**

- Rendering the opt-in component graph inside the sequence shell
- PlantUML / Handlebars compatibility — intentionally out of the Mono product path; see upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) for legacy reference

## Kotlin API (migration-oriented)

Inspired by legacy entry points (`LsdContext`, `Status`, properties, popup links)
but under the **mono** package:

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.Status

val lsd = LsdContext.instance
lsd.addFact("framework", "junit-jupiter-6")
lsd.completeScenario("my scenario", "<p>ok</p>", Status.SUCCESS)
lsd.completeReport("My Suite")
lsd.createIndex()
```

Property keys use the `lsd.mono.*` prefix (with fallbacks to legacy `lsd.core.*`
and `lsd.junit.*` names where useful for migration).

## Report UI (manual)

```bash
cd modules/lsd-mono-core/report
npm ci
npm test             # vitest — layout, diagram view (zoom/fit/columns/search), SVG cues
npm run dev          # http://localhost:5173/
# or open report/lsd-report.single.html in Chrome (file://)
```

`./gradlew :modules:lsd-mono-core:build` runs `reportSingle` (`npm ci` and `npm run build:single`) and `reportTest` (`npm test`). The shell is packaged from `build/generated/resources`, not written back into `src/main/resources`. Needs a current Node (Vite 7 / Vitest 3). The Gradle tasks prepend Node 22 when it is installed and do not change your default Node.

See `report/README.md` for how to run the report UI.
