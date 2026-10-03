# Versioning and publishing

Follow-up after the first push of `main` to [lsd-mono](https://github.com/lsd-consulting/lsd-mono) (`6c481b7`). Not a release. No tag, no publishing, and no version bump in this note.

Today every module version is `0.0.1-SNAPSHOT` (root `build.gradle.kts`, and the module build files that set it). The catalog still requests concrete dependency versions (`junit = "6.1.3"`, `cucumber = "8.0.4"`). Those are not the published artifact versions.

The JUnit module directory is `modules/lsd-mono-junit-jupiter` (project `:modules:lsd-mono-junit-jupiter`), not `lsd-mono-jupiter`.

Tick items off in this file as they are done. Do not treat a ticked item as shipped until it is on `main`.

- [ ] **Versioning scheme.** Decide semantic versions per module, or one version for the whole repo. Per module lets Cucumber 8 move without cutting a core release. One repo version is simpler for a consumer who takes core, JUnit, and Cucumber together. Record the choice here before any publish.

- [ ] **Gradle publishing.** Publish `lsd-mono-core`, `lsd-mono-cucumber-8`, and `lsd-mono-junit-jupiter` to Maven Central or GitHub Packages. Use Mono artifact names so they do not clash with legacy `lsd-core` / `lsd-cucumber` / `lsd-junit-jupiter`. Central Portal needs signing. Not set up yet.

- [ ] **Automated version bumps.** Once the scheme in the first item is chosen, bump versions from that scheme (commit, tag, or a Gradle task). Do not hand-edit `0.0.1-SNAPSHOT` in each build file as the long-term path.

- [ ] **Snapshots on main, releases on tags.** Decide whether every `main` build publishes a `-SNAPSHOT`, and whether a release publish happens only from a tag. Until that is decided, do not publish from the CI workflow.

- [ ] **GitHub Release workflow on tags.** Add a workflow that runs when a tag is pushed, and creates the GitHub Release. Keep it separate from `.github/workflows/gradle.yml`, which only runs `./gradlew build` on push to `main` and on pull requests. No release workflow exists yet.

- [ ] **Cucumber 7 artifact.** `lsd-mono-cucumber-8` constrains Cucumber to `strictly [8,9)`, so a Cucumber 7 project cannot use it. `cucumber-groovy` has no 8.x (latest 6.10.4) and is not on that classpath. Decide whether a separate Cucumber 7 module is needed (legacy `lsd-cucumber` compiled against `cucumber-plugin` 7.34.9). Do not loosen the `[8,9)` pin on the 8 module to cover 7.
