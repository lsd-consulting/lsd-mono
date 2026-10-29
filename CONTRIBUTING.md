# Contributing

## Build

Requires a JDK (the Java baseline is `jvm` in `gradle/libs.versions.toml`; Gradle provisions the toolchain) and, for the report UI, the Node version in [`.nvmrc`](.nvmrc), which CI uses too. With [nvm](https://github.com/nvm-sh/nvm): `nvm use`.

```sh
./gradlew build verifyGenerated
```

`build` runs the Kotlin tests, Kover coverage, the ABI check, spotless, and the report UI's
typecheck, lint and Vitest suite. `verifyGenerated` fails if the build changed a tracked file, so
commit first and then run it. See [docs/ci.md](docs/ci.md) for every check and how to run it alone.

In `modules/lsd-mono-report-html/ui`: `npm run typecheck`, `npm run lint`, `npm test` and
`npm run check:ux` (Playwright).

The Java baseline is 17, set once as `jvm` in `gradle/libs.versions.toml`: the code compiles for it and the tests run on a JDK 17 toolchain (found locally or provisioned by foojay; your default JDK is not changed). `./gradlew test -Plsd.test.jvm=21` runs the tests on another JDK. `:modules:lsd-mono-report-html:build` runs the Vite shell build (`npm ci`, then `npm run build:single`) and vitest is on `check`. Those tasks prepend the nvm Node named in `.nvmrc` (the one CI uses) and leave the default alias alone.

`check` also lints and measures coverage: ktlint for the Kotlin (`./gradlew spotlessApply` fixes formatting), Kover line-coverage floors per module, and for the report UI a type-check of the code and its tests, ESLint, Prettier and Vitest coverage thresholds. See [lint, format and coverage](docs/ci.md#lint-format-and-coverage).

## From this repository

Another project in this build depends on the modules directly:

```kotlin
dependencies {
    implementation(project(":modules:lsd-mono-jvm"))
    testImplementation(project(":modules:lsd-mono-junit-jupiter"))
    testImplementation(project(":modules:lsd-mono-cucumber-8"))
    testImplementation(project(":modules:lsd-mono-coroutines")) // only if tests capture from coroutines
    testImplementation(project(":modules:lsd-mono-spring-boot-4")) // only for @SpringBootTest suites
    testImplementation(project(":modules:lsd-mono-http4k-6")) // only for http4k apps
    testImplementation(project(":modules:lsd-mono-ktor-3")) // only for Ktor apps
}
```

They are compiled with `--release 17` (`lsd-mono-http4k-6` with `--release 21`, as http4k 6 needs Java 21), and CI tests on Java 17, 21 and 25. Cucumber support is major 8, Spring Boot support major 4, http4k support major 6, Ktor support major 3.

## Layout

```
modules/lsd-mono-jvm/            lsd-mono-jvm: capture, timing, the report model mapping
modules/lsd-mono-report-model/    the report as plain Kotlin values
modules/lsd-mono-report-html/     the report writer, report UI in ui/
modules/lsd-mono-junit-jupiter/   JUnit Jupiter 6 extension
modules/lsd-mono-cucumber-8/      Cucumber 8 plugin
modules/lsd-mono-coroutines/      keeps a scenario bound across coroutine thread hops
modules/lsd-mono-spring-boot-4/   Spring Boot 4 starter
modules/lsd-mono-http4k-6/        http4k 6 filters (HTTP server and client, WebSockets)
modules/lsd-mono-ktor-3/          Ktor 3 plugins (HTTP server and client, WebSockets)
build-logic/                      convention plugins (lsd.kotlin-jvm)
```

## The README tour and the sample site

Regenerate the tour GIF at the top of the README from the current UI:

```bash
./gradlew :modules:lsd-mono-jvm:readmeSamples
```

The task captures the tour report with `LsdContext`, then drives the packaged shell with headless Chromium and encodes `docs/readme/feature-tour.gif`. It uses the Node major in `.nvmrc` from nvm when that is installed (else the newest nvm Node of at least 22.6), and it does not change the default Node alias. It is not part of `build` or `check`.

The live sample site (the [example report](https://lsd-consulting.github.io/lsd-mono/example-report.html) and the integrations' sample reports) is built by the [Pages workflow](.github/workflows/pages.yml) from each release, once the release is tagged. To build the example report and its index locally, then open `modules/lsd-mono-jvm/build/pages/index.html` in a browser:

```bash
./gradlew :modules:lsd-mono-jvm:kitchenSinkSample
```

### The example report

The [example report](https://lsd-consulting.github.io/lsd-mono/example-report.html) (the live report linked above) is one report that uses every diagram feature, so layout problems are easy to spot. It follows an online shop order across 14 lifelines in five scenarios: a timed checkout, happy path, payment declined (captured out of order), out of stock, and async fulfilment. It covers every participant shape, every arrow type, short arrows to and from the edge, self-calls, nested and overlapping activations, notes, sections, delays, spacers, realistic HTTP, SQL and Kafka payloads with headers, timestamps, and warning and errored scenarios. The timed checkout shows the timing API: measured durations, trace and span ids, events put back in clock order (marked clock-ordered), and the Timing view's swim lanes and waterfall. [`KitchenSinkSample.kt`](modules/lsd-mono-jvm/src/readme/kotlin/io/github/lsdconsulting/lsd/mono/jvm/readme/KitchenSinkSample.kt) captures it. The report is not committed. The [Pages workflow](.github/workflows/pages.yml) builds it from each release, once the release is tagged, so it shows the latest release, and publishes it with the [`index.html`](https://lsd-consulting.github.io/lsd-mono/) that `createIndex()` writes for it.

### Module README screenshots

The diagrams in the JUnit Jupiter and Cucumber READMEs are regenerated from the current UI:

```bash
./gradlew :modules:lsd-mono-junit-jupiter:readmeSamples
./gradlew :modules:lsd-mono-cucumber-8:readmeSamples
```

The JUnit task captures the same scenario its README shows (with the titles `LsdExtension` would use); the Cucumber task runs the feature through `LsdCucumberPlugin`. Each then screenshots the packaged shell with headless Chromium via the report UI's `readme-samples.mjs` (lsd-mono-report-html/ui). It uses the Node major in `.nvmrc` from nvm when that is installed (else the newest nvm Node of at least 22.6), and it does not change the default Node alias. It is not part of `build` or `check`.

## The report UI

```bash
cd modules/lsd-mono-report-html/ui
npm ci
npm test             # vitest — layout, diagram view (zoom/fit/columns/search), SVG cues
npm run build:single # then open dist/lsd-report.html in Chrome (file://)
```

`./gradlew :modules:lsd-mono-report-html:build` (and so a build of core) runs `reportSingle` (`npm ci` and `npm run build:single`) and `reportTest` (`npm test`). `build:single` writes `ui/dist/lsd-report.html` (gitignored), and the build packages it from `build/generated/resources`; no built shell is committed. Set `lsd.mono.report.generatedAt` (an ISO-8601 instant) to fix the report's "generated at" time, as the sample tasks do for reproducible output. Needs Node 22.6 or later (`engines` in `ui/package.json`). The Gradle tasks prepend the nvm Node named in the repo's `.nvmrc` (CI's Node) when it is installed, else the newest nvm Node of at least 22.6 (`build-logic` `NodeToolchain.kt`), and do not change your default Node.

See [the report UI's README](modules/lsd-mono-report-html/ui/README.md) for how to run it.

## Rules

- **Public API.** `lsd-mono-jvm` uses explicit API mode. A change to the public surface shows up in
  `modules/lsd-mono-jvm/api/lsd-mono-jvm.api`: run `./gradlew updateKotlinAbi` and commit the dump
  with the change, so it is reviewed. Report model and writer types (`lsd-mono-report-model`,
  `lsd-mono-report-html`) must never appear in core's public API: core's users would get "cannot
  access class" errors, and the model's experimental opt-in would leak into core's API.
- **No deprecation shims.** Until v1, change the API instead of keeping an old form, and say what to change in a
  `BREAKING CHANGE:` footer.
- **Conventional commits.** `type(scope)!: subject`, lower case, no full stop. The types, and which of them
  release, are in the table in [docs/releasing.md](docs/releasing.md#commit-messages). semantic-release turns them
  into releases; while the version is 0.x a breaking change (`!` or a `BREAKING CHANGE:` footer) gives a minor. CI
  checks every commit and pull request title. There is no changelog file: the
  [release notes](https://github.com/lsd-consulting/lsd-mono/releases) are generated from the commits. So write the
  subject for users, put the explanation they need in the body, and put what they must change in a
  `BREAKING CHANGE:` footer.
- **Releases are weekly.** Merging to `main` does not release: the Release workflow releases what has built up every
  Tuesday at 07:00 UK time, at most 4 times a month, to stay inside Maven Central's limits. For a fix that cannot
  wait, run it by hand once `gate` passes on `main` ([docs/releasing.md](docs/releasing.md#an-urgent-release)).
- **Coverage only goes up.** Each module's floor (`lsdCoverage { lineFloor }`) and the Vitest
  thresholds fail the build when coverage drops below them, and also when coverage is more than 3
  points above them. Raise the floor when you add tests.
- **Formatting.** `./gradlew spotlessApply` for Kotlin, `npm run format` for the report UI.
- **Generated files** (samples, GIFs, the example report) are listed in
  [docs/generated-files.md](docs/generated-files.md) with the task that makes each one.

## Pull requests

Keep each pull request to one change, with tests. CI's `gate` check must pass; it waits for the
commit-message check, the build and the JVM test matrix, and passes without a build for documentation-only changes.
The pull request title is the squash-merge message, so it must be a conventional commit too.
