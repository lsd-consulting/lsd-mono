# modules/

First-party monorepo Gradle projects (versioned alongside this repo). Directory /
project / artifact names include **`mono`** so they do not clash with existing
published `lsd-consulting` libraries (e.g. Maven Central `lsd-core`,
`lsd-junit-jupiter`).

| Path | Artifact | Purpose |
|------|----------|---------|
| `lsd-mono-core/` | `lsd-mono-core` | Core: sequence capture, timing, report JSON and the interactive report |
| `lsd-mono-junit-jupiter/` | `lsd-mono-junit-jupiter` | JUnit Jupiter **6** extension → depends on `:modules:lsd-mono-core` |
| `lsd-mono-cucumber-8/` | `lsd-mono-cucumber-8` | Cucumber **8** plugin → depends on `:modules:lsd-mono-core` |
| `lsd-mono-coroutines/` | `lsd-mono-coroutines` | kotlinx.coroutines **1** support: keeps a scenario bound across thread hops → depends on `:modules:lsd-mono-core` |
| `lsd-mono-report-model/` | `lsd-mono-report-model` | The report JSON as plain Kotlin values (`ReportJson` and the rest) and the schema version. No dependencies beyond the Kotlin standard library; lsd-mono-core builds reports from it |
| `lsd-mono-report-html/` | `lsd-mono-report-html` | Writes a report model as `<stem>-report.json` and the interactive HTML page, and the index of a directory's reports; bundles the single-file report shell → depends on `:modules:lsd-mono-report-model`. lsd-mono-core depends on it |
| `lsd-mono-report-schema/` | none (not a Gradle project) | JSON Schemas for the report and index data, and the shared test reports. The Kotlin tests read them from the classpath (lsd-mono-report-model's test fixtures); the report UI's types are generated from them |

`lsd-mono-core` is the core artifact. The report UI is `modules/lsd-mono-report-html/ui`. For
the behaviour of the earlier libraries, see the upstream
[lsd-core](https://github.com/lsd-consulting/lsd-core) repository. It is not part of this tree.
