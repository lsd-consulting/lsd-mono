# Changelog

All notable changes to lsd-mono. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[docs/versioning-notes.md](docs/versioning-notes.md). Releases are `0.y.z` until v1 ([docs/releasing.md](docs/releasing.md)).
Each [GitHub release](https://github.com/lsd-consulting/lsd-mono/releases) also has notes generated from its commits;
this file is written by hand.

## [Unreleased]

### Fixed

- The report header shows when it was generated in the reader's own time zone with its real abbreviation (for example
  `1 Jan 2026, 12:00 GMT`). It used to always convert to London time and label it `BST`, even in winter.

## [0.2.0] - 2026-10-17

### Added

- Usage ping: a report written by a release requests one tiny version-pinned file from jsDelivr
  (`ping/<event>.txt`) at most once per event per page load, for `report-open`, `metrics-open`,
  `components-open` and the integration that wrote it (`source-junit`, `source-cucumber`, `source-api`). It sends no
  report content, never affects the page, and is off for snapshot builds. `lsd.mono.report.usagePing=false` turns it
  off; report options now carry `usagePing` and `source`. See [Usage ping](README.md#usage-ping).

### Fixed

- The report no longer loads Inter and JetBrains Mono from Google Fonts: the Latin variable fonts (SIL Open Font
  License 1.1) are embedded in the single-file report, so it makes no network request (except the optional usage
  ping) and looks the same offline. The report file grows by about 115 KB.

## [0.1.0] - 2026-10-17

The first release on Maven Central.

### Added

- Maven Central coordinates `io.github.lsd-consulting:lsd-mono-core`, `lsd-mono-junit-jupiter`, `lsd-mono-cucumber-8`
  and `lsd-mono-coroutines`, each with sources and javadoc jars. Releases are `0.y.z` until v1, cut by semantic-release
  from conventional commits ([docs/releasing.md](docs/releasing.md)).
- Core capture and report API (`lsd-mono-core`), with JUnit Jupiter, Cucumber 8 and coroutines integrations.
- Interactive report UI: sequence diagram, component diagram, inspector, timing and metrics. The Metrics view lists the
  message count and captured duration; slow calls show in the Timing view's summary strip, swim lanes and waterfall
  (there is no separate ranked Bottlenecks list, and report JSON has no `insights`).
- Timing API (slice 1): accuracy, call pairing, clock ordering with structural guards, and the Timing view
  (summary strip, swim lanes and waterfall).
- The Metrics view's captured duration counts each call once, the same duration the JSON shows on the call, so a
  call with its own duration and a timed reply is no longer counted twice.
- Report JSON writes a call's duration on the call: a call carries its own `durationMs` or its reply's, and a
  paired reply carries none. The diagram label, inspector and Timing view read it from the call.
- An interaction's `status` drives an `Errors` metric (4xx/5xx codes or error words such as `failed`), and the
  inspector labels an error status in words.
- `LsdContext.configure(Consumer<TimingConfig>)` sets the clock ordering (`orderByStartedAt(mode)`) the same way
  from Java and Kotlin. It replaces the `LsdContext.orderByStartedAt` property.
- On a phone, tapping an arrow scrolls its payload JSON into view below the sticky top bar, and opening the
  component diagram or metrics scrolls the panel's heading there (smoothly, unless reduced motion is set; nothing
  moves when it is already on screen).
- `Interaction.headers`: protocol headers shown beside the body in the payload (`{ headers, body }`), redacted
  like any map key.
