import { defineConfig } from 'vite'

// Relative base so dist/ opens via file:// after build.
export default defineConfig({
  base: './',
  // The page's own version (src/lib/viewer-version.ts): the Gradle build passes the project version.
  define: { __LSD_VIEWER_VERSION__: JSON.stringify(process.env.LSD_VIEWER_VERSION || 'dev') },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000,
    cssCodeSplit: false,
  },
  // The demo report (src/data/sample-report.ts) is a shared test report beside the schema, outside
  // this package, so the dev server may serve that directory too.
  server: { port: 5173, open: false, fs: { allow: ['.', '../../lsd-mono-report-schema/conformance/reports'] } },
  preview: { port: 4173 },
})
