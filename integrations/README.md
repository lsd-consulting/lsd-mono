# integrations/

First-party monorepo Gradle projects (versioned alongside this repo). These are
**not** git submodules.

Directory / project / artifact names include **`mono`** so they do not clash with
existing published `lsd-consulting` libraries (e.g. Maven Central `lsd-core`,
`lsd-junit-jupiter`).

| Path | Artifact | Purpose |
|------|----------|---------|
| `lsd-mono-core/` | `lsd-mono-core` | Greenfield core: sequence capture → report-next JSON + SVG shell |
| `lsd-mono-junit-jupiter/` | `lsd-mono-junit-jupiter` | JUnit Jupiter **6** extension → depends on `:integrations:lsd-mono-core` |

**Product path:** `lsd-mono-core` is the mono core artifact (seeded from the
report-next spike). Do **not** treat `modules/lsd-core` as the product core.
