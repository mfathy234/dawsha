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

const PROMPT_MARK = /[›❯>]/
const QUEUE_HINT = /tab\s*to\s*queue/i
const MATCH_CHARS = 24
const squash = (text: string): string => text.replace(/\s+/g, '')

/**
 * True when the agent's input box (the last prompt line and what wraps below it) still holds the message,
 * so the key that should have sent it did not. Spacing is ignored because the screen may draw spaces as cursor moves.
 */
export function composerHolds(tail: string, message: string): boolean {
  const lines = tail.split('\n')
  const at = lines.findLastIndex((line) => PROMPT_MARK.test(line))
  if (at < 0) return false
  const box = squash(lines.slice(at).join('\n').replace(PROMPT_MARK, ''))
  const start = squash(message).slice(0, MATCH_CHARS)
  return start !== '' && box.includes(start)
}

const STARTUP_HOLD = /waiting\s*for\s*startup/i

/**
 * The key that sends what is in the box: none while Codex already took it and is holding it until it has started,
 * Tab when Codex is busy and offers to queue it, Enter otherwise.
 */
export function submitKey(tail: string): '\t' | '\r' | null {
  if (STARTUP_HOLD.test(tail)) return null
  return QUEUE_HINT.test(tail) ? '\t' : '\r'
}
