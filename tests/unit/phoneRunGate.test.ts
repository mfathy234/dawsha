import { describe, expect, it } from 'vitest'
import { createPhoneRunGate, DUPLICATE_RUN_MS, PHONE_RUNS_AT_ONCE, PHONE_START_GRACE_MS, type PhoneRunInput } from '../../src/shared/remoteCrew'

const NOW = 1_000_000
const RUN_WAIT_MS = 15_000

const at = (now: number, member = 'rami', fields: Record<string, string> = { pr: '412' }): PhoneRunInput => ({
  memberId: member,
  projectId: 'p1',
  fields,
  deadline: now + RUN_WAIT_MS
})

describe('phone run gate', () => {
  it('starts a run that is in time', () => {
    expect(createPhoneRunGate().check(at(NOW), NOW, new Map())).toEqual({ kind: 'start' })
  })

  it('refuses a request that arrives after its deadline and starts nothing', () => {
    const gate = createPhoneRunGate()
    const late = { ...at(NOW), deadline: NOW - 1 }
    expect(gate.check(late, NOW, new Map())).toEqual({ kind: 'refuse', error: expect.stringMatching(/too late/) })
  })

  it('answers a repeat of the same member, project and fields within 30 seconds with the run it already started', () => {
    const gate = createPhoneRunGate()
    gate.begin(at(NOW), NOW).finish('run1')
    const states = new Map([['run1', 'working']])
    expect(gate.check(at(NOW + 29_000), NOW + 29_000, states)).toEqual({ kind: 'duplicate', runId: 'run1' })
    expect(gate.check(at(NOW + DUPLICATE_RUN_MS + 1), NOW + DUPLICATE_RUN_MS + 1, states)).toEqual({ kind: 'start' })
  })

  it('treats different fields or a different member as a different run', () => {
    const gate = createPhoneRunGate()
    gate.begin(at(NOW), NOW).finish('run1')
    const states = new Map([['run1', 'working']])
    expect(gate.check(at(NOW + 1_000, 'rami', { pr: '413' }), NOW + 1_000, states)).toEqual({ kind: 'start' })
    expect(gate.check(at(NOW + 1_000, 'omar'), NOW + 1_000, states)).toEqual({ kind: 'start' })
  })

  it('lets at most three phone runs work at once, and a fourth is refused with the reason', () => {
    const gate = createPhoneRunGate()
    const states = new Map<string, string>()
    for (const [index, member] of ['a', 'b', 'c'].entries()) {
      expect(gate.check(at(NOW, member), NOW, states)).toEqual({ kind: 'start' })
      gate.begin(at(NOW, member), NOW).finish(`run${index}`)
      states.set(`run${index}`, 'working')
    }
    expect(PHONE_RUNS_AT_ONCE).toBe(3)
    expect(gate.check(at(NOW, 'd'), NOW, states)).toEqual({ kind: 'refuse', error: expect.stringMatching(/already runs 3 agents from the phone/) })
    states.set('run0', 'done')
    expect(gate.check(at(NOW, 'd'), NOW, states)).toEqual({ kind: 'start' })
  })

  it('counts a run that is still starting, so a quick burst cannot pass the limit', () => {
    const gate = createPhoneRunGate()
    const tickets = ['a', 'b', 'c'].map((member) => gate.begin(at(NOW, member), NOW))
    expect(gate.check(at(NOW, 'd'), NOW, new Map())).toMatchObject({ kind: 'refuse' })
    tickets[0].finish(null)
    expect(gate.check(at(NOW, 'd'), NOW, new Map())).toEqual({ kind: 'start' })
  })

  it('refuses a repeat that arrives while its first run is still starting', () => {
    const gate = createPhoneRunGate()
    gate.begin(at(NOW), NOW)
    expect(gate.check(at(NOW), NOW, new Map())).toEqual({ kind: 'refuse', error: expect.stringMatching(/already starting/) })
  })

  it('stops counting a run that has not shown up in the crew state after the start grace', () => {
    const gate = createPhoneRunGate()
    for (const [index, member] of ['a', 'b', 'c'].entries()) gate.begin(at(NOW, member), NOW).finish(`run${index}`)
    expect(gate.check(at(NOW + 1_000, 'd'), NOW + 1_000, new Map())).toMatchObject({ kind: 'refuse' })
    const later = NOW + PHONE_START_GRACE_MS + 1
    expect(gate.check(at(later, 'd'), later, new Map())).toEqual({ kind: 'start' })
  })
})
