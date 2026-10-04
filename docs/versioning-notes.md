# Versioning and publishing

Not a release. No tag, no publish, and no version bump in this note.

## How it is versioned today

Every published-library version is `0.0.1-SNAPSHOT`, set on the root and again on `lsd-mono-core`, `lsd-mono-junit-jupiter`, and `lsd-mono-cucumber-8`. Group is `io.lsdconsulting` (convention plugin). Artifact ids are `lsd-mono-core`, `lsd-mono-junit-jupiter`, and `lsd-mono-cucumber-8`. Nothing is published.

`gradle/libs.versions.toml` is the catalog of *dependencies* (Kotlin, JUnit `6.1.3`, Cucumber `8.0.4`, and a reference-only `lsd-core` that mono modules must not use). It is not the version of these libraries. There is no nebula, shipkit, gradle-release, semantic-release, release-please, or changesets plugin. `.github/workflows/gradle.yml` only runs `./gradlew build` on push to `main` and on pull requests.

The JUnit and Cucumber modules depend on core with `api(project(":modules:lsd-mono-core"))`. A consumer takes core plus one integration. Cucumber 8 is `strictly [8,9)`.

## Decision

Use one version for the whole repo (fixed mode). Stay on `0.0.1-SNAPSHOT` until the first real release. Do not publish from CI yet.

These three libraries are one product. They are built and tested together, and an integration is only valid against the core it was compiled with. Matching versions tell a consumer which core goes with which integration. Independent versions would make that a compatibility puzzle for no gain: there are three modules, not a large set of loosely related packages.

Rejected: independent versions per module, including release-please or changesets bumps that move only the module that changed. A core change has to ship with the integration that compiles against it. A future Cucumber 7 *artifact*, if one is added, would still share this version. It is not a reason to split.

When publishing starts (not now):

- Semantic Versioning. `0.y.z` means the API is not stable. A released version is immutable. Maven Central will not accept a version that ends in `-SNAPSHOT`.
- Cut that release from a git tag, one tag for all three artifacts. Do not publish a snapshot on every `main` build, and do not add release-please until there is something to release.
- Central also expects a sources jar, a javadoc jar, GPG signatures, and POM name, description, URL, license, developers, and SCM. None of that is set up.
- Do not depend on published `lsd-core`.

The version string is copied in four build files. Collapse it to one assignment when publishing is wired. Do not do that in this note.

## Still open

- [ ] **Publishing.** Maven Central or GitHub Packages, Mono artifact names so they do not clash with legacy `lsd-core` / `lsd-cucumber` / `lsd-junit-jupiter`. Not configured.
- [ ] **Single version assignment.** Four copies of `0.0.1-SNAPSHOT` today. One assignment later, not a catalog entry.
- [ ] **Tag workflow.** None yet. Keep it separate from `gradle.yml`. Do not publish until it exists.
- [ ] **Cucumber 7 artifact.** Still a product question. `lsd-mono-cucumber-8` stays on `[8,9)`. `cucumber-groovy` has no 8.x. A Cucumber 7 module would share the repo version. Do not loosen the 8 pin.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). `0.y.z` is initial development. Once released, that version is not modified. Major, minor, and patch apply from 1.0.0.
- [Version Catalogs](https://docs.gradle.org/current/userguide/version_catalogs.html) (Gradle 9.8.0). A catalog is a list of dependencies. One `libs.versions.toml` is the usual place for those coordinates. It does not set the project's own version.
- [Choosing Fixed vs Independent Versioning in a Monorepo](https://www.javascript-package-publishing.com/package-publishing-and-release/semantic-versioning-and-release-automation/choosing-fixed-vs-independent-versioning/). Fixed mode is one version for packages that are only valid together. Independent mode is for packages consumed separately.
- [Release Please](https://github.com/googleapis/release-please). Release PRs from Conventional Commits, then a tag. It can release several artifacts from one repo. It does not publish to a package manager. Not adopted here.
- [Naming conventions of Maven coordinates](https://maven.apache.org/guides/mini/guide-naming-conventions.html). A `-SNAPSHOT` is a changing build between releases, usually the next version plus `-SNAPSHOT`.
- [Guide to uploading artifacts to the Central Repository](https://maven.apache.org/repository/guide-central-repository-upload). Central takes releases only, and does not replace a release after it is published.
- [Requirements](https://central.sonatype.org/publish/requirements/). Sources and javadoc jars, checksums, GPG, and POM metadata. A Central version cannot end in `-SNAPSHOT`.
