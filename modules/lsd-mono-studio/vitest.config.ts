import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts only reads the command line and starts the server.
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      reporter: ['text-summary'],
      // A scaffold (#186): held a little under the current coverage, raised as the features land.
      thresholds: { statements: 95, branches: 94, functions: 91, lines: 95 },
    },
  },
})
