import { describe, expect, it } from 'vitest'
import { compileRules, sameRules, sanitizeHighlights, sanitizeRule } from '../../src/shared/highlights'
import { RuleTriggerLimiter, TRIGGER_RATE_MS, TRIGGER_WARMUP_MS } from '../../src/shared/ruleTriggers'

const rule = { pattern: 'ready in', color: 'green' as const, trigger: 'notify' as const }

describe('highlight rule triggers', () => {
  it('keeps a valid trigger and drops an unknown one', () => {
    expect(sanitizeRule({ pattern: 'ready in', color: 'green', trigger: 'needs' })).toEqual({ pattern: 'ready in', color: 'green', trigger: 'needs' })
    expect(sanitizeRule({ pattern: 'ready in', color: 'green', trigger: 'explode' })).toEqual({ pattern: 'ready in', color: 'green' })
    expect(sanitizeHighlights({ enabled: true, rules: [rule] }).rules[0].trigger).toBe('notify')
  })

  it('treats a changed trigger as a different rule set', () => {
    expect(sameRules([rule], [{ ...rule, trigger: 'needs' }])).toBe(false)
    expect(sameRules([rule], [{ ...rule }])).toBe(true)
  })

  it('returns the rule that matched', () => {
    const compiled = compileRules([{ pattern: 'error', color: 'red' }, rule])
    expect(compiled.match('VITE ready in 300 ms')).toEqual(rule)
    expect(compiled.match('nothing')).toBeNull()
    expect(compiled.test('an error')).toBe('red')
  })
})

describe('RuleTriggerLimiter', () => {
  const born = 1_000_000

  it('stays quiet while the terminal warms up and for rules without a trigger', () => {
    const limiter = new RuleTriggerLimiter(born)
    expect(limiter.take(rule, 'ready in 3ms', born + 100)).toBe(false)
    expect(limiter.take({ pattern: 'x', color: 'red' }, 'x', born + TRIGGER_WARMUP_MS + 1)).toBe(false)
  })

  it('fires once per rule per minute and not again for the same text', () => {
    const limiter = new RuleTriggerLimiter(born)
    const at = born + TRIGGER_WARMUP_MS + 10
    expect(limiter.take(rule, 'ready in 3ms', at)).toBe(true)
    expect(limiter.take(rule, 'ready in 4ms', at + 1000)).toBe(false)
    expect(limiter.take(rule, 'ready in 3ms', at + TRIGGER_RATE_MS + 1)).toBe(false)
    expect(limiter.take(rule, 'ready in 5ms', at + TRIGGER_RATE_MS + 1)).toBe(true)
  })
})