- A call that took longer than the call it runs inside is a report warning ("longer than parent"), and the Timing waterfall says in words when calls inside take longer than a call's measured time (it used to show only "!"): "Calls inside took longer: 25 ms > 10 ms", full sentence on hover.
- Calls nest by `parentSpanId`: a call goes under the open call whose span its trace names (same trace), so concurrent calls captured interleaved nest under the right parent, in the report analysis and the Timing view.
- `ALL_SOURCES` clock ordering keeps apart only the source pair whose clocks disagree with the structure: that pair keeps its captured interleaving (each source still clock-ordered), every other source stays clock-ordered against them, and the `skew` warning names just that pair, instead of dropping clock order for the whole group. Calls that share a span id in one trace are a `duplicate span` warning.
- Accuracy per participant pair: `pairAccuracy` in the report JSON when pairs differ, shown as "Accuracy by pair" in the Timing view.
- Report JSON: `parentId` (the call a message runs inside) and `replyOf` (the call a paired reply answers) on each message. The Timing view builds its tree from them instead of pairing and nesting again, so it always matches the library (span nesting, duplicate spans, the `ALL_SOURCES` fallback).
- Timing warnings in the report JSON are `{ kind, message }` (`LONGER_THAN_PARENT`, `SKEW`, …); the Timing view labels its pills from `kind`, with the sentence on hover.
- One name for a start time: the clock-ordering option is `orderByStartedAt` (`lsd.mono.timing.orderByStartedAt` and `LsdProperties.TIMING_ORDER_BY_STARTED_AT`, `TimingConfig.orderByStartedAt`, `Timing.orderByStartedAt`/`withOrderByStartedAt`), and every report event writes `startedAt` (structural rows used to write `createdAt`).
- Narrow screens (860px and below) fold the scenario list (the index's report list) to the selected item under
  an "N scenarios ▾" disclosure; a typed search lists every match. On phones, search and the status chips
  share one row (the chips show their counts, and keep their names for screen readers).
- Phones: scrolling slides the top bar's first row (brand, theme, help) away with the page, so only search and
  the chips stay (58px instead of 134px); the diagram toolbar likewise keeps only its Find row stuck under
  it. No class flip or animation: plain sticky offsets, so nothing jumps and reduced motion has nothing to
  reduce. Panel and JSON reveals land below the smaller bar.
- Phones: the timing chips and the section links each sit on one row that scrolls sideways, and the diagram
  hint line is left out, so the diagram starts higher. The description (with why a scenario did not pass) and
  key facts come before the diagram, as on wider screens.
- Fit (automatic and the button) stops at 50% so labels and touch targets stay usable; a wider diagram scrolls
  sideways. Zoom out still reaches 25%.
- Arrows with a payload show a `{}` marker after their label, with a hover title, and a one-line legend under
  the diagram toolbar explains it ("click", or "tap" on touch screens) when the scenario has payloads. Neither
  prints; both use the system text colour in high-contrast mode.
- The report index (`index.html`) is the report app for every report in the directory: a sidebar lists
  reports (failed first) with their scenario counts, a report's data loads only when it is opened, and
  `#report=<id>` links open a report, scenario or message directly. It replaces the per-report `-report.html`
  listing page, which is no longer written (`ReportFiles.listingHtml` is gone).
- In-diagram find scrolls the first match into view as you type (debounced) and on Enter / the phone keyboard's Go,
  allowing for zoom, the sticky header and the on-screen keyboard. Matches get a theme-aware highlight, the current
  match a stronger one; the visible `[match]` text is gone (screen readers hear “search match” instead).
- Find steps through its matches: Enter / F3 / Cmd or Ctrl+G for the next, with Shift for the previous, or the
  ↑ ↓ buttons beside the box, wrapping around. The count reads “2 of 11” (announced politely), and the current
  match is brought on screen at any zoom, below the sticky header. Enter no longer opens the first match's payload;
  tap or click the arrow, or move to it with the arrow keys.
- On narrow screens the side panel (inspector, Timing and metrics) sits inline below the report as part of the
  page instead of a capped inner scroll box, so a swipe on it scrolls the page rather than getting trapped.
  The JSON Expand button is hidden there, since the panel is already full width and it could not widen it.
- The Pages site opens on the example report's index; `example-report.html` opens the report alone.
- A sequence diagram taller than the screen extends the page and scrolls with it, instead of scrolling inside its panel.
  The section links above a diagram scroll the page to that section again, at any zoom.
- On desktop the component diagram and Timing and metrics panels open sized to their content: at least the message
  column's width, at most half the screen, with room for the timing lanes. Dragging still resizes them, and the
  message panel keeps the width you chose. Phones keep the full-width inline panel.
- The Metrics view's "Captured duration" sums each message's measured duration: an explicit `took` or `Timing`
  duration first, then call-to-reply time. It is fractional (to three places), and a
  scenario whose durations are all given reports the same total on every run.
- CI `gate` job, a single required check that passes for docs-only changes.
- Coverage ratchet for Kover and Vitest.

### Removed

- Version-override checks (`VersionAlignment`). Every module takes the root train version.
- Legacy message timing: `at: Instant` and whole-ms `durationMs: Long` on `message`, `call`, `response`, `async`,
  `inbound`, `outbound`, `PendingCall.reply` and `fail`, and the capture block's `at` and `took(Long)`. A message's
  timing is now only its `Timing` (`timing = Timing.at(…)`, `Timing.tookMs(…)`, `Timing.of(…)`); arrows take
  `startedAt`, `took` (any number) and `timing`. Structural rows keep `at`. The report JSON writes a message's start
  as `startedAt` only (no `createdAt`), and the report UI reads it from there.

[Unreleased]: https://github.com/lsd-consulting/lsd-mono/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lsd-consulting/lsd-mono/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lsd-consulting/lsd-mono/releases/tag/v0.1.0
