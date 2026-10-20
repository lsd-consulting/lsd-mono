import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lint/**/*.test.js'],
    // Each file keeps its own worker (vitest's default isolate: true), on purpose (#97). isolate: false
    // ran about 3 s faster on four cores (6.6 s to 3.5 s with coverage), but in a shuffled order it let
    // DOM state leak between files (inspector-fit.test.ts failed), and coverage then depends on which
    // files share a worker, which would make the ratchet below flaky. pool: 'threads' gained nothing
    // and failed outright without isolation. The unit tests are not the slow part of CI.
    // JUnit XML beside the Gradle test results, so CI can upload it when a test fails.
    reporters: ['default', 'junit'],
    outputFile: { junit: '../build/test-results/vitest/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-util.ts', 'src/data/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: '../build/reports/coverage/report-ui',
      // A little under the coverage when these were last raised (20 October 2026, #99): statements
      // 86.1%, branches 77.4%, functions 90.2%, lines 89.6%. The globs hold each folder to its own floor, so a
      // new untested file shows up instead of being averaged away (#76). A ratchet:
      // scripts/coverage-ratchet.mjs (run by `npm test`) fails when any metric, overall or for a glob,
      // rises more than 3 points above its threshold, and lists files under 50% of lines.
      thresholds: {
        statements: 87,
        branches: 78,
        functions: 91,
        lines: 90,
        // src/lib 93.5 / 84.3 / 97.0 / 97.0 (the repaint path tests, #104)
        'src/lib/**': { statements: 92, branches: 82, functions: 95, lines: 95 },
        // src/ui 92.7 / 85.6 / 97.6 / 94.6 (the link panel tests, #105)
        'src/ui/**': { statements: 91, branches: 84, functions: 96, lines: 93 },
        // src/app 65.5 / 60.8 / 69.9 / 68.2: the decisions are pure functions with unit tests (intents.ts,
        // #99, the key handlers, #102, and the view switch, its hash and reveal, #105); the rest is
        // covered end to end by check:ux, which does not count here.
        'src/app/**': { statements: 64, branches: 59, functions: 68, lines: 67 },
      },
    },
  },
})
