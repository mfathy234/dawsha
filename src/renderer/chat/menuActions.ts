import { submitRowNumber } from '../../shared/menuPrompt'
import { submitSteps, type KeyStep } from '../../shared/menuAnswer'
import { api } from '../api'
import { getTerminal } from '../terminals'

const REVIEW_ROWS = 28
const REVIEW_WAIT_MS = 450
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

async function run(tabId: string, steps: readonly KeyStep[]): Promise<void> {
  for (const step of steps) {
    api.write(tabId, step.data)
    await sleep(step.wait)
  }
}

/**
 * Presses an answer into the agent's picker. A picker with several questions ends on a review screen;
 * when the screen shows a "Submit" row after the last answer, it is pressed too.
 */
export async function answerMenu(tabId: string, steps: readonly KeyStep[]): Promise<void> {
  await run(tabId, steps)
  await sleep(REVIEW_WAIT_MS)
  const row = submitRowNumber(getTerminal(tabId)?.tailText(REVIEW_ROWS) ?? '')
  if (row !== null) await run(tabId, submitSteps(row))
}
