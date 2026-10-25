import { defineConfig } from 'vitest/config'

// Git-backed suites spawn many `git` processes; under the full parallel run on a
// busy machine they can exceed vitest's 5s default, so allow generous headroom.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
