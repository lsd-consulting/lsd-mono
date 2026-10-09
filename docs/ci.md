# CI

Two workflows run on GitHub-hosted runners.

| Workflow | Runs on | Does |
|----------|---------|------|
| [Gradle](../.github/workflows/gradle.yml) | Pushes to `main`, pull requests, manual dispatch. Skipped when a change only touches Markdown, `docs/` or `modules/*/docs/` | `./gradlew build verifyGenerated`: compile, JVM tests, build-logic tests, the report shell build and Vitest, plus the [lint, format and coverage](#lint-format-and-coverage) checks. It then checks the build left no changed or new files ([generated files](generated-files.md)). Test reports are uploaded when it fails |
| [Pages](../.github/workflows/pages.yml) | Pushes to `main` that touch the report, the build or `docs/samples`, and manual dispatch | Builds the kitchen-sink site with `kitchenSinkSample` and deploys it to GitHub Pages |

## Lint, format and coverage

All of these run on `check`, so `./gradlew build` locally fails the same way CI does.

| What | Tool | Fix or look |
|------|------|-------------|
| Kotlin formatting and lint (modules, build scripts, build-logic) | ktlint 1.8 through Spotless (`lsd.formatting`); rules in `.editorconfig` | `./gradlew spotlessApply` |
| Kotlin line coverage | Kover (`lsd.coverage`); each module sets `lsdCoverage { lineFloor.set(n) }` | `./gradlew koverHtmlReport`, then `build/reports/kover/html/` |
| Kotlin HTML escaping | `HtmlEscapingGuardTest` (lsd-mono-core): only `html/Html.kt` escapes, and markup templates interpolate only escaped or markup values | The test names the file and line |
| Report UI types, including tests and Playwright checks | `tsc` (TypeScript 7) on `tsconfig.json` and `tsconfig.test.json` | `npm run typecheck` |
| Report UI lint | ESLint with typescript-eslint (type-checked rules) and `lsd/escaped-markup` | `npm run lint` |
| Report UI formatting | Prettier (`.prettierrc.json`) | `npm run format` |
| Report UI coverage | Vitest v8 coverage, thresholds in `vitest.config.ts` | `npm test`, then `modules/lsd-mono-core/build/reports/coverage/report-ui/` |

Coverage floors sit a little under the coverage when they were set, so they hold the line without
failing on noise. Raise a floor when tests are added; lower one only with a reason in the commit.
When the build fails, CI uploads the Kover and Vitest coverage reports with the test reports.

typescript-eslint needs the TypeScript 6 API, which TypeScript 7 does not have. The report installs
both: `@typescript/native` is TypeScript 7 and provides `tsc`, and `typescript` is the TypeScript 6
package (`@typescript/typescript6`) that ESLint loads. Drop the alias once typescript-eslint
supports TypeScript 7.

## Hardening

- **Permissions.** Both workflows default to `contents: read`. Only the Pages deploy job gets
  `pages: write` and `id-token: write`. Checkout does not keep the token (`persist-credentials: false`).
- **Pinned actions.** Every action is pinned to a full commit SHA, with its version in a comment.
  Renovate (`helpers:pinGitHubActionDigestsToSemver` in `renovate.json`) keeps the SHA and the
  comment up to date, and pins any new action it finds.
- **Wrapper validation.** `gradle/actions/setup-gradle` checks `gradle-wrapper.jar` against
  Gradle's published checksums before anything runs.
- **Timeouts.** 20 minutes for the build and 15 for Pages. A healthy run takes a few minutes, so
  these limits only catch a hung job.
- **Concurrency.** A new push to a pull request cancels that pull request's running build. Runs on
  `main` always finish, and Pages deploys one at a time.

## Runner image

Both jobs run on `ubuntu-24.04`, not `ubuntu-latest`. GitHub moves `ubuntu-latest` to Ubuntu 26.04
gradually between 19 October and 19 November 2026. On the floating label, an unchanged commit could
build on either image during that window, and a failure would look like a code problem. With the
label pinned, the image only changes in a pull request. Renovate proposes the new runner version
there, and the build runs on it before it merges.

The build needs little from the image. Java and Node come from `setup-java` and `setup-node`, and
the JDK 21 toolchain comes from the image or from foojay. So moving to `ubuntu-26.04` should only
need that pull request to go green.

## Speed

- **Gradle user home cache.** `setup-gradle` with `cache-provider: basic` caches dependencies, the
  wrapper distribution and the local build cache. This is the MIT-licensed provider, built on
  `actions/cache`. The default `enhanced` provider is a proprietary component under Gradle's terms
  of use; switch to it only if you accept those terms. The cache key is a hash of the build files,
  so a dependency change starts from an empty cache once. Only `main` writes the cache. Pull
  requests read it.
- **Gradle properties** (`gradle.properties`). Build cache, parallel project execution and
  configuration cache are on. CI does not keep the configuration cache between runs: that needs an
  encryption key, which `setup-gradle` v6 no longer supports. It still saves time locally.
- **npm cache.** `setup-node` caches npm downloads, keyed on `report/package-lock.json`.
- **Daemon.** No `--no-daemon`. A single build on CI uses one daemon either way, and this avoids
  starting a second JVM for the build's JVM settings.

## Not in CI

- **`npm run check:ux`** (Playwright screenshots) is manual. Its baselines are made on macOS, and
  font and anti-aliasing differences on Linux would fail every comparison. Run it on a Mac before
  you merge a UI change. See [generated files](generated-files.md) for refreshing the baselines.
- **README images** (`readmeSamples`) are retaken by hand on a Mac.
