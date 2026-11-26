import type { HighlightRule } from './highlights'

/** A rule fires at most this often in one session, however often its words come back. */
export const TRIGGER_RATE_MS = 60_000
/** Output that arrives right after a terminal opens is old scrollback being replayed, not news. */
export const TRIGGER_WARMUP_MS = 4000

const keyOf = (rule: HighlightRule): string => `${rule.regex === true ? 'r' : 't'}:${rule.pattern.toLowerCase()}`

/** Decides whether a matching line should fire its rule's trigger: not during warm-up, not twice in a row for the same text, and rate limited per rule. */
export class RuleTriggerLimiter {
  private readonly last = new Map<string, { at: number; line: string }>()

  constructor(private readonly bornAt: number) {}

  take(rule: HighlightRule, line: string, now: number): boolean {
    if (!rule.trigger || now - this.bornAt < TRIGGER_WARMUP_MS) return false
    const key = keyOf(rule)
    const held = this.last.get(key)
    const text = line.trim()
    if (held && (held.line === text || now - held.at < TRIGGER_RATE_MS)) return false
    this.last.set(key, { at: now, line: text })
    return true
  }
}
