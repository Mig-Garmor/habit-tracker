import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.spec.ts', 'src/**/*.spec.ts', 'api/**/*.spec.ts'],
    environment: 'node',
  },
})
