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

## Rules

- **Public API.** `lsd-mono-core` uses explicit API mode. A change to the public surface shows up in
  `modules/lsd-mono-core/api/lsd-mono-core.api`: run `./gradlew updateKotlinAbi` and commit the dump
  with the change, so it is reviewed.
- **No deprecation shims.** Until v1, change the API instead of keeping an old form, and say what to change in a
  `BREAKING CHANGE:` footer.
- **Conventional commits.** `type(scope)!: subject`, lower case, no full stop. The types, and which of them
  release, are in the table in [docs/releasing.md](docs/releasing.md#commit-messages). semantic-release turns them
  into releases; while the version is 0.x a breaking change (`!` or a `BREAKING CHANGE:` footer) gives a minor. CI
  checks every commit and pull request title. There is no changelog file: the
  [release notes](https://github.com/lsd-consulting/lsd-mono/releases) are generated from the commits. So write the
  subject for users, put the explanation they need in the body, and put what they must change in a
  `BREAKING CHANGE:` footer.
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
