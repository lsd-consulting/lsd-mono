import { defineConfig } from '@playwright/test'

/** Headless Chromium, same Playwright major as docs/perf/measure.mjs (1.55). */
export default defineConfig({
  testDir: './checks',
  fullyParallel: false,
  workers: 1,
  retries: 0,
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
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
