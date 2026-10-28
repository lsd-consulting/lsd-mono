# Releasing

lsd-mono releases to Maven Central from [conventional commits](https://www.conventionalcommits.org) with
[semantic-release](https://semantic-release.gitbook.io), the way lsd-core does. Until v1 every release is `0.y.z`:
the API is not stable yet ([versioning-notes.md](versioning-notes.md)).

## What gets published

Group `io.github.lsd-consulting` (the Central namespace lsd-core already publishes under), one train version for all nine:

| Artifact | Module |
| --- | --- |
| `io.github.lsd-consulting:lsd-mono-jvm` | `modules/lsd-mono-jvm` |
| `io.github.lsd-consulting:lsd-mono-junit-jupiter` | `modules/lsd-mono-junit-jupiter` |
| `io.github.lsd-consulting:lsd-mono-cucumber-8` | `modules/lsd-mono-cucumber-8` |
| `io.github.lsd-consulting:lsd-mono-coroutines` | `modules/lsd-mono-coroutines` |
| `io.github.lsd-consulting:lsd-mono-spring-boot-4` | `modules/lsd-mono-spring-boot-4` |
| `io.github.lsd-consulting:lsd-mono-http4k-6` | `modules/lsd-mono-http4k-6` |
| `io.github.lsd-consulting:lsd-mono-ktor-3` | `modules/lsd-mono-ktor-3` |
| `io.github.lsd-consulting:lsd-mono-report-model` | `modules/lsd-mono-report-model` |
| `io.github.lsd-consulting:lsd-mono-report-html` | `modules/lsd-mono-report-html` |

Each has its jar, a sources jar, a javadoc jar (Dokka's javadoc format), Gradle module metadata and a POM with name,
description, URL, MIT licence, developer and SCM, all signed (`build-logic/src/main/kotlin/lsd.publishing.gradle.kts`). A module
under `modules/` with a build is published; `RootReadmeExampleTest` fails when one is missing from this table or the
root README's.

### The lsd-mono-core relocation

`lsd-mono-core` was renamed `lsd-mono-jvm` ([#126](https://github.com/lsd-consulting/lsd-mono/issues/126)). v0.15.0, the
first release of `lsd-mono-jvm`, also published a POM-only `io.github.lsd-consulting:lsd-mono-core` at 0.15.0 that
relocates to `lsd-mono-jvm` at the same version. That POM stays on Central; the build no longer publishes it, and later
versions exist only as `lsd-mono-jvm`.

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

Renovate writes `build(deps): …` for dependency updates, which release nothing: they go out with the next release that
has a `feat`, `fix` or `perf`. Security fixes are the exception: `fix(deps): …`, a patch release (`renovate.json`).
Write `fix(deps): …` by hand for a dependency update users need shipped.

## When releases happen

Once a week: the Release workflow (`release.yml`) runs every **Tuesday at 07:00 UK time** and releases whatever has
built up on `main` since the last release, all in one version. A week with nothing to release (no `feat`, `fix`, `perf`
or breaking change) publishes nothing. Merging to `main` no longer releases by itself.

The reason is Maven Central's monthly publishing limits, which count across the whole `lsd-consulting` organisation:
**188 releases, 9,430 files and 1,050 MB a month** (the Central Portal's Usage Center). Every lsd-mono release publishes
all its artifacts, so releasing on every push would soon go over them.

Renovate fits the week: it opens its pull requests on Monday mornings (UK time), with every minor and patch update in
one pull request and only versions out for at least three days, so they can be merged before Tuesday's release.

### The monthly cap

The workflow also stops at a cap of releases a calendar month (UTC), counting lsd-mono's GitHub releases: the repository
variable `MAX_RELEASES_PER_MONTH`, currently set to **10**, or 4 when it is unset. The limits are the organisation's:
releases of the other lsd-consulting libraries count towards them too.
Check the Usage Center before going over the cap.

### An urgent release

For a fix that cannot wait for Tuesday, such as a security fix: merge it to `main` as a `fix`, wait for `gate` to pass on
`main`, then run the Release workflow by hand, from `main`:

```sh
gh workflow run release.yml --ref main
# over this month's cap: say why (it goes in the run summary)
gh workflow run release.yml --ref main -f override_cap=true -f reason="security fix for CVE-…"
```

Or Actions → Release → Run workflow, leaving `tag` empty. The same checks apply as on Tuesday, except that
`override_cap` lets it go over the cap.

## How a release happens

1. The schedule (or a run by hand) starts `release.yml`. Its `plan` job goes on only if the repository variable
   `RELEASE_ENABLED` is `true`, there is a `feat`, `fix`, `perf` or breaking change since the last `v` tag, `gate`
   (`gradle.yml`) passed on `main`'s latest commit, and the monthly cap is not reached. The run summary says which
   check stopped it.
2. `semantic-release --dry-run` (config `tools/release/.releaserc.json`) works out the next version from the commits
   since the last `v` tag. No `feat`, `fix`, `perf` or breaking change means no release, and the job ends there.
3. A version that is not `0.y.z` fails the job (the guard in `release.yml`).
4. Gradle publishes that version and releases it on Central in one run:
   `./gradlew publishToSonatype closeAndReleaseStagingRepositories -Plsd.version=X.Y.Z --no-configuration-cache`.
   It goes through the Central Portal's OSSRH staging API with the nexus publish plugin, as lsd-core does; the staging
   API wants publish, close and release from one IP, so they run together.
5. Only then does `semantic-release` tag `vX.Y.Z` and write the GitHub release notes. A failed publish leaves no tag, so
   the next run (next Tuesday, or one by hand) tries again.
6. The `pages` job deploys the sample site from the new tag (`pages.yml`).

The [GitHub release notes](https://github.com/lsd-consulting/lsd-mono/releases) are the changelog. There is no `CHANGELOG.md`.
semantic-release writes them from the commits since the last tag: each `feat`, `fix` and `perf` subject under its
heading, with a link to the commit, and the text of every `BREAKING CHANGE:` footer under "BREAKING CHANGES". So:

- Write the subject for a user of the library: what changes for them, not how.
- Put the explanation a user needs (what was wrong, what to do differently) in the commit body. The notes link to it.
- Put anything a user must change in a `BREAKING CHANGE:` footer. That text goes into the notes word for word.
- When a release needs more than that, edit its GitHub release after it is published.

### The README install snippets

The root README's install snippets show the latest release, between the `<!-- release-version:start -->` and
`<!-- release-version:end -->` markers. After each new release the `readme` job in release.yml runs
`tools/release/update-readme-version.sh <version>`, which rewrites every x.y.z inside the markers, and opens a pull
request `docs: show <version> in the README install snippets` from the branch `docs/readme-v<version>`.

- It does not push to main, which requires the `gate` check.
- A pull request opened with the workflow's token starts no workflows, so close and reopen it to run `gate`, then merge
  it. It is a docs commit, so it releases nothing.
- `RootReadmeExampleTest` checks that the markers are there once each, and that the Gradle and Maven snippets inside
  them show one x.y.z version and no `X.Y.Z` placeholder.
- To move the version by hand, run the script with the version and commit the result.

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
   Variables). Until then the weekly run releases nothing.

## When something fails

- **Publish failed** (no tag was made): fix the cause, then run the Release workflow by hand or wait for Tuesday; it
  releases the same version. A staging
  deployment left behind shows on the Central Portal's Deployments page, where it can be dropped.
- **Published, but tagging failed**: the job says so. Tag the released commit by hand (`git tag -a vX.Y.Z <sha>` and
  push it), otherwise the next release would try the same version again.
- **Tag made, publish needs repeating**: run the Release workflow by hand (Actions → Release → Run workflow) with the
  tag, such as `v0.1.0`. It checks out the tag and publishes it; the gate and cap checks are skipped, and a repeated
  publish counts towards Maven Central's limits again.
- **Gate was red on Tuesday**: the run stops with "gate on … is failure". Fix `main`, then run the workflow by hand.

## Building a version locally

`./gradlew -q printVersion` prints the version a build would have: `-Plsd.version` if given, else `X.Y.Z` on a commit
tagged `vX.Y.Z`, else a snapshot of the next patch. `./gradlew publishToMavenLocal` publishes to `~/.m2`
without signing. Set `ORG_GRADLE_PROJECT_signingKey` and `ORG_GRADLE_PROJECT_signingPassword` to sign locally.

## Switching to v1

When the API is ready for 1.0.0:

1. Remove the `releaseRules` entry in `tools/release/.releaserc.json`, so a breaking change gives a major again.
2. Remove the `0.*` guard in `release.yml`'s "Work out the next version" step.
3. Push a commit with a `BREAKING CHANGE:` footer (or `feat!:`), which the next release then makes `1.0.0`.
4. Update this page, [versioning-notes.md](versioning-notes.md) and `CONTRIBUTING.md`.
