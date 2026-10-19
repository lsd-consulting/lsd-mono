# Versioning and publishing

How lsd-mono is versioned. How a release happens is in [releasing.md](releasing.md).

## How it is versioned today

Group is `io.github.lsd-consulting`, the Maven Central namespace lsd-core is published under (packages stay `io.lsdconsulting.lsd.mono`). The libraries are core (`lsd-mono-core`), junit-integration (`lsd-mono-junit-jupiter`), cucumber-integration (`lsd-mono-cucumber-8`), and coroutines-integration (`lsd-mono-coroutines`).

The train version is set once on the root project, from git (`TrainVersion.kt` in build-logic): `-Plsd.version=X.Y.Z` if given, else `X.Y.Z` on a commit tagged `vX.Y.Z`, else a snapshot of the next patch after the latest `v` tag (`0.0.1-SNAPSHOT` before the first tag, or in a shallow checkout without tags). `./gradlew -q printVersion` shows it. The report's `generator` field and the jar manifest follow it. Every module inherits it (`lsd.common`), and there is no per-module override: all four artifacts always have the train version.

Releases go to Maven Central with semantic-release from conventional commits, after `gate` on `main` ([releasing.md](releasing.md)). Each release publishes all four artifacts together, at one version; the first was `0.1.0` (17 October 2026).

`gradle/libs.versions.toml` lists dependencies (Kotlin, JUnit `6.1.3`, Cucumber `8.0.4`, kotlinx.coroutines `1.11.0`). It is not the version of these libraries.

Renovate is the root `renovate.json`. It reads that shared catalog. JUnit and Cucumber updates are separate pull requests, each capped at the current major, and kotlinx.coroutines is capped at major 1. A future Cucumber 9 module would be another catalog line plus another rule.

junit-integration, cucumber-integration and coroutines-integration depend on core as a project. A consumer takes core plus the integrations it needs. Cucumber 8 is pinned to major 8, and coroutines-integration to kotlinx.coroutines major 1: the catalog holds the exact version and the build fails if anything resolves to another major.

## The train

One shared version across core, junit-integration, cucumber-integration, and coroutines-integration is the compatibility promise. Matching numbers mean those artifacts were released together and are meant to be used together.

- **Lockstep.** Every release publishes all four at the same version, even when only one changed. No artifact is released on its own, and none has a version of its own.
- **One decision.** semantic-release picks the version from all the commits since the last tag, whichever module they touch ([releasing.md](releasing.md#commit-messages)). A Renovate bump to one integration's dependency releases the train like any other `fix`.
- **Majors move together.** A change that breaks one integration (say a new JUnit or Cucumber major) is a breaking change of the train. While the version is `0.y.z` that is a minor release of all four; from v1 it is a major of all four.

Releases are `0.y.z` until the API is ready for v1 (see [releasing.md](releasing.md)). [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): while the version is `0.y.z`, the API is not stable. A released version is immutable. Maven Central will not take a version that ends in `-SNAPSHOT`.

Per-module versions (a patch of one artifact alone, a "solo major" for one integration) were considered and rejected: semantic-release decides one version per repository, and matching numbers would no longer mean the artifacts go together. A new major of a dependency gets a new artifact instead, as `lsd-mono-cucumber-8` is named for Cucumber 8.

A future Cucumber 7 or Cucumber 9 artifact joins the train: it starts at the train's version and is released with the other four.

### Tested-against dependencies

The library version is not the JUnit or Cucumber version it was built with. Consumers read those from the CI matrix or a versions file. Neither exists yet.

## Still open

- [x] **Publishing.** Maven Central, under these artifact ids so they do not clash with legacy `lsd-core`, `lsd-cucumber`, and `lsd-junit-jupiter` ([releasing.md](releasing.md)). Do not depend on published `lsd-core`.
- [x] **Release workflow.** `release.yml`, called from `gradle.yml` after `gate`.
- [ ] **Cucumber 7 artifact.** Still a product question. `cucumber-groovy` has no 8.x. Do not loosen the 8 pin.
- [ ] **Tested-against versions.** No CI matrix of JUnit and Cucumber versions and no versions file yet.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). `0.y.z` is initial development. A released version is not modified.
- [Requirements for components](https://central.sonatype.org/publish/requirements/). A Central version cannot end in `-SNAPSHOT`.
