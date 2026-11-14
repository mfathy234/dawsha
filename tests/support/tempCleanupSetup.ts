import { removePrivateTemp, startPrivateTemp } from './tempCleanup'

/** Global setup for vitest: a private temp folder for this run, removed at the end. Workers inherit it through TEMP/TMP. */
export default function setup(): () => void {
  const dir = startPrivateTemp('unit')
  return () => removePrivateTemp(dir)
}

/** The same for Playwright: the runner, its workers and the Dawsha apps they launch all use this run's folder. */
export function e2eSetup(): () => void {
  const dir = startPrivateTemp('e2e')
  return () => removePrivateTemp(dir)
}
