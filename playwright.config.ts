import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  // Removes the dawsha-e2e-* sandboxes this run created (they once filled 20 GB of temp).
  globalSetup: './tests/support/e2eTempCleanup.ts',
  use: { trace: 'retain-on-failure' }
})
