# modules/

First-party monorepo Gradle projects (versioned alongside this repo). Directory /
project / artifact names include **`mono`** so they do not clash with existing
published `lsd-consulting` libraries (e.g. Maven Central `lsd-core`,
`lsd-junit-jupiter`).

| Path | Artifact | Purpose |
|------|----------|---------|
| `lsd-mono-core/` | `lsd-mono-core` | Greenfield core: sequence capture → report JSON + SVG shell |
| `lsd-mono-junit-jupiter/` | `lsd-mono-junit-jupiter` | JUnit Jupiter **6** extension → depends on `:modules:lsd-mono-core` |
| `lsd-mono-cucumber-8/` | `lsd-mono-cucumber-8` | Cucumber **8** plugin → depends on `:modules:lsd-mono-core` |
| `lsd-mono-coroutines/` | `lsd-mono-coroutines` | kotlinx.coroutines **1** support: keeps a scenario bound across thread hops → depends on `:modules:lsd-mono-core` |

**Product path:** `lsd-mono-core` is the mono core artifact. Its report UI is
`modules/lsd-mono-core/report`. For legacy behaviour, see the published upstream
[lsd-core](https://github.com/lsd-consulting/lsd-core) repository — it is not
vendored in this tree.
