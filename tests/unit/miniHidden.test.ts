import { describe, expect, it } from 'vitest'
import { hiddenKey, hideMiniSession, isMiniHidden, reconcileMiniHidden, splitMiniHidden } from '../../src/shared/miniHidden'

const session = (paneId: string, sessionId = 's1', state = 'working') => ({ paneId, sessionId, state })

describe('Mini hidden sessions', () => {
  it('hides a session by pane and session id, and shows the others', () => {
    const hidden = hideMiniSession([], { paneId: 'p1', sessionId: 's1' })
    expect(hidden).toEqual([hiddenKey({ paneId: 'p1', sessionId: 's1' })])
    const { shown, hiddenCount } = splitMiniHidden(hidden, [session('p1'), session('p2')])
    expect(shown.map(s => s.paneId)).toEqual(['p2'])
    expect(hiddenCount).toBe(1)
  })

  it('brings them back when the list is cleared', () => {
    expect(splitMiniHidden([], [session('p1'), session('p2')]).hiddenCount).toBe(0)
  })

  it('keeps a restored pane hidden with the same session, and shows a new session in that pane', () => {
    const hidden = hideMiniSession([], { paneId: 'p1', sessionId: 's1' })
    expect(isMiniHidden(hidden, { paneId: 'p1', sessionId: 's1' })).toBe(true)
    expect(isMiniHidden(hidden, { paneId: 'p1', sessionId: 's2' })).toBe(false)
  })

  it('hides a pane hidden before its session id was known, whatever the id becomes', () => {
    const hidden = hideMiniSession([], { paneId: 'p1', sessionId: '' })
    expect(isMiniHidden(hidden, { paneId: 'p1', sessionId: 'later' })).toBe(true)
  })

  it('keeps one entry per pane', () => {
    const once = hideMiniSession([], { paneId: 'p1', sessionId: 's1' })
    expect(hideMiniSession(once, { paneId: 'p1', sessionId: 's2' })).toEqual([hiddenKey({ paneId: 'p1', sessionId: 's2' })])
  })

  it('never hides a session that needs you, and forgets its entry so it stays after you answer', () => {
    const hidden = hideMiniSession([], { paneId: 'p1', sessionId: 's1' })
    const listed = [session('p1', 's1', 'needs')]
    expect(splitMiniHidden(hidden, listed).shown).toHaveLength(1)
    expect(reconcileMiniHidden(hidden, listed)).toEqual([])
    expect(reconcileMiniHidden(hidden, [session('p1')])).toEqual(hidden)
  })

  it('drops entries of panes that are gone', () => {
    const hidden = hideMiniSession(hideMiniSession([], { paneId: 'p1', sessionId: 's1' }), { paneId: 'p2', sessionId: 's1' })
    expect(reconcileMiniHidden(hidden, [session('p2')])).toEqual([hiddenKey({ paneId: 'p2', sessionId: 's1' })])
  })
})
