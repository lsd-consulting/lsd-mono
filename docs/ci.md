# CI

Two workflows run on GitHub-hosted runners.

| Workflow | Runs on | Does |
|----------|---------|------|
| [Gradle](../.github/workflows/gradle.yml) | Pushes to `main`, pull requests, manual dispatch. Skipped when a change only touches Markdown, `docs/` or `modules/*/docs/` | `./gradlew build verifyGenerated`: compile, JVM tests, build-logic tests, the report shell build and Vitest. It then checks the build left no changed or new files ([generated files](generated-files.md)). Test reports are uploaded when it fails |
| [Pages](../.github/workflows/pages.yml) | Pushes to `main` that touch the report, the build or `docs/samples`, and manual dispatch | Builds the kitchen-sink site with `kitchenSinkSample` and deploys it to GitHub Pages |

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
