import { describe, expect, it } from 'vitest'
import type { DoneRule } from '../../src/shared/sessionCare'
import { failureMessage, failureOutput, initialRule, ruleFooter, stepRule, type RuleMemory } from '../../src/shared/whenDone'

const rule = (patch: Partial<DoneRule> = {}): DoneRule => ({ commandIds: ['test'], tries: 2, onPass: 'nothing', ...patch })

describe('when done, then', () => {
  it('runs the commands when a turn finishes, and not twice at once', () => {
    const first = stepRule(rule(), initialRule(), { kind: 'turn-finished' })
    expect(first.action).toEqual({ kind: 'run' })
    expect(first.memory.phase).toBe('running')
    expect(stepRule(rule(), first.memory, { kind: 'turn-finished' }).action).toEqual({ kind: 'none' })
  })

  it('sends a failure back, counting each send, and stops at the limit', () => {
    let memory: RuleMemory = stepRule(rule(), initialRule(), { kind: 'turn-finished' }).memory
    const one = stepRule(rule(), memory, { kind: 'checks-done', passed: false, output: 'boom' })
    expect(one.action.kind).toBe('send')
    expect(one.memory).toEqual({ phase: 'sent', sent: 1 })
    memory = stepRule(rule(), one.memory, { kind: 'turn-finished' }).memory
    const two = stepRule(rule(), memory, { kind: 'checks-done', passed: false, output: 'boom' })
    expect(two.memory.sent).toBe(2)
    memory = stepRule(rule(), two.memory, { kind: 'turn-finished' }).memory
    const stop = stepRule(rule(), memory, { kind: 'checks-done', passed: false, output: 'boom' })
    expect(stop.action).toEqual({ kind: 'stop', reason: 'limit' })
    expect(stop.memory).toEqual(initialRule())
  })

  it('does one thing on a pass and resets the count', () => {
    const running = stepRule(rule({ onPass: 'commit' }), { phase: 'sent', sent: 1 }, { kind: 'turn-finished' }).memory
    expect(stepRule(rule({ onPass: 'commit' }), running, { kind: 'checks-done', passed: true, output: '' })).toEqual({ memory: initialRule(), action: { kind: 'commit' } })
    expect(stepRule(rule({ onPass: 'notify' }), running, { kind: 'checks-done', passed: true, output: '' }).action).toEqual({ kind: 'notify' })
    expect(stepRule(rule(), running, { kind: 'checks-done', passed: true, output: '' }).action).toEqual({ kind: 'none' })
  })

  it('stops on input from the owner, but only when something was going on', () => {
    expect(stepRule(rule(), initialRule(), { kind: 'user-input' }).action).toEqual({ kind: 'none' })
    expect(stepRule(rule(), { phase: 'running', sent: 0 }, { kind: 'user-input' })).toEqual({ memory: initialRule(), action: { kind: 'stop', reason: 'user' } })
    expect(stepRule(rule(), { phase: 'idle', sent: 2 }, { kind: 'user-input' }).action.kind).toBe('stop')
  })

  it('ignores a result nobody is waiting for', () => {
    expect(stepRule(rule(), initialRule(), { kind: 'checks-done', passed: false, output: 'x' }).action).toEqual({ kind: 'none' })
  })

  it('writes the failure message and the footer line', () => {
    expect(failureMessage(' output ')).toContain('Fix them:\n\noutput')
    expect(failureOutput([{ status: 'passed', display: 'a', excerpt: '', output: '' }, { status: 'failed', display: 'npm test', excerpt: '2 of 9 failed', output: 'long' }])).toBe('npm test\n2 of 9 failed')
    expect(ruleFooter(initialRule(), undefined)).toBe('')
    expect(ruleFooter({ phase: 'running', sent: 0 }, rule())).toBe('Running checks…')
    expect(ruleFooter({ phase: 'sent', sent: 1 }, rule())).toBe('Sent the failure back, 1 of 2')
    expect(ruleFooter(initialRule(), rule())).toBe('When done: checks on')
  })
})
