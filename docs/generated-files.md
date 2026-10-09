# Generated files

Build outputs are not committed. The only generated files in git are images: README pictures, the
check:ux baselines, and the perf screenshots. A Linux CI runner cannot reproduce them byte for byte,
so CI does not verify them. Retake them on a Mac with the commands below.

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
| `modules/lsd-mono-core/report/dist/lsd-report.html` | `reportSingle` (`npm run build:single`), on every build | Packaged into the jar as `/lsd-mono-core/report/lsd-report.single.html`, the shell every report uses |
| `modules/lsd-mono-core/report/dist/lsd-report-payloads.js` | `reportSingle` | The shell's built-in demo when you open `dist/lsd-report.html` with no captured report |
| `modules/lsd-mono-core/build/pages/` (`index.html`, `kitchen-sink.html`, `kitchen-sink-payloads.js`) | `./gradlew :modules:lsd-mono-core:kitchenSinkSample` | The [Pages workflow](../.github/workflows/pages.yml) builds and publishes it on pushes to `main`. `index.html` is copied from [`docs/samples/index.html`](samples/index.html), which is source |
| `docs/perf-samples/` | `docs/perf/generate-*.mjs` | Local perf runs (gitignored) |

## Committed images (not verified in CI)

| File | How to retake (macOS, Node 22 via nvm, Chromium from Playwright) |
|------|----------|
| `docs/readme/feature-tour.gif`, `docs/readme/components.gif` | `./gradlew :modules:lsd-mono-core:readmeSamples` |
| `modules/lsd-mono-junit-jupiter/docs/readme/*` | `./gradlew :modules:lsd-mono-junit-jupiter:readmeSamples` |
| `modules/lsd-mono-cucumber-8/docs/readme/*` | `./gradlew :modules:lsd-mono-cucumber-8:readmeSamples` |
| All of the above | `./gradlew readmeSamples` |
| `modules/lsd-mono-core/report/checks/snapshots/*.png` (check:ux baselines) | In `modules/lsd-mono-core/report`, with port 4179 free: `npm run check:ux -- --update-snapshots`. Review the changed PNGs before you commit them |
| `docs/perf-results.md`, `docs/perf-screenshots/*.png` | A dated, hand-written measurement record. Redo it by hand when you re-measure (see `docs/perf`) |

Retake README images only when the UI they show changes. Sample reports use a fixed "generated at"
time (`lsd.samples.generatedAt` in `gradle.properties`, passed as `lsd.mono.report.generatedAt`)
and deterministic ids (`lsd.mono.ids.deterministic`). Regenerating them with an unchanged UI gives
the same report, so a retake shows only real changes.
