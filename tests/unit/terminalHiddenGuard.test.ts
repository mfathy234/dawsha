import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { muteHiddenSelectionRedraw } from '../../src/renderer/terminalHiddenGuard'

function fakeTerminal() {
  const redraw = vi.fn()
  const refresh = vi.fn()
  const render = { handleSelectionChanged: redraw }
  const term = { _core: { _renderService: render, _selectionService: { refresh } } } as unknown as Terminal
  return { term, render, redraw, refresh }
}

describe('muteHiddenSelectionRedraw', () => {
  it('stops the selection redraw while hidden and brings it back, with a repaint, when shown', () => {
    const { term, render, redraw, refresh } = fakeTerminal()
    muteHiddenSelectionRedraw(term, true)
    render.handleSelectionChanged()
    expect(redraw).not.toHaveBeenCalled()
    muteHiddenSelectionRedraw(term, true)
    muteHiddenSelectionRedraw(term, false)
    expect(refresh).toHaveBeenCalledTimes(1)
    render.handleSelectionChanged()
    expect(redraw).toHaveBeenCalledTimes(1)
  })

  it('leaves a terminal without the internals alone', () => {
    expect(() => muteHiddenSelectionRedraw({} as Terminal, true)).not.toThrow()
  })
})
