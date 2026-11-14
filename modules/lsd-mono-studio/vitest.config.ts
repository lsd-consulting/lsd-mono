import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts only reads the command line and starts the server.
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      // json-summary is what scripts/coverage-ratchet.mjs reads (coverage/coverage-summary.json).
      reporter: ['text-summary', 'json-summary'],
      // A little under the coverage when these were last raised (14 November 2026): statements 98.45%,
      // branches 95.37%, functions 98.76%, lines 99.65%. A ratchet: scripts/coverage-ratchet.mjs (run by
      // `npm test`) fails when any metric rises more than 3 points above its threshold, and lists files
      // under 50% of lines.
      thresholds: { statements: 97, branches: 94, functions: 97, lines: 98 },
    },
  },
})
