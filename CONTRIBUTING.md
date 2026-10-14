# Contributing

## Build

Requires a JDK (the Java baseline is `jvm` in `gradle/libs.versions.toml`; Gradle provisions the toolchain) and Node 22 for the report UI. With [nvm](https://github.com/nvm-sh/nvm): `nvm use 22`.

```sh
./gradlew build verifyGenerated
```

`build` runs the Kotlin tests, Kover coverage, the ABI check, spotless, and the report UI's
typecheck, lint and Vitest suite. `verifyGenerated` fails if the build changed a tracked file, so
commit first and then run it. See [docs/ci.md](docs/ci.md) for every check and how to run it alone.

In `modules/lsd-mono-core/report`: `npm run typecheck`, `npm run lint`, `npm test` and
`npm run check:ux` (Playwright).

## Rules

- **Public API.** `lsd-mono-core` uses explicit API mode. A change to the public surface shows up in
  `modules/lsd-mono-core/api/lsd-mono-core.api`: run `./gradlew updateKotlinAbi` and commit the dump
  with the change, so it is reviewed.
- **No deprecation shims.** Nothing is published yet; change the API instead of keeping an old form.
- **Coverage only goes up.** Each module's floor (`lsdCoverage { lineFloor }`) and the Vitest
  thresholds fail the build when coverage drops below them, and also when coverage is more than 3
  points above them. Raise the floor when you add tests.
- **Formatting.** `./gradlew spotlessApply` for Kotlin, `npm run format` for the report UI.
- **Generated files** (samples, GIFs, the kitchen sink) are listed in
  [docs/generated-files.md](docs/generated-files.md) with the task that makes each one.

## Pull requests

Keep each pull request to one change, with tests. CI's `gate` check must pass; it waits for the
build and the JVM test matrix, and passes on its own for documentation-only changes.
