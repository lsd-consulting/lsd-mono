# lsd-mono-core

First-party **LSD Mono** core library. This is the greenfield product path:
report UI from the **report-next** spike (Vite + TypeScript + custom SVG), plus a
thin Kotlin/JVM capture and report façade so integrations (e.g.
`lsd-mono-junit-jupiter`) can migrate off published Maven `lsd-core`.

## What this is / is not

| | |
|--|--|
| **Is** | Mono-owned artifact `lsd-mono-core`, package `io.lsdconsulting.lsd.mono.core` |
| **Is** | Seeded from the greenfield `lsd-report-next` spike |
| **Is not** | A vendor of legacy `modules/lsd-core` / Maven `io.github.lsd-consulting:lsd-core` sources |
| **Legacy submodule** | `modules/lsd-core` remains **inspiration / API reference only** |

## Layout

```
lsd-mono-core/
├── report-next/                 # Vite+TS spike sources (dev with npm)
│   ├── src/                     # UI, custom SVG diagram, sample data
│   ├── lsd-report-next.single.html
│   └── README.md
├── src/main/kotlin/…/mono/core/ # Kotlin façade (capture + write reports)
├── src/main/resources/lsd-mono-core/report-next/
│   └── lsd-report-next.single.html   # classpath copy of prebuilt shell
└── build.gradle.kts
```

## What runs today (`./gradlew build`)

**Works now**

- Kotlin library compiles and tests
- `LsdContext` façade: facts, `completeScenario`, `completeReport`, `createIndex`,
  `completeComponentsReport` (opt-in component graph), `clear`, id generation, HTML escape, popup helper
- Report writer emits:
  - `*-report.json` — ReportJson-shaped payload (aligned with spike `types.ts`)
  - `*-report.html` — minimal mono HTML listing scenarios (status, description, facts)
  - copies classpath `lsd-report-next.single.html` beside the report as the
    interactive demo shell (still sample-data-driven until JSON injection lands)
  - `index.html` aggregating report files

**Deferred / optional**

- Full Vite production build from Gradle (run manually: `cd report-next && npm ci && npm run build:single`)
- Injecting live ReportJson into the interactive SVG shell (spike still binds
  sample data in `main.ts`)
- PlantUML / Handlebars / full legacy domain parity (messages, participants,
  component diagrams) — migrate gradually; use `modules/lsd-core` as reference only

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

## Spike UI (manual)

```bash
cd integrations/lsd-mono-core/report-next
npm ci
npm test             # vitest — virtual row window (src/lib/layout.test.ts)
npm run dev          # http://localhost:5173/
# or open report-next/lsd-report-next.single.html in Chrome (file://)
```

`npm test` is the repeatable UI check for diagram virtualisation. It is not wired into `./gradlew build` (that stays the Kotlin build). Needs a current Node (Vite 7 / Vitest 3); the repo does not change your default Node.

See `report-next/README.md` for the original spike notes.
