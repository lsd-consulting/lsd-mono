# Versioning and publishing

Not a release. No tag, no publish, and no version bump in this note.

## How it is versioned today

Group is `io.lsdconsulting`. The libraries are core (`lsd-mono-core`), junit-integration (`lsd-mono-junit-jupiter`), and cucumber-integration (`lsd-mono-cucumber-8`).

The train version is `0.0.1-SNAPSHOT`, set once on the root project. Each module inherits it. A module leaves the train only through a line in `gradle/version-overrides.properties`: `patch`, or `solo-major` with the train major it is allowed to diverge from. There is no such line today. The build fails if a module version differs from the train and no override is recorded.

Nothing is published. There is no tag. `.github/workflows/gradle.yml` only runs `./gradlew build` on push to `main` and on pull requests.

`gradle/libs.versions.toml` lists dependencies (Kotlin, JUnit `6.1.3`, Cucumber `8.0.4`). It is not the version of these libraries. There is no release plugin.

Renovate is the root `renovate.json`. It reads that shared catalog. JUnit and Cucumber updates are separate pull requests, each capped at the current major. A future Cucumber 9 module would be another catalog line plus another rule.

junit-integration and cucumber-integration depend on core as a project. A consumer takes core plus one integration. Cucumber 8 is `strictly [8,9)`.

## The train

One shared version across core, junit-integration, and cucumber-integration is the compatibility promise. Matching numbers mean those artifacts were released together and are meant to be used together.

Stay on `0.0.1-SNAPSHOT` until a real release. [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): while the version is `0.y.z`, the API is not stable. A released version is immutable. Maven Central will not take a version that ends in `-SNAPSHOT`.

### One artifact, patch only

A Renovate bump that moves one artifact's transitive dependencies releases that artifact alone, as a patch. The others stay.

cucumber-integration `1.2.0` to `1.2.1` because Cucumber's patch moved. core and junit-integration stay at `1.2.0`.

### Core major, all three

A core major puts all three on that major, in one train, even when an integration had no code change.

core `1.4.2` to `2.0.0` also publishes junit-integration `2.0.0` and cucumber-integration `2.0.0`.

### Solo major, then the train wins

An integration that breaks because its own dependency majors, and core did not change, takes a solo major on its own clock. core does not. A core major moves the train.

JUnit Jupiter's major bump breaks junit-integration while the train is still `1.4.2`. junit-integration goes `1.0.0`, then `2.0.0`. core and cucumber-integration stay at `1.4.2`. In that window, do not infer that junit-integration `2.0.0` means core `2.0.0`. The same applies to `1.0.0`: it is this module's own clock, not core's version.

At the next core major, the train number wins. The solo majors are changelog history, not added into the version. The next core major here is `3.0.0`, not `2.0.0`, because the solo release already used `2.0.0`. junit-integration's next release is `3.0.0`, the same number as core and cucumber-integration. It is not `3.0.0` plus the solo major, and the `2.0.0` line is not kept.

The override names the train major it may diverge from (`train-major:1` while the train is still `1.x`). When the train major moves, that line no longer matches, and the build fails until the line is removed. The module then inherits the new train version.

A future Cucumber 7 artifact follows the same rules: a solo major if Cucumber's major breaks it, then the next core major number. `lsd-mono-cucumber-8` stays on `[8,9)`.

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
