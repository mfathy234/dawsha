import { describe, expect, it, vi } from 'vitest'
import { RemoteTerminalState } from '../../src/main/remoteTerminalState'

describe('remote terminal state', () => {
  it('reports the PTY size and drops terminals when they are removed', () => {
    const state = new RemoteTerminalState()
    state.add('a', 10, { projectId: 'p1', agent: 'codex' }, { cols: 120, rows: 40 })
    expect(state.snapshot()).toEqual([{ id: 'a', startedAt: 10, cols: 120, rows: 40, projectId: 'p1', agent: 'codex' }])
    state.remove('a')
    expect(state.snapshot()).toEqual([])
  })

  it('serializes the rendered screen rather than replaying the raw byte log', async () => {
    const state = new RemoteTerminalState()
    state.add('tui', 10, { projectId: 'p1', agent: 'claude' }, { cols: 20, rows: 4 })
    // A TUI that draws a line, then moves the cursor home and overwrites it in place.
    state.append('tui', 'first draft\u001b[H\u001b[2Kfinal line')
    const screen = await state.screen('tui')
    expect(screen).toMatchObject({ cols: 20, rows: 4 })
    expect(screen?.output).toContain('final line')
    expect(screen?.output).not.toContain('first draft')
  })

  it('reads the last screen lines for prompt detection once pending output is applied', async () => {
    const state = new RemoteTerminalState()
    state.add('tui', 10, { projectId: 'p1', agent: 'claude' }, { cols: 30, rows: 4 })
    state.append('tui', 'old 1\r\nold 2\r\nold 3\r\nold 4\r\nDo you want to proceed?\r\n1. Yes\r\n2. No')
    const tail = await state.tail('tui')
    expect(tail).toContain('Do you want to proceed?')
    expect(tail).toContain('1. Yes')
    expect(tail?.split('\n').at(-1)).toBe('2. No')
    expect(await state.tail('missing')).toBeNull()
  })

  it('applies resizes in stream order and notifies subscribers', async () => {
    const state = new RemoteTerminalState()
    const listener = vi.fn()
    state.add('a', 10, { projectId: 'p1', agent: 'codex' }, { cols: 80, rows: 24 })
    state.subscribe('a', listener)
    state.append('a', 'x')
    state.resize('a', 48, 29)
    state.resize('a', 48, 29)
    expect(listener.mock.calls.map(([frame]) => frame)).toEqual([{ type: 'output', data: 'x' }, { type: 'resize', cols: 48, rows: 29 }])
    expect(await state.screen('a')).toMatchObject({ cols: 48, rows: 29 })
    expect(state.snapshot('a')[0]).toMatchObject({ cols: 48, rows: 29 })
  })

  it('excludes output appended after a screen request so subscribers can forward it without duplicates', async () => {
    const state = new RemoteTerminalState()
    state.add('a', 10, { projectId: 'p1', agent: 'codex' }, { cols: 40, rows: 5 })
    state.append('a', 'before ')
    const pending = state.screen('a')
    state.append('a', 'after')
    const screen = await pending
    expect(screen?.output).toContain('before')
    expect(screen?.output).not.toContain('after')
  })

  it('notifies active subscribers and stops after unsubscribe or terminal removal', () => {
    const state = new RemoteTerminalState()
    const listener = vi.fn()
    expect(state.subscribe('missing', listener)).toBeNull()
    state.add('active', 10)
    const unsubscribe = state.subscribe('active', listener)!
    state.append('active', 'data')
    unsubscribe()
    state.append('active', 'ignored')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'output', data: 'data' })
  })

  it('marks remotely started sessions so the browser can offer stop controls only for those PTYs', () => {
    const state = new RemoteTerminalState()
    state.add('remote', 10, { projectId: 'p1', agent: 'codex', remoteManaged: true })
    expect(state.snapshot()[0]).toMatchObject({ id: 'remote', remoteManaged: true })
  })
})
