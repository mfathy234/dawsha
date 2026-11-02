import type { TabAgent } from './types'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
/** The agent's input line: a prompt mark at the start of a row, not one that begins a numbered menu row. */
const PROMPT_LINE = /^[\s│┃|]*[>❯›](?!\s*\d+[.)]\s)/m
const FOOTER = /\?\s+for shortcuts|shift\+tab|context left|esc to interrupt|ctrl\+c to (?:exit|quit)/i
export const STARTUP_MAX_MS = 25_000

/** True when the terminal shows the agent's input box, so what is typed now reaches the agent and not its start-up. */
export function agentReady(tail: string): boolean {
  const text = tail.replace(ANSI, '')
  return PROMPT_LINE.test(text) || FOOTER.test(text)
}

export interface StartupInput {
  agent: TabAgent
  status: 'starting' | 'running' | 'exited'
  startedAt: number
  now: number
  tail: string
  working: boolean
}

/** Still starting: the process is not up, or its screen does not show the input box yet. It gives up waiting after a while. */
export function isStarting(input: StartupInput): boolean {
  if (input.status === 'exited' || input.working) return false
  if (input.status === 'starting') return true
  if (input.now - input.startedAt > STARTUP_MAX_MS) return false
  return !agentReady(input.tail)
}
