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
      // A little under the coverage when these were last raised: statements 81.9%, branches
      // 71.0%, functions 89.1%, lines 85.6%. A ratchet: scripts/coverage-ratchet.mjs (run by
      // `npm test`) fails when any metric rises more than 3 points above its threshold.
      thresholds: { statements: 80, branches: 69, functions: 88, lines: 84 },
    },
  },
})
