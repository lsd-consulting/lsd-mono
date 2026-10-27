import { defineConfig } from '@playwright/test'

/** Headless Chromium, same Playwright major as docs/perf/measure.mjs (1.55). */
export default defineConfig({
  testDir: './checks',
  // Every test opens its own page (report, routes, storage) against the read-only dev server, so
  // tests run in parallel, within a file too (#97). Half the cores locally; CI runners have four.
  fullyParallel: true,
  workers: process.env.CI ? 3 : '50%',
  retries: 0,
  // The @screenshot tests compare against macOS baselines; Linux renders fonts differently, so CI
  // leaves them out. Everything else runs in both places. See docs/ci.md.
  grepInvert: process.env.CI ? /@screenshot/ : undefined,
  // CI keeps a trace and the HTML report of a failure for the uploaded artifact; locally the
  // list output is enough.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 40,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 860, height: 700 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    // The page's own version (src/lib/viewer-version.ts) as a release, so the usage ping checks can ping.
    env: { LSD_VIEWER_VERSION: '0.2.0' },
    timeout: 60_000,
  },
})
