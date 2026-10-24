# Generated files

Build outputs are not committed. The generated files in git are the report UI's types and the public
API dumps, which `check` verifies, and images: README pictures, the check:ux baselines, and the perf screenshots. A Linux CI
runner cannot reproduce the images byte for byte, so CI does not verify them. Retake them on a Mac
with the commands below.

## What CI checks

The Gradle workflow runs `./gradlew build verifyGenerated`. `verifyGenerated` runs after the build and
fails if git shows a changed tracked file, or an untracked file that is not ignored in any directory.
Each file is listed, with how to fix it. A build must leave the tree as checked out. If it fails,
either the build rewrote a committed file (stop tracking it, or commit the regenerated copy), or a new
build output needs a `.gitignore` entry. Untracked files at the repository root, such as personal
notes, are not checked. Run it locally on a tree with no uncommitted changes.

## Built on demand, not committed

| File | Built by | Used by |
|------|----------|---------|
| `modules/lsd-mono-report-html/ui/dist/lsd-report.html` | `reportSingle` (`npm run build:single`), on every build | Packaged into lsd-mono-report-html's jar as `/lsd-mono-report-html/lsd-report.single.html`, the shell every report uses |
| `modules/lsd-mono-report-html/ui/dist/lsd-report-payloads.js` | `reportSingle` | The shell's built-in demo when you open `dist/lsd-report.html` with no captured report |
| `modules/lsd-mono-core/build/pages/` (`index.html`, `example-report.html` and the example report's `-diagram.html`, `-report.js`, `-payloads.js`, `-report.json`) | `./gradlew :modules:lsd-mono-core:kitchenSinkSample` | The [Pages workflow](../.github/workflows/pages.yml) builds and publishes it on pushes to `main`. `index.html` is the report index that `createIndex()` writes for the example report |
| `modules/lsd-mono-spring-boot-4/build/pages/` (`index.html`, `shop-report.html`, `kafka-shop-report.html` and the reports' own files) | `./gradlew :modules:lsd-mono-spring-boot-4:sampleReport` | The Spring Boot starter's sample report: its shop fixtures (plain `@SpringBootTest` classes) run by the `sampleReportTests` task, which ignores the one scenario that fails on purpose. The Pages workflow publishes it under `spring-boot-4/` |
| `docs/perf-samples/` | `docs/perf/generate-*.mjs` | Local perf runs (gitignored) |

## Committed report types (verified by `check`)

| File | How to update |
|------|----------|
| `modules/lsd-mono-report-html/ui/src/generated/lsd-report.ts` | In `modules/lsd-mono-report-html/ui`: `npm run types:generate` |
| `modules/lsd-mono-report-html/ui/src/generated/lsd-index.ts` | In `modules/lsd-mono-report-html/ui`: `npm run types:generate` |

The report UI's types for the report and index data are generated from the JSON Schemas in
[`modules/lsd-mono-report-schema`](../modules/lsd-mono-report-schema/README.md) by
`scripts/report-types.mjs` (json-schema-to-typescript, pinned in `package.json`). Do not edit them by
hand: change the schema and regenerate. `npm run types:check` generates them in memory and fails when
they differ from the committed files. It runs in `reportLint`, so `./gradlew build` (and CI's build
job, which runs for any change outside the docs) fails on a hand edit or a schema change without
regenerated types. The build never writes these files, so `verifyGenerated` does not need to know
about them.

## Committed API dumps (verified by `check`)

| File | How to update |
|------|----------|
| `modules/lsd-mono-core/api/lsd-mono-core.api` | `./gradlew updateKotlinAbi` |
| `modules/lsd-mono-junit-jupiter/api/lsd-mono-junit-jupiter.api` | `./gradlew updateKotlinAbi` |
| `modules/lsd-mono-cucumber-8/api/lsd-mono-cucumber-8.api` | `./gradlew updateKotlinAbi` |
| `modules/lsd-mono-coroutines/api/lsd-mono-coroutines.api` | `./gradlew updateKotlinAbi` |
| `modules/lsd-mono-report-model/api/lsd-mono-report-model.api` | `./gradlew updateKotlinAbi` |
| `modules/lsd-mono-report-html/api/lsd-mono-report-html.api` | `./gradlew updateKotlinAbi` |

Every published module uses Kotlin's explicit API mode and the Kotlin Gradle plugin's built-in ABI
validation (the `lsd.kotlin-jvm` convention in `build-logic`). The dump lists the module's public
binary API. `checkKotlinAbi` runs as part of `check`, so `./gradlew build` fails when the public API
no longer matches its dump. When the change is intended, run `updateKotlinAbi` and commit the new
dump with the change, so the API difference is reviewed with the code. The build never writes these
files, so `verifyGenerated` does not need to know about them.

## Committed images (not verified in CI)

| File | How to retake (macOS, the `.nvmrc` Node via nvm, Chromium from Playwright) |
|------|----------|
| `docs/readme/feature-tour.gif` | `./gradlew :modules:lsd-mono-core:readmeSamples` |
| `modules/lsd-mono-junit-jupiter/docs/readme/diagram.png` | `./gradlew :modules:lsd-mono-junit-jupiter:readmeSamples` |
| `modules/lsd-mono-cucumber-8/docs/readme/diagram.png` | `./gradlew :modules:lsd-mono-cucumber-8:readmeSamples` |
| All of the above | `./gradlew readmeSamples` |
| `modules/lsd-mono-report-html/ui/checks/snapshots/*.png` (check:ux baselines) | In `modules/lsd-mono-report-html/ui`, with port 4179 free: `npm run check:ux -- --update-snapshots`. Review the changed PNGs before you commit them |
| `docs/perf-results.md`, `docs/perf-screenshots/*.png` | A dated, hand-written measurement record. Redo it by hand when you re-measure (see `docs/perf`) |

Retake README images only when the UI they show changes. Sample reports use a fixed "generated at"
time (`lsd.samples.generatedAt` in `gradle.properties`, passed as `lsd.mono.report.generatedAt`)
and deterministic ids (`lsd.mono.ids.deterministic`). Regenerating them with an unchanged UI gives
the same report, so a retake shows only real changes.
