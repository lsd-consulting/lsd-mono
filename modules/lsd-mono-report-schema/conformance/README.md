# Shared test reports (conformance)

Report data that every producer and reader of the format is tested against, so the Kotlin
writer, the report UI and any later producer agree on what a report is. `manifest.json` lists
every file: what it is for, the schema it is checked against, whether that schema must accept
it (and for a file it must reject, one place it rejects), and who writes it.

| Directory | Holds |
|-----------|-------|
| `reports/` | Reports the schema accepts |
| `invalid/` | Reports the schema must reject |
| `indexes/` | Index manifests (`window.__LSD_INDEX__`) |
| `payloads/` | A `-payloads.js` sidecar, which the page runs |
| `generated/` | `large.mjs`, which makes the large report instead of committing it |

## Who checks what

- **lsd-mono-core** (`ConformanceTest` and the golden tests) writes every file whose `source` is
  `lsd-mono-core` from the same scenarios, checks the output against the schema, and compares it
  with the file byte for byte. Only the time and the generator are set to fixed values
  (`2026-01-01T12:00:00Z`, `lsd-mono-core (conformance)`); ids are the deterministic ones, and the
  usage ping is off. It also checks every other JSON file against the schema with its validator
  (networknt, formats asserted), and that a large written report (100 participants, 400
  messages) follows it.
- **The report UI**: `src/conformance.test.ts` checks every file against the schema with ajv
  (formats asserted), and boots the whole page on every report the schema accepts, the large one
  included: each scenario in the Sequence and Components views and the Metrics panel, with no
  error and no element made from report text. On the next-major report it checks the upgrade
  page instead. `src/report-escaping.test.ts` does the same in more detail for
  `invalid/hostile.json`. `checks/conformance.spec.ts` opens the minimal, large, future-minor,
  Unicode and next-major reports in Chromium: never a blank page, no console error, no serious axe
  violation, the future-minor notice and the next-major upgrade page. Other checks open the example reports, and unit tests read the timing tree and the
  payload script.

Both sides fail on a file the manifest does not list, or a listed file that is missing.

## Changing a report

- **Written by lsd-mono-core:** change the scenario in the test, run
  `./gradlew :modules:lsd-mono-core:test --tests '*ConformanceTest*'`, and copy the file the
  failure names from `modules/lsd-mono-core/build/conformance-actual/` over this one. Review the
  difference like code: it is a change in what the producer writes.
- **Hand-written, captured or generated:** edit it; both sides re-check it against the schema. A
  captured report would be a copy of lsd-mono-core output kept as it was; there is none now.
  `reports/example-report.json` is written from the example report's scenarios like any
  lsd-mono-core file, and `reports/example-components.json` is kept by hand (its manifest entry
  says why).
- **A new file:** add it to `manifest.json`, and to `PRODUCED` in `ConformanceTest` if
  lsd-mono-core writes it.

## Versions in the UI

What the report UI does with another version (see the schema README's "Versions"):

- **A newer minor version** (`reports/future-minor.json`, 0.2.0): shown, with a small notice
  that anything new in it is not shown. Unknown fields are ignored, an open enum's unknown value
  falls back (a `ROBOT` participant is drawn as a plain one, a `BROADCAST` message as a call),
  and the event of an unknown kind is left out.
- **A newer major version** (`reports/next-major.json`, 1.0.0): not shown. The page says to
  upgrade lsd-mono instead, whatever the report's shape.
- **Another producer's report** (`reports/other-producer.json`): no options and no timing
  summary. The UI fills in its defaults when it loads the report.
