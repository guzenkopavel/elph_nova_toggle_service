import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:3099',
  },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // Disable retries for deterministic test results
  retries: 0,
  // Run tests sequentially to avoid DB race conditions
  workers: 1,
})
