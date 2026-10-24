# modules/

First-party monorepo Gradle projects (versioned alongside this repo). Directory /
project / artifact names include **`mono`** so they do not clash with existing
published `lsd-consulting` libraries (e.g. Maven Central `lsd-core`,
`lsd-junit-jupiter`).

| Path | Artifact | Purpose |
|------|----------|---------|
| `lsd-mono-core/` | `lsd-mono-core` | Core: sequence capture, timing and properties. Builds the report model and writes it with lsd-mono-report-html → depends on `:modules:lsd-mono-report-model` and `:modules:lsd-mono-report-html` |
| `lsd-mono-junit-jupiter/` | `lsd-mono-junit-jupiter` | JUnit Jupiter **6** extension → depends on `:modules:lsd-mono-core` |
| `lsd-mono-cucumber-8/` | `lsd-mono-cucumber-8` | Cucumber **8** plugin → depends on `:modules:lsd-mono-core` |
| `lsd-mono-coroutines/` | `lsd-mono-coroutines` | kotlinx.coroutines **1** support: keeps a scenario bound across thread hops → depends on `:modules:lsd-mono-core` |
| `lsd-mono-spring-boot-4/` | `lsd-mono-spring-boot-4` | Spring Boot **4** starter: every `@SpringBootTest` draws its Spring MVC, `RestClient`, `RestTemplate`, Kafka and Spring Data repository calls, no code ([sample report](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/)) → depends on `:modules:lsd-mono-core` |
| `lsd-mono-report-model/` | `lsd-mono-report-model` | The report JSON as plain Kotlin values (`ReportJson` and the rest) and the schema version. No dependencies beyond the Kotlin standard library; lsd-mono-core builds reports from it |
| `lsd-mono-report-html/` | `lsd-mono-report-html` | Writes a report model as `<stem>-report.json` and the interactive HTML page, and the index of a directory's reports; bundles the single-file report shell → depends on `:modules:lsd-mono-report-model`. lsd-mono-core depends on it |
| `lsd-mono-report-schema/` | none (not a Gradle project) | JSON Schemas for the report and index data, and the shared test reports. The Kotlin tests read them from the classpath (lsd-mono-report-model's test fixtures); the report UI's types are generated from them |

`lsd-mono-core` is the core artifact. For the behaviour of the earlier libraries, see the
upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) repository. It is not part of this
tree.

## How they fit together

```text
lsd-mono-junit-jupiter ─┐
lsd-mono-cucumber-8 ────┤
lsd-mono-coroutines ────┼─→ lsd-mono-core ─→ lsd-mono-report-html ─→ lsd-mono-report-model
lsd-mono-spring-boot-4 ─┘

lsd-mono-report-schema: the contract. lsd-mono-report-model follows it (its tests check),
and the report UI's TypeScript types are generated from it.
```

The report side has no dependency on the capture side: lsd-mono-report-html and
lsd-mono-report-model know nothing of `LsdContext`, JUnit, Cucumber or Spring, and lsd-mono-core's own API
exposes neither of them.

Where the non-Kotlin parts are:

| Path | What |
|------|------|
| `lsd-mono-report-html/ui/` | The report UI (TypeScript, Vite). `npm run build:single` builds the single-file shell that the jar bundles; `checks/` holds the Playwright checks (`check:ux`) |
| `lsd-mono-report-schema/*.schema.json` | The report and index schemas, versioned on their own (`schemaVersion`, [README](lsd-mono-report-schema/README.md)) |
| `lsd-mono-report-schema/conformance/` | The shared test reports that core, the UI and the integration modules each check against |

## Which artifact to depend on

| You are | Depend on |
|---------|-----------|
| Writing JUnit Jupiter 6 tests | `lsd-mono-core` and `lsd-mono-junit-jupiter` |
| Writing Cucumber 8 scenarios | `lsd-mono-core` and `lsd-mono-cucumber-8` |
| Capturing from coroutines that change threads | add `lsd-mono-coroutines` |
| Testing a Spring Boot 4 app with `@SpringBootTest` | `lsd-mono-spring-boot-4` (it brings `lsd-mono-core`) |
| Capturing by hand with `LsdContext` | `lsd-mono-core` only |
| Writing reports without lsd-mono-core (an adapter for another test framework, a trace importer) | `lsd-mono-report-html`, which brings `lsd-mono-report-model` on the compile classpath |
| Reading or building the report values only, with no files | `lsd-mono-report-model` |

lsd-mono-core brings the report model and writer at run time only (Maven `runtime` scope), so a
test that uses lsd-mono-core never compiles against them. Code that does use their types declares
them itself, at the same version as lsd-mono-core: all seven are released together at one version
and are only meant to be used at matching versions
([docs/versioning-notes.md](../docs/versioning-notes.md)). Both are experimental for now: their
types need an opt-in and have no binary-compatibility promise yet (see their READMEs).
