import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Needed to mount .vue components. Without it a component spec fails with
  // "content contains invalid JS syntax", which reads like a broken test
  // rather than a missing plugin.
  //
  // vue-router/vite is deliberately NOT included: it exists to generate routes
  // from src/pages, and a component spec mounts a component directly.
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['server/**/*.spec.ts', 'src/**/*.spec.ts'],
    // Server and pure-logic specs run in node; component specs opt into a DOM
    // with a `// @vitest-environment happy-dom` docblock, so the fast default
    // is not paid for by the whole suite.
    environment: 'node',
  },
})
