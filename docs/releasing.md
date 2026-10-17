# Releasing

lsd-mono releases to Maven Central from [conventional commits](https://www.conventionalcommits.org) with
[semantic-release](https://semantic-release.gitbook.io), the way lsd-core does. Until v1 every release is `0.y.z`:
the API is not stable yet ([versioning-notes.md](versioning-notes.md)).

## What gets published

Group `io.github.lsd-consulting` (the Central namespace lsd-core already publishes under), one train version for all four:

| Artifact | Module |
| --- | --- |
| `io.github.lsd-consulting:lsd-mono-core` | `modules/lsd-mono-core` |
| `io.github.lsd-consulting:lsd-mono-junit-jupiter` | `modules/lsd-mono-junit-jupiter` |
| `io.github.lsd-consulting:lsd-mono-cucumber-8` | `modules/lsd-mono-cucumber-8` |
| `io.github.lsd-consulting:lsd-mono-coroutines` | `modules/lsd-mono-coroutines` |

Each has its jar, a sources jar, a javadoc jar (Dokka's javadoc format), Gradle module metadata and a POM with name,
description, URL, MIT licence, developer and SCM, all signed (`build-logic/src/main/kotlin/lsd.publishing.gradle.kts`).

## Commit messages

`type(scope)!: subject`, lower case, no full stop, at most 100 characters. CI's `commits` job checks every pushed commit
and each pull request's title (the squash-merge message) with commitlint (`tools/release/commitlint.config.mjs`), and
`gate` requires it. To check a message locally: `cd tools/release && npm ci && echo "feat: …" | npx commitlint`.

| Type | Release while 0.x | Release from v1 |
| --- | --- | --- |
| `fix`, `perf` | patch | patch |
| `feat` | minor | minor |
| any type with `!` or a `BREAKING CHANGE:` footer | **minor** | major |
| `docs`, `build`, `ci`, `chore`, `test`, `refactor`, `style`, `revert` | none | none |

Renovate writes `fix(deps): …` for runtime dependency updates (a patch release) and `chore(deps): …` for the rest.

## How a release happens

1. A push to `main` runs `gradle.yml`. When `gate` passes, its `release` job calls `release.yml`, only if the
   repository variable `RELEASE_ENABLED` is `true`.
2. `semantic-release --dry-run` (config `tools/release/.releaserc.json`) works out the next version from the commits
   since the last `v` tag. No `feat`, `fix`, `perf` or breaking change means no release, and the job ends there.
3. A version that is not `0.y.z` fails the job (the guard in `release.yml`).
4. Gradle publishes that version and releases it on Central in one run:
   `./gradlew publishToSonatype closeAndReleaseStagingRepositories -Plsd.version=X.Y.Z --no-configuration-cache`.
   It goes through the Central Portal's OSSRH staging API with the nexus publish plugin, as lsd-core does; the staging
   API wants publish, close and release from one IP, so they run together.
5. Only then does `semantic-release` tag `vX.Y.Z` and write the GitHub release notes. A failed publish leaves no tag, so
   the next push tries again.

The GitHub release carries the generated notes. `CHANGELOG.md` stays hand-written: after a release, move its
`Unreleased` entries under the new version in a `docs:` commit, and set the version in the root README's
"Getting started" snippets (`lsdMonoVersion` and `lsd-mono.version`) to the new release in the same commit.

The artifacts show on Maven Central (`repo1.maven.org`) a few minutes to half an hour after the job.

## One-off setup before the first release

Done for 0.1.0 (17 October 2026); kept for reference.

1. **Baseline tag.** semantic-release starts at `1.0.0` when there is no tag. Tag the last commit before the
   publishing work as `v0.0.0`, so the first `feat` after it releases `0.1.0`:
   ```sh
   git tag -a v0.0.0 7ca4ce3 -m "Baseline for semantic-release: releases start at 0.1.0"
   git push origin v0.0.0
   ```
   Without it the job stops with "Releases stay on 0.x until v1" instead of releasing 1.0.0.
2. **Secrets.** The organisation secrets lsd-core uses, already visible to lsd-mono: `SONATYPE_USERNAME` and
   `SONATYPE_PASSWORD` (a Central Portal user token), `SIGNING_KEY` (ASCII-armoured private key) and
   `SIGNING_PASSWORD`. The job fails before publishing if one is empty.
3. **Turn it on.** Set the repository variable `RELEASE_ENABLED` to `true` (Settings → Secrets and variables → Actions →
   Variables). Until then pushes build and test but never release.

## When something fails

- **Publish failed** (no tag was made): fix the cause and push; the next run releases the same version. A staging
  deployment left behind shows on the Central Portal's Deployments page, where it can be dropped.
- **Published, but tagging failed**: the job says so. Tag the released commit by hand (`git tag -a vX.Y.Z <sha>` and
  push it), otherwise the next release would try the same version again.
- **Tag made, publish needs repeating**: run the Release workflow by hand (Actions → Release → Run workflow) with the
  tag, such as `v0.1.0`. It checks out the tag and publishes it.

## Building a version locally

`./gradlew -q printVersion` prints the version a build would have: `-Plsd.version` if given, else `X.Y.Z` on a commit
tagged `vX.Y.Z`, else a snapshot of the next patch. `./gradlew publishToMavenLocal` publishes to `~/.m2`
without signing. Set `ORG_GRADLE_PROJECT_signingKey` and `ORG_GRADLE_PROJECT_signingPassword` to sign locally.

## Switching to v1

When the API is ready for 1.0.0:

1. Remove the `releaseRules` entry in `tools/release/.releaserc.json`, so a breaking change gives a major again.
2. Remove the `0.*` guard in `release.yml`'s "Work out the next version" step.
3. Push a commit with a `BREAKING CHANGE:` footer (or `feat!:`), which then releases `1.0.0`.
4. Update this page, [versioning-notes.md](versioning-notes.md) and `CONTRIBUTING.md`.
