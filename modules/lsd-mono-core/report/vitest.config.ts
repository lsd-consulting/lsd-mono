import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lint/**/*.test.js'],
    // JUnit XML beside the Gradle test results, so CI can upload it when a test fails.
    reporters: ['default', 'junit'],
    outputFile: { junit: '../build/test-results/vitest/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-util.ts', 'src/data/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: '../build/reports/coverage/report-ui',
      // A little under the coverage when these were last raised (19 October 2026): statements 83.1%,
      // branches 73.3%, functions 89.2%, lines 86.8%. The globs hold each folder to its own floor, so a
      // new untested file shows up instead of being averaged away (#76). A ratchet:
      // scripts/coverage-ratchet.mjs (run by `npm test`) fails when any metric, overall or for a glob,
      // rises more than 3 points above its threshold, and lists files under 50% of lines.
      thresholds: {
        statements: 81,
        branches: 71,
        functions: 88,
        lines: 84,
        // src/lib 91.5 / 81.3 / 95.7 / 95.3
        'src/lib/**': { statements: 90, branches: 80, functions: 94, lines: 94 },
        // src/ui 91.3 / 82.1 / 96.8 / 94.0
        'src/ui/**': { statements: 90, branches: 80, functions: 95, lines: 92 },
        // src/app 39.2 / 34.5 / 52.9 / 42.7: wiring, covered end to end by check:ux, which does not count here.
        'src/app/**': { statements: 38, branches: 33, functions: 50, lines: 41 },
      },
    },
  },
})
