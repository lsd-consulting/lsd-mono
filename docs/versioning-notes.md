# Versioning and publishing

Not a release. No tag, no publish, and no version bump in this note.

## How it is versioned today

Group is `io.github.lsd-consulting`, the Maven Central namespace lsd-core is published under (packages stay `io.lsdconsulting.lsd.mono`). The libraries are core (`lsd-mono-core`), junit-integration (`lsd-mono-junit-jupiter`), cucumber-integration (`lsd-mono-cucumber-8`), and coroutines-integration (`lsd-mono-coroutines`).

The train version is set once on the root project, from git (`TrainVersion.kt` in build-logic): `-Plsd.version=X.Y.Z` if given, else `X.Y.Z` on a commit tagged `vX.Y.Z`, else a snapshot of the next patch after the latest `v` tag (`0.0.1-SNAPSHOT` before the first tag, or in a shallow checkout without tags). `./gradlew -q printVersion` shows it. The report's `generator` field and the jar manifest follow it. Every module inherits it (`lsd.common`). No module diverges today, so there is no override mechanism yet. When the first `patch` or `solo-major` is needed, add one: a recorded override per module, naming the train major it may diverge from, and a build check that fails when a module differs from the train without one.

Nothing is published. There is no tag. `.github/workflows/gradle.yml` only runs `./gradlew build` on push to `main` and on pull requests.

`gradle/libs.versions.toml` lists dependencies (Kotlin, JUnit `6.1.3`, Cucumber `8.0.4`, kotlinx.coroutines `1.11.0`). It is not the version of these libraries. There is no release plugin.

Renovate is the root `renovate.json`. It reads that shared catalog. JUnit and Cucumber updates are separate pull requests, each capped at the current major, and kotlinx.coroutines is capped at major 1. A future Cucumber 9 module would be another catalog line plus another rule.

junit-integration, cucumber-integration and coroutines-integration depend on core as a project. A consumer takes core plus the integrations it needs. Cucumber 8 is pinned to major 8, and coroutines-integration to kotlinx.coroutines major 1: the catalog holds the exact version and the build fails if anything resolves to another major.

## The train

One shared version across core, junit-integration, cucumber-integration, and coroutines-integration is the compatibility promise. Matching numbers mean those artifacts were released together and are meant to be used together.

Releases are `0.y.z` until the API is ready for v1 (see [releasing.md](releasing.md)). [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): while the version is `0.y.z`, the API is not stable. A released version is immutable. Maven Central will not take a version that ends in `-SNAPSHOT`.

### One artifact, patch only

A Renovate bump that moves one artifact's transitive dependencies releases that artifact alone, as a patch. The others stay.

cucumber-integration `1.2.0` to `1.2.1` because Cucumber's patch moved. core and junit-integration stay at `1.2.0`.

### Core major, all four

A core major puts all four on that major, in one train, even when an integration had no code change.

core `1.4.2` to `2.0.0` also publishes junit-integration `2.0.0`, cucumber-integration `2.0.0` and coroutines-integration `2.0.0`.

### Solo major, then the train wins

An integration that breaks because its own dependency majors, and core did not change, takes a solo major on its own clock. core does not. A core major moves the train.

JUnit Jupiter's major bump breaks junit-integration while the train is still `1.4.2`. junit-integration goes `1.0.0`, then `2.0.0`. core and cucumber-integration stay at `1.4.2`. In that window, do not infer that junit-integration `2.0.0` means core `2.0.0`. The same applies to `1.0.0`: it is this module's own clock, not core's version.

At the next core major, the train number wins. The solo majors are changelog history, not added into the version. The next core major here is `3.0.0`, not `2.0.0`, because the solo release already used `2.0.0`. junit-integration's next release is `3.0.0`, the same number as core and cucumber-integration. It is not `3.0.0` plus the solo major, and the `2.0.0` line is not kept.

The override should name the train major it may diverge from (`1` while the train is still `1.x`), so that when the train major moves the override no longer matches and the build fails until it is removed. The module then inherits the new train version.

A future Cucumber 7 artifact follows the same rules: a solo major if Cucumber's major breaks it, then the next core major number. `lsd-mono-cucumber-8` stays on major 8.

### Tested-against dependencies

The library version is not the JUnit or Cucumber version it was built with. Consumers read those from the CI matrix or a versions file. Neither exists yet.

## Still open

- [ ] **Publishing.** Maven Central or GitHub Packages, under these artifact ids so they do not clash with legacy `lsd-core`, `lsd-cucumber`, and `lsd-junit-jupiter`. Not configured. Do not depend on published `lsd-core`.
- [ ] **Tag workflow.** None yet. Keep it separate from `gradle.yml`. Do not publish until it exists.
- [ ] **Cucumber 7 artifact.** Still a product question. `cucumber-groovy` has no 8.x. Do not loosen the 8 pin.
- [ ] **CI matrix and versions file.** Not set up. Renovate is not wired to cut the single-artifact patch.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). `0.y.z` is initial development. A released version is not modified.
- [Requirements for components](https://central.sonatype.org/publish/requirements/). A Central version cannot end in `-SNAPSHOT`.
