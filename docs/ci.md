# CI

Three workflows run on GitHub-hosted runners.

| Workflow | Runs on | Does |
|----------|---------|------|
| [Gradle](../.github/workflows/gradle.yml) | Pushes to `main`, pull requests, manual dispatch. Skipped when a change only touches Markdown, `docs/` or `modules/*/docs/` | `./gradlew build verifyGenerated`: compile, JVM tests, build-logic tests, the report shell build and Vitest, plus the [lint, format and coverage](#lint-format-and-coverage) checks. It then checks the build left no changed or new files ([generated files](generated-files.md)). Test reports are uploaded when it fails. In parallel, `check-ux` runs the report UI's [Playwright checks](#report-ui-checks-checkux) when the report UI changed |
| [Release](../.github/workflows/release.yml) | Tuesdays at 07:00 UK time, and manual dispatch from `main` | Releases `main` to Maven Central when there is a `feat`, `fix`, `perf` or breaking change since the last tag, `gate` passed on `main`'s latest commit and the month's cap is not reached ([releasing.md](releasing.md#when-releases-happen)). With a `tag`, publishes that tag again |
| [Pages](../.github/workflows/pages.yml) | Called by the Release workflow after a new release, with its tag, and manual dispatch (main, or a tag given as `ref`) | Builds the example report site (report index plus report) with `kitchenSinkSample`, the Spring Boot starter's sample report under `spring-boot-4/` and the http4k integration's under `http4k-6/` with their `sampleReport` tasks, from the release tag, with the full history so the report shows that version, and deploys it to GitHub Pages |

## Lint, format and coverage

All of these run on `check`, so `./gradlew build` locally fails the same way CI does.

| What | Tool | Fix or look |
|------|------|-------------|
| Kotlin formatting and lint (modules, build scripts, build-logic) | ktlint 1.8 through Spotless (`lsd.formatting`); rules in `.editorconfig` | `./gradlew spotlessApply` |
| Kotlin line coverage | Kover (`lsd.coverage`), not counting the `readme` source sets (sample programs); each module sets `lsdCoverage { lineFloor.set(n) }`; a ratchet also fails when coverage is more than 3 points above the floor, so raise it | `./gradlew koverHtmlReport`, then `build/reports/kover/html/` |
| Kotlin HTML escaping | `HtmlEscapingGuardTest` (lsd-mono-core): only lsd-mono-report-html's `Html.kt` escapes, and markup templates interpolate only escaped or markup values | The test names the file and line |
| Report UI types, including tests and Playwright checks | `tsc` (TypeScript 7) on `tsconfig.json` and `tsconfig.test.json` | `npm run typecheck` |
| Report UI lint | ESLint with typescript-eslint (type-checked rules) and `lsd/escaped-markup` | `npm run lint` |
| Report UI formatting | Prettier (`.prettierrc.json`) | `npm run format` |
| Report UI coverage | Vitest v8 coverage, thresholds in `vitest.config.ts` overall and per folder (`src/lib/**`, `src/ui/**`, `src/app/**`); `scripts/coverage-ratchet.mjs` fails when a metric is more than 3 points above its threshold and lists files under 50% of lines | `npm test`, then `modules/lsd-mono-core/build/reports/coverage/report-ui/` |

Coverage floors sit a little under the coverage when they were set, so they hold the line without
failing on noise. Raise a floor when tests are added; lower one only with a reason in the commit.
When the build fails, CI uploads the Kover and Vitest coverage reports with the test reports.

typescript-eslint needs the TypeScript 6 API, which TypeScript 7 does not have. The report installs
both: `@typescript/native` is TypeScript 7 and provides `tsc`, and `typescript` is the TypeScript 6
package (`@typescript/typescript6`) that ESLint loads. Drop the alias once typescript-eslint
supports TypeScript 7.

## Report UI checks (`check:ux`)

The `check-ux` job runs `npm run check:ux` in `modules/lsd-mono-report-html/ui`: the Playwright checks
in `checks/` (layout, keyboard, axe, print and forced colours, themes, phone layouts) in headless
Chromium against the Vite dev server on port 4179, plus `checks/offline.spec.ts`, which opens the
single-file report that `check:ux` builds first and fails on any network request other than the
usage ping. It needs no Gradle build, so it runs alongside
`build` and `jvm-tests`, and only when the report UI, `.nvmrc` or `gradle.yml` changed.

- **Chromium only.** The job installs Chromium's headless shell (`--only-shell`), the only browser
  the checks launch. `~/.cache/ms-playwright` is cached under a key holding the `@playwright/test`
  version from `package-lock.json`, so a Playwright update downloads the matching build once.
  The system libraries come from `playwright install-deps` on every run, because apt packages are
  not cached. This is used rather than the `mcr.microsoft.com/playwright` image: the image is
  well over a gigabyte with every browser in it, and its tag would be one more version to keep in
  step with the lockfile.
- **Screenshot tests stay local.** The tests tagged `@screenshot` in `checks/ux-diagram.spec.ts`
  (each theme, and the fitted diagram: four baselines in `checks/snapshots/`) compare pixels
  with baselines taken on macOS. Linux draws fonts differently, so `playwright.config.ts` leaves
  them out (`grepInvert`) when `CI` is set, which GitHub Actions does. Locally they run as usual;
  `CI=1 npm run check:ux` runs the CI set. Keep layout assertions in untagged tests so CI checks them.
- **Parallel.** The checks run fully parallel: three workers on CI, half the cores locally
  (`playwright.config.ts`). Each test opens its own page, so none may depend on another's state;
  `npx playwright test --repeat-each 2` finds one that does. CI runs the phone swipe matrix in
  `checks/sheet-mobile.spec.ts` on the iPhone only; a local run adds the Pixel.
- **On failure** the job uploads the HTML report (`playwright-report/`) and the traces of the
  failed tests (`test-results/`) as the `playwright-report` artifact. Open a trace with
  `npx playwright show-trace <trace.zip>`.

## Required check: `gate`

`gradle.yml` runs on every push and pull request. A `changes` job decides whether anything the
build reads changed (everything except Markdown, `docs/` and `modules/*/docs/`). If not, `build`
and `jvm-tests` are skipped. It also decides whether the report UI, or the shared test reports its checks open
(`modules/lsd-mono-report-schema/conformance/`), changed; if not, `check-ux` is skipped. A `commits` job checks that every pushed commit, and a pull request's title, is a conventional commit (commitlint,
`tools/release/commitlint.config.mjs`; see [releasing.md](releasing.md)). The `gate` job always runs and passes only when every job passed or
was skipped, so it is the one check to require on `main`: a docs-only pull request gets a green
`gate` instead of waiting for a build that never starts.

## Hardening

- **Permissions.** Every workflow defaults to `contents: read`. Only the Pages deploy job gets
  `pages: write` and `id-token: write`, and only the release job `contents: write` (to push the tag and write the
  GitHub release). The release's `plan` job, which decides whether to release, gets `checks: read` to read `gate`
  and holds no secrets. The release job reads the Gradle cache but never writes it, and runs Gradle without the
  configuration cache, so the signing key is not stored anywhere. Checkout does not keep the token (`persist-credentials: false`).
- **Pinned actions.** Every action is pinned to a full commit SHA, with its version in a comment.
  Renovate (`helpers:pinGitHubActionDigestsToSemver` in `renovate.json`) keeps the SHA and the
  comment up to date, and pins any new action it finds.
- **Wrapper validation.** `gradle/actions/setup-gradle` checks `gradle-wrapper.jar` against
  Gradle's published checksums before anything runs.
- **Timeouts.** 20 minutes for the build, 15 for `check-ux` and for Pages. A healthy run takes a few minutes, so
  these limits only catch a hung job. 30 for a release.
- **Concurrency.** A new push to a pull request cancels that pull request's running build. Runs on
  `main` always finish, and Pages deploys one at a time. Releases run one at a time and are never cancelled.

## Pages reruns

Each attempt of a Pages run uploads its site as its own artifact, `github-pages-<attempt>`, and
deploys that one (#108). Before, every attempt uploaded `github-pages` into the same run, so once a
deploy failed (as in the v0.6.2 release, when `deploy-pages` briefly could not find the artifact it
had just been given), a rerun found two artifacts of that name and failed, and so did every rerun
after it. Now **Re-run failed jobs** on the `deploy` job deploys.

If a rerun still fails, start a fresh run for the release tag instead; that is how v0.6.2 deployed:

```
gh workflow run pages.yml -f ref=vX.Y.Z
```

## Runner image

Every job in both workflows runs on `ubuntu-26.04`, not `ubuntu-latest`. GitHub moves
`ubuntu-latest` to Ubuntu 26.04 gradually between 19 October and 19 November 2026. On the floating
label, an unchanged commit could build on either image during that window, and a failure would look
like a code problem. With the label pinned, the image only changes in a pull request. Renovate
proposes the next runner version there, and the build runs on it before it merges.

The build needs little from the image. Java and Node come from `setup-java` and `setup-node`
(JDK 17, the toolchain, plus the JDK that runs Gradle; Node from `.nvmrc`). `check-ux` also installs
Chromium's system libraries with `playwright install-deps`, so the Playwright version must support
the image (1.64 is the first to support Ubuntu 26.04).

## Java and Node versions

- **Java baseline: 17**, the `jvm` version in `gradle/libs.versions.toml` and nowhere else. Kotlin
  compiles with `jvmTarget` 17 and `-Xjdk-release=17`, Java with `--release 17`, on a JDK 17
  toolchain. The published bytecode runs on 17 and later.
- **Test matrix.** The `build` job runs everything on 17. The `jvm-tests` jobs rerun only the JVM
  tests on 21 and 25 (`./gradlew test -Plsd.test.jvm=<n>`), still compiled for 17, without the report
  UI checks, verifyGenerated or Pages. That keeps the extra cost to two short jobs.
- **JDK discovery.** `setup-java` installs each JDK a job needs and exports `JAVA_HOME_<n>_X64`;
  `org.gradle.java.installations.fromEnv` in `gradle.properties` points Gradle at them.
- **Node** comes from `.nvmrc`, read by `setup-node` (`node-version-file`) and by the Gradle Node
  lookup (`build-logic` `NodeToolchain.kt`), so the two cannot drift.
- **Renovate** groups JDK and Node updates; a new major of either waits for approval on the
  dependency dashboard. Raising the Java baseline is a manual change to `jvm`.

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
- **npm cache.** `setup-node` caches npm downloads, keyed on `ui/package-lock.json` (in modules/lsd-mono-report-html).
- **Daemon.** No `--no-daemon`. A single build on CI uses one daemon either way, and this avoids
  starting a second JVM for the build's JVM settings.

## Not in CI

- **`npm run check:ux`** (Playwright screenshots) is manual. Its baselines are made on macOS, and
  font and anti-aliasing differences on Linux would fail every comparison. Run it on a Mac before
  you merge a UI change. See [generated files](generated-files.md) for refreshing the baselines.
- **README images** (`readmeSamples`) are retaken by hand on a Mac.
