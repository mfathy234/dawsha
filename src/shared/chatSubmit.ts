import type { TabAgent } from './types'

/**
 * How long chat waits between typing a message into an agent's terminal and pressing Enter.
 *
 * Codex treats keys that arrive close together as a paste, and an Enter that comes within its paste window
 * becomes a newline in the composer instead of sending. On Windows the PTY delivers chat text as plain keys,
 * so Codex needs a pause well past that window before Enter counts as "send".
 */
const SUBMIT_DELAY_MS: Readonly<Record<TabAgent, number>> = {
  claude: 40,
  codex: 350,
  gemini: 150,
  shell: 40
}

export function submitDelayFor(agent: TabAgent): number {
  return SUBMIT_DELAY_MS[agent] ?? SUBMIT_DELAY_MS.shell
}
