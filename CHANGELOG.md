# Changelog

All notable changes to lsd-mono. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[docs/versioning-notes.md](docs/versioning-notes.md). Nothing has been released yet.

## [Unreleased]

### Added

- Core capture and report API (`lsd-mono-core`), with JUnit Jupiter, Cucumber 8 and coroutines integrations.
- Interactive report UI: sequence diagram, component diagram, inspector, timing and metrics. The Metrics view lists the
  message count and captured duration; slow calls show in the Timing view's summary strip, swim lanes and waterfall
  (there is no separate ranked Bottlenecks list, and report JSON has no `insights`).
- Timing API (slice 1): accuracy, call pairing, clock ordering with structural guards, and the Timing view
  (summary strip, swim lanes and waterfall).
- The report index (`index.html`) is the report app for every report in the directory: a sidebar lists
  reports (failed first) with their scenario counts, a report's data loads only when it is opened, and
  `#report=<id>` links open a report, scenario or message directly. It replaces the per-report `-report.html`
  listing page, which is no longer written (`ReportFiles.listingHtml` is gone).
- In-diagram find scrolls the first match into view as you type (debounced) and on Enter / the phone keyboard's Go,
  allowing for zoom, the sticky header and the on-screen keyboard. Matches get a theme-aware highlight, the current
  match a stronger one; the visible `[match]` text is gone (screen readers hear “search match” instead).
- On narrow screens the side panel (inspector, Timing and metrics) sits inline below the report as part of the
  page instead of a capped inner scroll box, so a swipe on it scrolls the page rather than getting trapped.
  The JSON Expand button is hidden there, since the panel is already full width and it could not widen it.
- The Pages site opens on the kitchen-sink report's index; `kitchen-sink.html` still opens the report alone.
- A sequence diagram taller than the screen extends the page and scrolls with it, instead of scrolling inside its panel.
  The section links above a diagram scroll the page to that section again, at any zoom.
- On desktop the component diagram and Timing and metrics panels open sized to their content: at least the message
  column's width, at most half the screen, with room for the timing lanes. Dragging still resizes them, and the
  message panel keeps the width you chose. Phones keep the full-width inline panel.
- The Metrics view's "Captured duration" sums each message's measured duration: an explicit `took` or `Timing`
  duration first, then call-to-reply time, then the legacy whole-ms value. It is fractional (to three places), and a
  scenario whose durations are all given reports the same total on every run.
- CI `gate` job, a single required check that passes for docs-only changes.
- Coverage ratchet for Kover and Vitest.

### Removed

- Version-override checks (`VersionAlignment`). Every module takes the root train version.
