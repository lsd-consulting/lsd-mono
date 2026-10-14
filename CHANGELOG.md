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
- CI `gate` job, a single required check that passes for docs-only changes.
- Coverage ratchet for Kover and Vitest.

### Removed

- Version-override checks (`VersionAlignment`). Every module takes the root train version.
