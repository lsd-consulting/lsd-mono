# lsd-mono-core

First-party **LSD Mono** core library. This is the greenfield product path:
report UI in `report/` (Vite + TypeScript + custom SVG), plus a
thin Kotlin/JVM capture and report façade so integrations (e.g.
`lsd-mono-junit-jupiter`) can migrate off published Maven `lsd-core`.

## What this is / is not

| | |
|--|--|
| **Is** | Mono-owned artifact `lsd-mono-core`, package `io.lsdconsulting.lsd.mono.core` |
| **Is** | Report UI in `report/` (`modules/lsd-mono-core/report`) |
| **Is not** | A vendor of legacy Maven `io.github.lsd-consulting:lsd-core` sources |
| **Legacy reference** | Upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) for API / behaviour comparison |

## Layout

```
lsd-mono-core/
├── report/                 # Vite+TS report UI (dev with npm)
│   ├── src/                     # UI, custom SVG diagram, sample data
│   ├── dist/                    # build output (gitignored): lsd-report.html and the demo's lsd-report-payloads.js
│   └── README.md
├── src/main/kotlin/…/mono/core/ # Kotlin façade (capture + write reports)
└── build.gradle.kts                 # reportSingle + reportTest; packages dist/lsd-report.html as the jar's shell
```

## What runs today (`./gradlew build`)

**Works now**

- Kotlin library compiles and tests
- `LsdContext` façade: facts, `completeScenario`, `completeReport`, `createIndex`,
  `clear`, id generation and HTML escaping
- The public API is checked: explicit API mode, and an ABI dump in `api/lsd-mono-core.api`
  that `check` compares against (see [generated files](../../docs/generated-files.md))
- `completeReport` writes, per report, files named `<title>-<hash>` (the hash is of the report
  key, or of the title when there is no key):
  - `*-diagram.html` — the classpath shell (`/lsd-mono-core/report/lsd-report.single.html`) with the captured
    `ReportJson` injected (the shell falls back to sample data when opened without one)
  - `*-payloads.js` — message bodies, loaded when the inspector opens
  - `*-report.json` — ReportJson-shaped payload (aligned with `report/src/types.ts`)
  - `*-report.html` — minimal mono HTML listing scenarios (status, description, facts)
  - `index.html` from `createIndex`, listing every report in the directory
  - Files are written to a temporary file and moved into place. There are no shared
    "latest" files, so test classes, forks and modules can share one directory.
- Report page: a **Component diagram** button per scenario draws the components and their calls in the inspector, in the browser, from that scenario's messages

**Deferred / optional**

