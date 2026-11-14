import { removeTempCreatedSince } from './tempCleanup'

const isE2e = (name: string): boolean => name.startsWith('dawsha-e2e-')

/** Global setup for vitest: on teardown remove the temp folders this run created, never an e2e run's sandboxes. */
export default function setup(): () => void {
  const startedAt = Date.now()
  return () => {
    removeTempCreatedSince(startedAt, (name) => !isE2e(name))
  }
}

/** The same for Playwright: only its own `dawsha-e2e-*` sandboxes, so a unit run going on at the same time keeps its folders. */
export function e2eSetup(): () => void {
  const startedAt = Date.now()
  return () => {
    removeTempCreatedSince(startedAt, isE2e)
  }
}
