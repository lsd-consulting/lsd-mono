# Report UI checks

Playwright checks for the report UI, run by `npm run check:ux` (see `docs/ci.md` for CI). They run
in parallel, so each test sets up its own page and depends on no other test.

- **Open a page with `openReport`** (`open-report.ts`): a single report or an index page, with the
  theme, storage, payload script, media and viewport as options. The common fixtures wrap it:
  `openFixture` (the small UX report, `ux-helpers.ts`), `openWide`, `openExample` (scenarios from
  the live example report, `example-report.ts`), `openFindReport` and `openFindIndex`
  (`find-fixture.ts`), and `PAGES` (`diagram-pages.ts`) for a check that runs on both page kinds.
- **One axe pass per theme for each panel state** a change adds, not one per test.
- **Poll, don't sleep.** Wait with `expect.poll`, a retrying assertion, or the helpers in
  `ux-helpers.ts`, not `waitForTimeout` or `setTimeout` (lint rejects any use of either, however
  it is spelt): `frames(page, n)` for a scroll, focus or
  resize to land; `expectStable(page, read)` for "it has settled" and "nothing changed" (it reads
  until the value holds for a few frames); `requestsFlushed(page, seen, url)` for "no request was
  made" (a sentinel through the same route, after the page's own requests). A sleep that is itself
  under test, such as a long-press hold, takes an `eslint-disable-next-line ... -- <reason>`: lint
  rejects a disable comment without a reason, and one that no longer silences anything.
- **Use vitest when there is no layout.** Logic that does not need a real layout engine (state,
  text, key-to-action decisions) belongs in a unit test under `src/`, which runs in seconds.
