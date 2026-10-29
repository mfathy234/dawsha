import { describe, expect, it } from 'vitest'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../src/shared/types'
import { sharedZoomState } from '../../src/renderer/sharedZoom'
import type { AppState } from '../../src/renderer/state'

function stateWith(focusedId: string | null, sizes: Array<[string, string, number]>, projectSizes: Record<string, number>): AppState {
  return {
    focusedId,
    panes: sizes.map(([id, projectId, fontSize]) => ({ id, projectId, fontSize })),
    settings: { projects: Object.entries(projectSizes).map(([id, fontSize]) => ({ id, name: id, folder: '', fontSize })) }
  } as unknown as AppState
}

describe('sharedZoomState', () => {
  it('takes the focused pane size as the base and applies one size to every pane and open project', () => {
    const state = stateWith('p2', [['p1', 'a', 13], ['p2', 'b', 16], ['p3', 'a', 13]], { a: 13, b: 16, c: 12 })
    const next = sharedZoomState(state, 1)
    expect(next.panes.map((pane) => pane.fontSize)).toEqual([17, 17, 17])
    expect(next.settings.projects.map((project) => [project.id, project.fontSize])).toEqual([['a', 17], ['b', 17], ['c', 12]])
  })

  it('uses the first pane as the base when nothing is focused, matching the top bar label', () => {
    const next = sharedZoomState(stateWith(null, [['p1', 'a', 14], ['p2', 'b', 20]], { a: 14, b: 20 }), -1)
    expect(next.panes.map((pane) => pane.fontSize)).toEqual([13, 13])
  })

  it('clamps the shared size and leaves the input state untouched', () => {
    const state = stateWith('p1', [['p1', 'a', MAX_FONT_SIZE]], { a: MAX_FONT_SIZE })
    expect(sharedZoomState(state, 1).panes[0].fontSize).toBe(MAX_FONT_SIZE)
    expect(sharedZoomState(stateWith('p1', [['p1', 'a', MIN_FONT_SIZE]], {}), -1).panes[0].fontSize).toBe(MIN_FONT_SIZE)
    expect(state.panes[0].fontSize).toBe(MAX_FONT_SIZE)
  })

  it('reads the latest size on each call, so rapid clicks accumulate', () => {
    let state = stateWith('p1', [['p1', 'a', 15], ['p2', 'b', 15]], { a: 15, b: 15 })
    for (const delta of [1, 1, -1]) state = sharedZoomState(state, delta)
    expect(state.panes.map((pane) => pane.fontSize)).toEqual([16, 16])
  })
})
