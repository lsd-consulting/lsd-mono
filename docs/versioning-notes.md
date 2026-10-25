# Versioning and publishing

How lsd-mono is versioned. How a release happens is in [releasing.md](releasing.md).

## How it is versioned today

Group is `io.github.lsd-consulting`, the Maven Central namespace lsd-core is published under (packages stay `io.lsdconsulting.lsd.mono`). The libraries are core (`lsd-mono-core`), junit-integration (`lsd-mono-junit-jupiter`), cucumber-integration (`lsd-mono-cucumber-8`), coroutines-integration (`lsd-mono-coroutines`), spring-boot-integration (`lsd-mono-spring-boot-4`), http4k-integration (`lsd-mono-http4k-6`), and the report model (`lsd-mono-report-model`) and writer (`lsd-mono-report-html`) that core writes its reports with and that a producer without core can use.

The train version is set once on the root project, from git (`TrainVersion.kt` in build-logic): `-Plsd.version=X.Y.Z` if given, else `X.Y.Z` on a commit tagged `vX.Y.Z`, else a snapshot of the next patch after the latest `v` tag (`0.0.1-SNAPSHOT` before the first tag, or in a shallow checkout without tags). `./gradlew -q printVersion` shows it. The report's `generator` field and the jar manifest follow it. Every module inherits it (`lsd.common`), and there is no per-module override: all eight artifacts always have the train version.

Releases go to Maven Central with semantic-release from conventional commits, once a week, from `main` once `gate` passed ([releasing.md](releasing.md#when-releases-happen)). Each release publishes all eight artifacts together, at one version; the first was `0.1.0` (17 October 2026).

`gradle/libs.versions.toml` lists dependencies (Kotlin, JUnit `6.1.3`, Cucumber `8.0.4`, kotlinx.coroutines `1.11.0`, Spring Boot `4.1.2`, http4k `6.61.0.0`). It is not the version of these libraries.

Renovate is the root `renovate.json`. It reads that shared catalog. JUnit and Cucumber updates are separate pull requests, each capped at the current major, kotlinx.coroutines is capped at major 1, Spring Boot is capped at major 4, and http4k at major 6. `spring-boot-junit`, the JUnit the Spring Boot BOM manages, is not a Renovate dependency: when a Spring Boot update moves it, `BootJunitVersionTest` fails on that pull request and it is bumped by hand there. A future Cucumber 9 module would be another catalog line plus another rule.

junit-integration, cucumber-integration, coroutines-integration, spring-boot-integration and http4k-integration depend on core as a project. A consumer takes core plus the integrations it needs. Cucumber 8 is pinned to major 8, coroutines-integration to kotlinx.coroutines major 1, and spring-boot-integration to Spring Boot major 4, Spring Framework major 7, Spring Data major 4, Spring for Apache Kafka major 4 and Apache Kafka major 4 (all compileOnly: the app brings its own Boot, and the Boot BOM sets the Spring Framework version), and http4k-integration to http4k major 6 (compileOnly too, and compiled for Java 21, which http4k 6 needs): the catalog holds the exact version and the build fails if anything resolves to another major.

## The train

One shared version across core, the integrations and the report model and writer is the compatibility promise. Matching numbers mean those artifacts were released together and are meant to be used together.

- **Lockstep.** Every release publishes all eight at the same version, even when only one changed. No artifact is released on its own, and none has a version of its own.
- **One decision.** semantic-release picks the version from all the commits since the last tag, whichever module they touch ([releasing.md](releasing.md#commit-messages)). A Renovate bump to one integration's dependency is `build(deps)` and releases nothing by itself: it goes out with the next weekly release, at the train version. A security fix is `fix(deps)`, a patch.
- **Majors move together.** A change that breaks one integration (say a new JUnit or Cucumber major) is a breaking change of the train. While the version is `0.y.z` that is a minor release of all eight; from v1 it is a major of all eight. A breaking change to the report model or the writer counts the same way.

Releases are `0.y.z` until the API is ready for v1 (see [releasing.md](releasing.md)). [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): while the version is `0.y.z`, the API is not stable. A released version is immutable. Maven Central will not take a version that ends in `-SNAPSHOT`.

Per-module versions (a patch of one artifact alone, a "solo major" for one integration) were considered and rejected: semantic-release decides one version per repository, and matching numbers would no longer mean the artifacts go together. A new major of a dependency gets a new artifact instead, as `lsd-mono-cucumber-8` is named for Cucumber 8 `lsd-mono-spring-boot-4` for Spring Boot 4 and `lsd-mono-http4k-6` for http4k 6.

A future Cucumber 7 or Cucumber 9 artifact joins the train: it starts at the train's version and is released with the rest.

### The report model and writer

`lsd-mono-report-model` and `lsd-mono-report-html` were split out of core in `0.8.0` and are on the train from that release: there is no earlier version of either, and every release since publishes them with core and the integrations ([#122](https://github.com/lsd-consulting/lsd-mono/issues/122)).

- **Same version as core, always.** lsd-mono-core depends on both at its own version (run-time scope). A build that also declares one of them directly should use the same version; mixing versions is not supported, and nothing checks for it.
- **Experimental API.** Their types are behind `@ExperimentalLsdReportModel` (an opt-in at level ERROR) with no binary-compatibility promise until the marker goes. A breaking change to them is a breaking change of the train, as above (a minor release while `0.y.z`). lsd-mono-core's own API exposes neither, so this does not reach a test that only uses core and its integrations.
- **Two versions, two meanings.** The train version (`X.Y.Z`) is the version of the code. The report format has its own version, `schemaVersion` in every report (`ReportSchema.VERSION` in the model), with its own rules: a schema minor only adds ([lsd-mono-report-schema](../modules/lsd-mono-report-schema/README.md)). A train release can leave the schema version alone; a change to the format raises it, with the schema change.
- **The compatibility rule.** Readers of the report format (the report UI, the validators, any other reader) ignore fields they do not know, and a schema minor version only adds optional fields, in 0.x and in 1.x alike ([the rule](../modules/lsd-mono-report-schema/README.md#the-compatibility-rule)). From 1.0, that is what lets a newer lsd-mono's report open in an older report page, and an older producer's report in a newer one. Schema 0.2.0 adds a message's `attributes` and `origin` and freezes `trace`, so OpenTelemetry import can come after 1.0 as an addition ([OpenTelemetry](../modules/lsd-mono-report-schema/README.md#opentelemetry)). Schema 0.3.0 adds a participant's `attributes` (`service.name`, `peer.service` and the like). In the same release the model's message `data` became a JSON value type (`DataValueJson`) instead of `Any?`: a breaking change to the experimental model's API, not to the format, which is written byte for byte as before.

### Tested-against dependencies

The library version is not the JUnit or Cucumber version it was built with. Consumers read those from the CI matrix or a versions file. Neither exists yet.

## Still open

- [x] **Publishing.** Maven Central, under these artifact ids so they do not clash with legacy `lsd-core`, `lsd-cucumber`, and `lsd-junit-jupiter` ([releasing.md](releasing.md)). Do not depend on published `lsd-core`.
- [x] **Release workflow.** `release.yml`, weekly on Tuesdays, checking `gate` on `main`, with a monthly cap.
- [ ] **Cucumber 7 artifact.** Still a product question. `cucumber-groovy` has no 8.x. Do not loosen the 8 pin.
- [ ] **Tested-against versions.** No CI matrix of JUnit and Cucumber versions and no versions file yet.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). `0.y.z` is initial development. A released version is not modified.
- [Requirements for components](https://central.sonatype.org/publish/requirements/). A Central version cannot end in `-SNAPSHOT`.
