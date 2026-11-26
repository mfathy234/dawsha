import type { CheckResult } from './turnChecks'
import type { DoneRule } from './sessionCare'

/** What the runner remembers about one session's rule between events. */
export interface RuleMemory {
  phase: 'idle' | 'running' | 'sent'
  /** Failures sent back to the agent in this chain. */
  sent: number
}

export const initialRule = (): RuleMemory => ({ phase: 'idle', sent: 0 })

export type RuleEvent =
  | { kind: 'turn-finished' }
  | { kind: 'checks-done'; passed: boolean; output: string }
  | { kind: 'user-input' }

export type RuleAction =
  | { kind: 'none' }
  | { kind: 'run' }
  | { kind: 'send'; text: string }
  | { kind: 'commit' }
  | { kind: 'notify' }
  | { kind: 'stop'; reason: 'user' | 'limit' }

export interface RuleStep {
  memory: RuleMemory
  action: RuleAction
}

export const COMMIT_MESSAGE = 'The checks passed. Commit your work with a conventional commit message.'
export const FAILURE_PREFIX = 'These checks failed after your last reply'
const MESSAGE_MAX = 6000

/** The message that carries a failing run back to the agent. */
export function failureMessage(output: string): string {
  return `${FAILURE_PREFIX}. Fix them:\n\n${output.trim()}`.slice(0, MESSAGE_MAX)
}

/** The tail of what the failing checks printed, as a single block. */
export function failureOutput(results: readonly Pick<CheckResult, 'status' | 'display' | 'excerpt' | 'output'>[]): string {
  return results
    .filter((result) => result.status === 'failed')
    .map((result) => `${result.display}\n${(result.excerpt || result.output).trim().slice(-1500)}`)
    .join('\n\n')
}

/** One step of "when done, then": a finished turn runs the commands; a failure goes back up to `tries` times; any input from the owner ends the chain. */
export function stepRule(rule: DoneRule, memory: RuleMemory, event: RuleEvent): RuleStep {
  if (event.kind === 'user-input') {
    const active = memory.phase !== 'idle' || memory.sent > 0
    return { memory: initialRule(), action: active ? { kind: 'stop', reason: 'user' } : { kind: 'none' } }
  }
  if (event.kind === 'turn-finished') {
    if (memory.phase === 'running') return { memory, action: { kind: 'none' } }
    return { memory: { ...memory, phase: 'running' }, action: { kind: 'run' } }
  }
  if (memory.phase !== 'running') return { memory, action: { kind: 'none' } }
  if (event.passed) {
    const action: RuleAction = rule.onPass === 'commit' ? { kind: 'commit' } : rule.onPass === 'notify' ? { kind: 'notify' } : { kind: 'none' }
    return { memory: initialRule(), action }
  }
  if (memory.sent >= rule.tries) return { memory: initialRule(), action: { kind: 'stop', reason: 'limit' } }
  return { memory: { phase: 'sent', sent: memory.sent + 1 }, action: { kind: 'send', text: failureMessage(event.output) } }
}

/** The quiet line in the pane footer; empty when there is no rule. */
export function ruleFooter(memory: RuleMemory, rule: DoneRule | undefined): string {
  if (!rule) return ''
  if (memory.phase === 'running') return 'Running checks…'
  if (memory.phase === 'sent') return `Sent the failure back, ${memory.sent} of ${rule.tries}`
  return 'When done: checks on'
}
