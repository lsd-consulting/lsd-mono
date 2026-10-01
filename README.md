# LSD Mono

Local-only Gradle monorepo for LSD Consulting work. It owns shared build
conventions and holds related repositories as git submodules under `modules/`.

## Status

**Local only.** This repo is initialised with `git init` and has **no remotes**.
Do not push or create a GitHub repository unless that is decided explicitly later.

## Layout

```
lsd-mono/
├── build-logic/          # Included Gradle build (convention plugins, catalog wiring)
├── modules/              # Git submodules (source ownership)
│   └── lsd-core/         # https://github.com/lsd-consulting/lsd-core.git
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
├── settings.gradle.kts
├── build.gradle.kts
└── README.md
```

- **`build-logic/`** — shared config: version catalog from `gradle/libs.versions.toml`,
  and convention plugins such as `lsd.kotlin-jvm` and `lsd.common`.
- **`modules/`** — submodules for source ownership. Submodule projects keep their
  own Gradle builds; the root does **not** require building them to succeed.

## Prerequisites

- JDK 21+ (toolchain configured for 21 in convention plugins)
- Git (for submodules)

## Quick start

```bash
cd lsd-mono
./gradlew projects          # scaffold + included build-logic
./gradlew printLayout       # layout reminder
```

Clone with submodules (if someone else gets a copy later):

```bash
git clone --recurse-submodules <path-or-url>
# or after a normal clone:
git submodule update --init --recursive
```

## Using convention plugins

In a monorepo-owned module’s `build.gradle.kts`:

```kotlin
plugins {
    id("lsd.kotlin-jvm")
}
```

## Submodules vs Gradle composite

| Concern | Approach |
|---------|----------|
| Source ownership / version pin | Git submodule under `modules/` |
| Build from root today | Not required; submodule builds stay independent |
| Optional composite later | `includeBuild("modules/lsd-core")` in root `settings.gradle.kts` |

## Adding another submodule

```bash
git submodule add https://github.com/lsd-consulting/<repo>.git modules/<repo>
git add .gitmodules modules/<repo>
git commit -m "Add modules/<repo> submodule"
```

See also `modules/README.md`.
