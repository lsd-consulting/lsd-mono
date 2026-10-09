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
      exclude: ['src/**/*.test.ts', 'src/data/**'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: '../build/reports/coverage/report-ui',
      // A little under the coverage when these were set (#30): statements 77.1%, branches
      // 65.6%, functions 84.7%, lines 80.7%. Raise them as tests are added.
      thresholds: { statements: 76, branches: 64, functions: 83, lines: 79 },
    },
  },
})
