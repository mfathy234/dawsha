import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Git-backed suites spawn many `git` processes; under the full parallel run on a
// busy machine they can exceed vitest's 5s default, so allow generous headroom.
export default defineConfig({
  resolve: {
    // This addon ships its browser module but not the CommonJS entry named in package.json.
    alias: [{ find: /^@xterm\/addon-ligatures$/, replacement: resolve(__dirname, 'node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs') }]
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Process and timing tests can lose a race on a busy CI runner; one retry there, none locally.
    retry: process.env.CI ? 1 : 0,
    // Removes the dawsha* temp folders this run created.
    globalSetup: ['./tests/support/tempCleanupSetup.ts']
  }
})