- PlantUML / Handlebars compatibility — intentionally out of the Mono product path; see upstream [lsd-core](https://github.com/lsd-consulting/lsd-core) for legacy reference

## Component diagram

Each scenario's diagram toolbar has a **Component diagram** button. Clicking it draws that scenario's components and the calls between them in the side panel. The report builds the diagram in the browser from the messages it already has, so there is nothing to switch on in the build and no extra file.

![Clicking Component diagram and the diagram opening in the side panel](../../docs/readme/components.gif)

- Every participant on a sync, async, bi-directional, or lost message is a component, drawn with its participant type (actor, database, queue, and so on). Responses and short arrows add no edges.
- Links carry no captions, so a busy pair of components stays readable. Sync links are solid and async links are dashed, and the head shows the direction. Repeated calls between the same two components share one link with a small count badge.
- Hover over a link to see its messages in its tooltip, for example `Orders to Orders DB, 3 interactions:` then `load basket · sync` on the next line. Click a link, or focus it and press Enter, to list them under the drawing.
- Callers sit above the components they call. Escape or Close puts focus back on the button.

`./gradlew :modules:lsd-mono-core:readmeSamples` regenerates the GIF with the other README samples.

## Kotlin API (migration-oriented)

Inspired by legacy entry points (`LsdContext`, `Status`, properties, popup links)
but under the **mono** package:

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.Status

val lsd = LsdContext.instance
lsd.addFact("framework", "junit-jupiter-6")
lsd.completeScenario("my scenario", "<p>ok</p>", Status.SUCCESS)
lsd.completeReport("My Suite")
lsd.createIndex()
```

Property keys use the `lsd.mono.*` prefix (with fallbacks to legacy `lsd.core.*`
and `lsd.junit.*` names where useful for migration).

### Threads and parallel tests

Every `LsdContext` method is thread-safe. Unscoped calls (`capture`, `message`,
`addFact`, `completeScenario`) go to:

1. the scenario the calling thread is bound to, if any;
2. otherwise the only running scenario, if exactly one is running;
3. otherwise the default scenario, which is how single-threaded code has always
   worked. With several scenarios running, a warning is logged once.

Test integrations start a scenario per test and group them by report key:

```kotlin
val scenario = lsd.beginScenario(reportKey = "com.example.OrderTest") // binds this thread
lsd.message("Client", "Api", "POST /orders")                          // lands in `scenario`
executor.submit(lsd.wrap { lsd.message("Api", "Db", "INSERT") })       // so does this
scenario.complete("places an order")
lsd.completeReport("OrderTest", reportKey = "com.example.OrderTest")
```

`LsdScenario` also has `capture`, `addFact` and `bind()` (an `AutoCloseable`).
A capture into a scenario that has already completed is dropped
with a warning rather than being given to the next one.

### Message data

Message data is copied when it is captured, so changing a body, builder or buffer
after the call does not change the report. The copy is plain JSON:

- maps become objects (keys that are not strings use their text, and a repeated
  key gets ` #2`); iterables and arrays become lists;
- Kotlin data classes, Java records and other classes become objects of their fields;
- `Optional` becomes its value or `null`, enums their name, and `java.time` values,
  `Date`, `UUID` and similar types their ISO or plain text;
- `ByteArray` and `ByteBuffer` become text when they are UTF-8 text, otherwise
  `[lsd: binary, N bytes] base64:...`;
- a `Throwable` becomes `{"exception": ..., "message": ...}`.

Capturing never throws. Anything that cannot be copied becomes a `[lsd: ...]`
marker in its place: a cycle, a `toString()` or accessor that throws, or a value
past one of these limits:

| Property | Default | Marker |
| --- | --- | --- |
| `lsd.mono.payload.maxDepth` | 32 | `[lsd: max depth 32 reached]` |
| `lsd.mono.payload.maxStringLength` | 100000 | `… [lsd: truncated N characters]` |
| `lsd.mono.payload.maxItems` | 1000 | `[lsd: N more items]`, or a `"[lsd: truncated]"` key |
| `lsd.mono.payload.maxTotalSize` | 1000000 | `[lsd: payload larger than N characters, rest dropped]` |

To copy a type differently (a JSON tree, say), register a converter. Its result
is copied in turn:

```kotlin
lsd.payloads.register(JsonNode::class.java) { mapper.convertValue(it, Map::class.java) }
```

`lsd.clear()` re-reads the limits and keeps the converters.

### Escaping

Report text is plain data and is escaped wherever it is written, with one escaper
per context:

| Context | Kotlin (written files) | Report UI (`report/src/lib/escape.ts`) |
| --- | --- | --- |
| Element text | `Html.text` | `escapeHtml` |
| Quoted attribute value | `Html.attribute` | `escapeAttr` |
| JSON in `<script>` or a `.js` file | `jsonString` / `JsonValue.render()` | `jsonForScript` |
| CSS selector | | `cssEscape` |

JSON for scripts escapes `<`, `>`, `&`, U+2028, U+2029 and control characters, and
writes a lone surrogate as `\ufffd`. The Kotlin HTML escapers also replace control
characters and lone surrogates with U+FFFD, because the files are UTF-8. A scenario
description that contains `<mark>` keeps only bare `p`, `br`, `mark`, `strong`, `em`,
`b`, `i` and `code` tags; anything else in it is shown as text.

## Report UI (manual)

```bash
cd modules/lsd-mono-core/report
npm ci
npm test             # vitest — layout, diagram view (zoom/fit/columns/search), SVG cues
npm run dev          # http://localhost:5173/
npm run build:single # then open report/dist/lsd-report.html in Chrome (file://)
```

`./gradlew :modules:lsd-mono-core:build` runs `reportSingle` (`npm ci` and `npm run build:single`) and `reportTest` (`npm test`). `build:single` writes `report/dist/lsd-report.html` (gitignored), and the build packages it from `build/generated/resources`; no built shell is committed. Set `lsd.mono.report.generatedAt` (an ISO-8601 instant) to fix the report's "generated at" time, as the sample tasks do for reproducible output. Needs Node 22.6 or later (`engines` in `report/package.json`). The Gradle tasks prepend nvm Node 22 when it is installed (`build-logic` `NodeToolchain.kt`) and do not change your default Node.

See `report/README.md` for how to run the report UI.
