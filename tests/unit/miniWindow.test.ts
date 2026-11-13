import { describe, expect, it } from 'vitest'
import { miniBounds, miniContentBounds, miniSession, orderMiniSessions, createMiniSnapshotGate, isMiniAction, type MiniSessionInput } from '../../src/shared/miniWindow'

const input = (paneId: string, patch: Partial<MiniSessionInput> = {}): MiniSessionInput => ({
  paneId, agent: 'claude', title: 'Test', project: 'Smoke', status: 'idle', attention: 'none',
  tail: '', recap: '', tool: '', idleFor: '', changed: null, todos: [], ...patch
})

describe('Mini snapshots', () => {
  it('uses shared session states and permission shaping, with compact terminal text', () => {
    const session = miniSession(input('a', { attention: 'needs', tail: '● Bash(npm test)\nDo you want to proceed?\n1. Yes\n3. No, and tell Claude what to do differently\n' }))
    expect(session.state).toBe('needs')
    expect(session.line).toContain('npm test')
    expect(session.permission?.command).toBe('npm test')
    expect(session.tail).toHaveLength(3)
    expect(miniSession(input('watching', { tail: 'Do you want to proceed?\n1. Yes\n3. No' })).state).toBe('needs')
    expect(miniSession(input('old', { attention: 'needs', tail: '' })).permission).toBeNull()
  })
  it('retains plan items, progress and current step, including completed plans', () => {
    const todos = [{ text: 'Read', status: 'completed' }, { text: 'Test', status: 'in_progress' }] as const
    expect(miniSession(input('a', { todos })).plan).toEqual({ done: 1, total: 2, current: 'Test', items: todos })
    expect(miniSession(input('a', { todos: [{ text: 'Read', status: 'completed' }] })).plan?.done).toBe(1)
    expect(miniSession(input('a')).plan).toBeNull()
  })
  it('formats done and idle status, dropping control characters and limiting payloads', () => {
    expect(miniSession(input('a', { attention: 'done', changed: 2 })).line).toBe('Done, 2 files changed')
    expect(miniSession(input('a', { idleFor: '50m' })).line).toBe('Idle 50m')
    expect(miniSession(input('a', { status: 'busy', tool: 'Running tests' })).line).toBe('Running tests')
    expect(miniSession(input('a', { status: 'exited', recap: 'old' })).line).toBe('Exited')
    expect(miniSession(input('a', { title: 'a\u0000b' })).title).toBe('ab')
    expect(miniSession(input('a', { tail: 'x'.repeat(5000) })).tail[0].length).toBeLessThan(1000)
  })
  it('sorts needs then working then the rest, preserving original pane order within groups', () => {
    const sessions = [miniSession(input('idle')), miniSession(input('done', { attention: 'done' })), miniSession(input('work', { status: 'busy' })), miniSession(input('need', { attention: 'needs' })), miniSession(input('work2', { status: 'busy' }))]
    expect(orderMiniSessions(sessions).map(s => s.paneId)).toEqual(['need', 'work', 'work2', 'idle', 'done'])
    expect(sessions[0].paneId).toBe('idle')
  })
  it('sends only changed snapshots, at most once per 250 ms, without dropping the trailing change', () => {
    const gate = createMiniSnapshotGate()
    expect(gate.take({ n: 1 }, 0)).toBe(true)
    expect(gate.take({ n: 2 }, 100)).toBe(false)
    expect(gate.take({ n: 3 }, 250)).toBe(true)
    expect(gate.take({ n: 3 }, 500)).toBe(false)
    expect(gate.take({ n: 4 }, 501)).toBe(true)
  })
  it('accepts only explicit Mini actions, with approval bound to its displayed prompt', () => {
    expect(isMiniAction({ kind: 'open', paneId: 'a' })).toBe(true)
    expect(isMiniAction({ kind: 'answer', paneId: 'a', allow: false, prompt: 'npm test' })).toBe(true)
    expect(isMiniAction({ kind: 'answer', paneId: 'a', allow: 'yes' })).toBe(false)
    expect(isMiniAction({ kind: 'write', text: 'rm' })).toBe(false)
    expect(isMiniAction(null)).toBe(false)
  })
})

describe('Mini bounds', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('starts above the taskbar, 16 pixels from the main display corner', () => {
    expect(miniBounds(null, [area], area)).toEqual({ x: 1544, y: 544, width: 360, height: 480 })
  })
  it('falls back when off all displays, but preserves reachable saved bounds', () => {
    expect(miniBounds({ x: 4000, y: 20, width: 360, height: 600 }, [area], area).x).toBe(1544)
    expect(miniBounds({ x: 40, y: 20, width: 320, height: 600 }, [area], area)).toEqual({ x: 40, y: 20, width: 320, height: 600 })
  })
  it('clamps size and position so the header stays reachable on smaller and negative-coordinate displays', () => {
    const small = { x: -1024, y: 0, width: 1024, height: 728 }
    const bounds = miniBounds({ x: -30, y: 720, width: 100, height: 900 }, [small], small)
    expect(bounds.width).toBe(300)
    expect(bounds.height).toBe(640)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(728)
  })
  it('keeps the bottom corner anchored as content is measured, grows and folds', () => {
    const initial = miniBounds(null, [area], area)
    const fitted = miniContentBounds(initial, 200, area)
    expect(fitted.y + fitted.height).toBe(1024)
    expect(miniContentBounds(fitted, 58, area).y).toBe(966)
    expect(miniContentBounds(fitted, 900, area).height).toBe(640)
    expect(miniContentBounds({ ...initial, x: -32000, y: -32000 }, 200, area, true).y).toBe(-32000)
  })
})
