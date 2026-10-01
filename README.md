# LSD Mono

Local-only Gradle monorepo for LSD Consulting work. It owns shared build
conventions, first-party integration modules, and related repositories as git
submodules under `modules/`.

## Status

**Local only.** This repo is initialised with `git init` and has **no remotes**.
Do not push or create a GitHub repository unless that is decided explicitly later.

## Layout

```
lsd-mono/
├── build-logic/                      # Included Gradle build (convention plugins)
├── integrations/                     # First-party mono Gradle projects (versioned here)
│   └── lsd-mono-junit-jupiter/       # JUnit Jupiter 6 / LSD reporting extension
├── modules/                          # Git submodules (source ownership)
│   └── lsd-core/                     # https://github.com/lsd-consulting/lsd-core.git
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
├── settings.gradle.kts
├── build.gradle.kts
└── README.md
```

- **`build-logic/`** — shared config: version catalog from `gradle/libs.versions.toml`,
  and convention plugins such as `lsd.kotlin-jvm` and `lsd.common`.
- **`integrations/`** — monorepo-owned libraries that integrate LSD with third-party
  frameworks (included as Gradle subprojects). Names include **`mono`**
  (e.g. `lsd-mono-junit-jupiter`) so they do not clash with published
  `lsd-consulting` artifacts. Keep these out of `modules/` so submodule layout
  stays unambiguous.
- **`modules/`** — submodules for source ownership. Submodule projects keep their
  own Gradle builds; the root does **not** require building them to succeed.

## Prerequisites

- JDK 21+ (toolchain configured for 21 in convention plugins)
- Git (for submodules)

## Quick start

```bash
cd lsd-mono
./gradlew projects          # scaffold + included build-logic + integrations
./gradlew build             # build first-party projects (e.g. :integrations:lsd-mono-junit-jupiter)
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

## Submodules vs first-party projects

| Concern | Approach |
|---------|----------|
| Source ownership / version pin of external repos | Git submodule under `modules/` |
| Versioned third-party integrations owned by this mono | Gradle project under `integrations/` with a `mono` name |
| Build from root today | `integrations/*` included; `modules/*` stay independent |
| Optional composite later | `includeBuild("modules/lsd-core")` in root `settings.gradle.kts` |

## Adding another submodule

```bash
git submodule add https://github.com/lsd-consulting/<repo>.git modules/<repo>
git add .gitmodules modules/<repo>
git commit -m "Add modules/<repo> submodule"
```

See also `modules/README.md` and `integrations/README.md`.
