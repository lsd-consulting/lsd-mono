# Changelog

All notable changes to lsd-mono. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[docs/versioning-notes.md](docs/versioning-notes.md). Nothing has been released yet.

## [Unreleased]

### Added

- Core capture and report API (`lsd-mono-core`), with JUnit Jupiter, Cucumber 8 and coroutines integrations.
- Interactive report UI: sequence diagram, component diagram, inspector, metrics and insights.
- Timing API (slice 1): accuracy, call pairing, clock ordering with structural guards, and the Timing view
  (summary strip, swim lanes and waterfall).
- The report index (`index.html`) is the report app for every report in the directory: a sidebar lists
  reports (failed first) with their scenario counts, a report's data loads only when it is opened, and
  `#report=<id>` links open a report, scenario or message directly. It replaces the per-report `-report.html`
  listing page, which is no longer written (`ReportFiles.listingHtml` is gone).
- The Pages site opens on the kitchen-sink report's index; `kitchen-sink.html` still opens the report alone.
- A sequence diagram taller than the screen extends the page and scrolls with it, instead of scrolling inside its panel.
- CI `gate` job, a single required check that passes for docs-only changes.
- Coverage ratchet for Kover and Vitest.

### Removed

- Version-override checks (`VersionAlignment`). Every module takes the root train version.
