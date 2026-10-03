# LSD Mono

Local-only Gradle monorepo for LSD Consulting work. It owns shared build
conventions and first-party greenfield libraries (including **lsd-mono-core**).

## Status

**Local only.** This repo is initialised with `git init` and has **no remotes**.
Do not push or create a GitHub repository unless that is decided explicitly later.

**Greenfield product path:** first-party modules under `modules/` (notably
`lsd-mono-core`, whose report UI lives in `modules/lsd-mono-core/report`). Legacy behaviour for
comparison lives upstream at
[lsd-consulting/lsd-core](https://github.com/lsd-consulting/lsd-core) — it is not
vendored into this tree.

## Layout

```
lsd-mono/
├── build-logic/                         # Included Gradle build (convention plugins)
├── modules/                             # First-party mono Gradle projects
│   ├── lsd-mono-core/                   # Greenfield core + report UI
│   └── lsd-mono-junit-jupiter/          # JUnit Jupiter 6 extension → mono-core
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
├── settings.gradle.kts
├── build.gradle.kts
└── README.md
```

- **`build-logic/`** — shared config: version catalog from `gradle/libs.versions.toml`,
  and convention plugins such as `lsd.kotlin-jvm` and `lsd.common`.
- **`modules/`** — monorepo-owned libraries. Names include **`mono`**
  so they do not clash with published `lsd-consulting` artifacts.

## Prerequisites

- JDK 21+ (toolchain configured for 21 in convention plugins)
- Optional: Node.js 20+ only if you want to run/build the Vite report UI in
  `modules/lsd-mono-core/report` outside Gradle (Gradle tasks use Node 22 via nvm when present)

## Quick start

```bash
cd lsd-mono
./gradlew projects          # scaffold + included build-logic + modules
./gradlew build             # :modules:lsd-mono-core + :modules:lsd-mono-junit-jupiter
./gradlew printLayout       # layout reminder
```

## Capture (lsd-mono-core)

`LsdContext` records participants, facts, sections, notes, delays, spacers, sequence events (sync/async, responses, short, lost, and bi-directional messages), lifeline actions, and timestamps, and writes report JSON
(`report.json` plus `<title>-report.json`). The packaged SVG shell
`lsd-report.single.html` reads the captured `window.__LSD_REPORT__` that
`ReportWriter` injects. When opened directly it falls back to sample data. Dev
(`report` Vite) uses the same global in `src/main.ts`. Gradle runs the Vite
`build:single` and vitest tasks as part of `:modules:lsd-mono-core:build`.

Still open: root README usage examples, and Mono-named interceptor modules. PlantUML is intentionally out; component graphs are available as a separate opt-in report and are not yet embedded in the sequence shell.

## Using convention plugins

In a monorepo-owned module’s `build.gradle.kts`:

```kotlin
plugins {
    id("lsd.kotlin-jvm")
}
```

## First-party projects vs legacy

| Concern | Approach |
|---------|----------|
| Greenfield core + report UI | `modules/lsd-mono-core` (Gradle project) |
| JUnit / other integrations | `modules/lsd-mono-*` depending on `:modules:lsd-mono-core` |
| Legacy lsd-core behaviour | Upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) — not in this tree |
| Build from root today | `modules/*` included |

See also `modules/README.md`.
