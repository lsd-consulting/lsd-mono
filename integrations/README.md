# integrations/

First-party monorepo Gradle projects that integrate LSD with third-party frameworks
(versioned alongside this repo). These are **not** git submodules.

Directory / project / artifact names include **`mono`** so they do not clash with
existing published `lsd-consulting` libraries (e.g. Maven Central `lsd-junit-jupiter`).

| Path | Artifact | Purpose |
|------|----------|---------|
| `lsd-mono-junit-jupiter/` | `lsd-mono-junit-jupiter` | JUnit Jupiter **6** extension for LSD reports |

Contrast with `modules/`, which holds independently owned git submodules (e.g. `lsd-core`).
