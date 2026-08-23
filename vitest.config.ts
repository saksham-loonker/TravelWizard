import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 15000,
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/domain/src/index.ts', 'packages/maps/src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 60,
        statements: 80
      }
    }
  },
  resolve: {
    alias: {
      '@travelwizard/domain': '/packages/domain/src/index.ts',
      '@travelwizard/maps': '/packages/maps/src/index.ts',
      '@travelwizard/browser-policy': '/packages/browser-policy/src/index.ts',
      '@travelwizard/providers': '/packages/providers/src/index.ts',
      '@travelwizard/ocr': '/packages/ocr/src/index.ts',
      '@travelwizard/db': '/packages/db/src/index.ts'
    }
  }
})
