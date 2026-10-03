# LSD Mono

Local-only Gradle monorepo for LSD Consulting work. It owns shared build
conventions, first-party greenfield libraries (including **lsd-mono-core**),
integration modules, and related repositories as git submodules under `modules/`.

## Status

**Local only.** This repo is initialised with `git init` and has **no remotes**.
Do not push or create a GitHub repository unless that is decided explicitly later.

**Greenfield product path:** first-party modules under `integrations/` (notably
`lsd-mono-core`, seeded from the report-next UI spike). The `modules/lsd-core`
git submodule is **inspiration / API reference only** — it is not the mono core
artifact and is not vendored into `lsd-mono-core`.

## Layout

```
lsd-mono/
├── build-logic/                         # Included Gradle build (convention plugins)
├── integrations/                        # First-party mono Gradle projects
│   ├── lsd-mono-core/                   # Greenfield core + report-next spike
│   └── lsd-mono-junit-jupiter/          # JUnit Jupiter 6 extension → mono-core
├── modules/                             # Git submodules (reference only by default)
│   └── lsd-core/                        # Legacy product — API inspiration, not mono core
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
├── settings.gradle.kts
├── build.gradle.kts
└── README.md
```

- **`build-logic/`** — shared config: version catalog from `gradle/libs.versions.toml`,
  and convention plugins such as `lsd.kotlin-jvm` and `lsd.common`.
- **`integrations/`** — monorepo-owned libraries. Names include **`mono`**
  so they do not clash with published `lsd-consulting` artifacts.
- **`modules/`** — submodules for source ownership / reference. Submodule projects
  keep their own Gradle builds; the root does **not** include them as product deps.

## Prerequisites

- JDK 21+ (toolchain configured for 21 in convention plugins)
- Git (for submodules)
- Optional: Node.js 20+ only if you want to run/build the Vite report-next spike

## Quick start

```bash
cd lsd-mono
./gradlew projects          # scaffold + included build-logic + integrations
./gradlew build             # :integrations:lsd-mono-core + :integrations:lsd-mono-junit-jupiter
./gradlew printLayout       # layout reminder
```

Clone with submodules (if someone else gets a copy later):

```bash
git clone --recurse-submodules <path-or-url>
# or after a normal clone:
git submodule update --init --recursive
```

## Capture (lsd-mono-core)

`LsdContext` records participants, facts, and sequence events (sync/async message,
response, note, logical divider, activate/deactivate) and writes report-next JSON
(`report.json` plus `<title>-report.json`). The packaged SVG shell
`lsd-report-next.single.html` reads `window.__LSD_REPORT__` when ReportWriter
injects it, otherwise it falls back to sample data. Dev (`report-next` Vite) uses
the same global in `src/main.ts` — no Gradle Vite build required.

Still deferred: PlantUML, component diagrams, newpage / time-delay / vertical space.

## Using convention plugins

In a monorepo-owned module’s `build.gradle.kts`:

```kotlin
plugins {
    id("lsd.kotlin-jvm")
}
```

## Submodules vs first-party projects

| Concern | Approach |
|---------|----------|
| Greenfield core + report UI | `integrations/lsd-mono-core` (Gradle project) |
| JUnit / other integrations | `integrations/lsd-mono-*` depending on `:integrations:lsd-mono-core` |
| Legacy lsd-core source pin | Git submodule under `modules/lsd-core` — **reference only** |
| Build from root today | `integrations/*` included; `modules/*` stay independent |
| Optional composite later | `includeBuild("modules/lsd-core")` in root `settings.gradle.kts` |

## Adding another submodule

```bash
git submodule add https://github.com/lsd-consulting/<repo>.git modules/<repo>
git add .gitmodules modules/<repo>
git commit -m "Add modules/<repo> submodule"
```

See also `modules/README.md` and `integrations/README.md`.
