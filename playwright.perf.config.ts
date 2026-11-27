import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/perf',
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: 'list'
})
