import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // JUnit XML beside the Gradle test results, so CI can upload it when a test fails.
    reporters: ['default', 'junit'],
    outputFile: { junit: '../build/test-results/vitest/junit.xml' },
  },
})
