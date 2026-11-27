import type { Terminal } from '@xterm/xterm'

type Redraw = (...args: unknown[]) => void

interface CoreAccess {
  _core?: {
    _renderService?: { handleSelectionChanged?: Redraw }
    _selectionService?: { refresh?: () => void }
  }
}

/**
 * xterm redraws a terminal's selection after every scroll, and the DOM renderer does it even when the terminal is
 * hidden: every row is rebuilt and every unusual glyph measured in a display:none box, where a width is never kept.
 * A hidden session that streams output then costs more than the visible one. While a terminal is hidden this keeps
 * that one redraw from running; showing it again asks xterm for a normal repaint.
 */
const muted = new WeakMap<object, { own: boolean; original: Redraw | undefined }>()

export function muteHiddenSelectionRedraw(term: Terminal, hidden: boolean): void {
  const core = (term as unknown as CoreAccess)._core
  const render = core?._renderService
  if (!render) return
  const saved = muted.get(render)
  if (hidden && !saved) {
    muted.set(render, { own: Object.prototype.hasOwnProperty.call(render, 'handleSelectionChanged'), original: render.handleSelectionChanged })
    render.handleSelectionChanged = () => undefined
  } else if (!hidden && saved) {
    muted.delete(render)
    if (saved.own) render.handleSelectionChanged = saved.original
    else delete render.handleSelectionChanged
    core?._selectionService?.refresh?.()
  }
}
