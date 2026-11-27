import { describe, expect, it } from 'vitest'
import { dueSends, planFor, planNote, sendCount, sendLabel, splitTargets, ticked, type BroadcastSession } from '../../src/shared/broadcast'

const session = (paneId: string, state: BroadcastSession['state'], projectId = 'p1', agent = 'claude'): BroadcastSession => ({ paneId, name: paneId, project: projectId, projectId, state, agent })
const all = [session('idle', 'idle'), session('done', 'done', 'p2'), session('working', 'working'), session('needs', 'needs'), session('gone', 'exited'), session('shell', 'idle', 'p1', 'shell')]

describe('send to several', () => {
  it('plans now, later or never by state', () => {
    expect(all.map((item) => planFor(item))).toEqual(['now', 'now', 'later', 'skip', 'skip', 'skip'])
    expect(planNote(all[2])).toBe('Working · after it finishes')
    expect(planNote(all[3])).toBe('Needs you · skipped')
  })

  it('ticks idle sessions, a project or everything sendable', () => {
    expect([...ticked(all, { kind: 'idle' })]).toEqual(['idle', 'done'])
    expect([...ticked(all, { kind: 'project', projectId: 'p1' })]).toEqual(['idle', 'working'])
    expect([...ticked(all, { kind: 'all' })]).toEqual(['idle', 'done', 'working'])
  })

  it('counts only what would be sent', () => {
    expect(sendCount(all, new Set(['idle', 'working', 'needs']))).toBe(2)
    expect(sendLabel(1)).toBe('Send to 1 session')
    expect(sendLabel(4)).toBe('Send to 4 sessions')
    expect(splitTargets(all, new Set(['idle', 'working', 'needs']))).toEqual({ now: ['idle'], later: ['working'] })
  })

  it('delivers a waiting message when its session is back at the prompt, and drops one for a closed session', () => {
    const pending = [{ paneId: 'a', text: 'x' }, { paneId: 'b', text: 'x' }, { paneId: 'c', text: 'x' }, { paneId: 'd', text: 'x' }]
    const result = dueSends(pending, new Map([['a', 'working'], ['b', 'idle'], ['c', 'needs'], ['e', 'idle']] as const))
    expect(result.due.map((item) => item.paneId)).toEqual(['b'])
    expect(result.keep.map((item) => item.paneId)).toEqual(['a', 'c'])
    expect(result.dropped.map((item) => item.paneId)).toEqual(['d'])
  })
})
