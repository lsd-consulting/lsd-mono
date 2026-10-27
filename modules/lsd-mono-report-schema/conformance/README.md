# Shared test reports (conformance)

Report data that every producer and reader of the format is tested against, so the Kotlin
writer, the report UI and any later producer agree on what a report is. `manifest.json` lists
every file: what it is for, the schema it is checked against, whether that schema must accept
it (and for a file it must reject, one place it rejects), and who writes it. A report the page
must still boot though the schema rejects it, or one the page does not show, also names the
page it gets (`page`: `report`, `upgrade` or `cannot-open`).

| Directory | Holds |
|-----------|-------|
| `reports/` | Reports the schema accepts |
| `invalid/` | Reports the schema must reject |
| `indexes/` | Index manifests (`window.__LSD_INDEX__`) |
| `payloads/` | A `-payloads.js` sidecar, which the page runs |
| `generated/` | `large.mjs`, which makes the large report instead of committing it |
| `vectors/` | Not reports: `status-vectors.json`, the error-status rule core's metrics and the page share |

## Who checks what

- **lsd-mono-jvm** (`ConformanceTest` and the golden tests) writes every file whose `source` is
  `lsd-mono-jvm` from the same scenarios, checks the output against the schema, and compares it
  with the file byte for byte. Only the time and the generator are set to fixed values
  (`2026-01-01T12:00:00Z`, `lsd-mono-jvm (conformance)`); ids are the deterministic ones, and the
  usage ping is off. It also checks every other JSON file against the schema with its validator
  (networknt, formats asserted), and that a large written report (100 participants, 400
  messages) follows it.
- **The report UI**: `src/conformance.test.ts` checks every file against the schema with ajv
  (formats asserted), and boots the whole page on every report the schema accepts, the large one
  included, and on each one with a `page`: each scenario in the Sequence and Components views and
  the Metrics panel, with no error and no element made from report text. The report from before
  versions (`invalid/missing-schema-version.json`) opens as usual; the next-major report gets the
  upgrade page and `invalid/malformed-version.json` the cannot-open page instead, and the test
  checks that each `page` is what the UI makes of the file's version. It boots the index page on
  `indexes/status-mix.json` and opens its report (`reports/multi-scenario-status.json`). `src/report-escaping.test.ts` does the same in more detail for
  `invalid/hostile.json`. `checks/conformance.spec.ts` opens the minimal, large, future-minor,
  Unicode and next-major reports and the status-mix index in Chromium: never a blank page, no
  console error, no serious axe violation, the future-minor notice and the next-major upgrade
  page. Other checks open the example reports, and unit tests read the timing tree and the
  payload script.

Both sides fail on a file the manifest does not list, or a listed file that is missing.

## Changing a report

- **Written by lsd-mono-jvm:** change the scenario in the test, run
  `./gradlew :modules:lsd-mono-jvm:test --tests '*ConformanceTest*'`, and copy the file the
  failure names from `modules/lsd-mono-jvm/build/conformance-actual/` over this one. Review the
  difference like code: it is a change in what the producer writes.
- **Hand-written, captured or generated:** edit it; both sides re-check it against the schema. A
  captured report would be a copy of lsd-mono-jvm output kept as it was; there is none now.
  `reports/example-report.json` is written from the example report's scenarios like any
  lsd-mono-jvm file, and `reports/example-components.json` is kept by hand (its manifest entry
  says why).
- **A new file:** add it to `manifest.json`, and to `PRODUCED` in `ConformanceTest` if
  lsd-mono-jvm writes it.

## Versions in the UI

What the report UI does with another version (see the schema README's "Versions"):

- **A newer minor version** (`reports/future-minor.json`, 0.4.0): shown, with a small notice
  that anything new in it is not shown. Unknown fields are ignored (span `links` on a message
  among them), an open enum's unknown value falls back (a `ROBOT` participant is drawn as a plain
  one, a `BROADCAST` message as a call, a `replayed` origin is kept as it is), and the event of an
  unknown kind is left out.
- **The OpenTelemetry fields** (`reports/otel-fields.json`): W3C and B3 trace ids, message
  attributes with every kind of value, participant attributes and imported messages. The page
  shows the report as usual; it does not show attributes or the origin yet.
- **A newer major version** (`reports/next-major.json`, 1.0.0): not shown. The page says to
  upgrade lsd-mono instead, whatever the report's shape.
- **A version that is not one** (`invalid/malformed-version.json`, `v2`): not shown either. The
  page says the report cannot be opened, without blaming a new major version.
- **No version** (`invalid/missing-schema-version.json`): a report from before the schema, shown
  as usual.
- **Another producer's report** (`reports/other-producer.json`): no options and no timing
  summary. The UI fills in its defaults when it loads the report.
