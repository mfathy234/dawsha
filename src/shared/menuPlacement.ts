export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Placement {
  left: number
  top: number
  /** Set when the menu is taller than the room on its side; it then scrolls inside. */
  maxHeight: number | null
}

const MARGIN = 8

/**
 * Where to open a menu of `width` x `height` next to `anchor` in a `viewWidth` x `viewHeight` window: below and aligned
 * to the start of the button, flipping to its end when the start side would leave the window. Below when it fits,
 * otherwise on the side with more room, shortened to that room, so it never covers the button that opened it.
 */
export function placeMenu(anchor: Rect, width: number, height: number, viewWidth: number, viewHeight: number, gap = 4): Placement {
  const fitsAtStart = anchor.left + width <= viewWidth - MARGIN
  const alignEnd = anchor.right - width
  const left = Math.max(MARGIN, fitsAtStart ? anchor.left : alignEnd >= MARGIN ? alignEnd : Math.min(anchor.left, viewWidth - width - MARGIN))
  const roomBelow = viewHeight - MARGIN - (anchor.bottom + gap)
  const roomAbove = anchor.top - gap - MARGIN
  const below = height <= roomBelow || roomBelow >= roomAbove
  const room = Math.max(0, below ? roomBelow : roomAbove)
  const shown = Math.min(height, room)
  return {
    left,
    top: below ? anchor.bottom + gap : anchor.top - gap - shown,
    maxHeight: height > room ? room : null
  }
}

/**
 * Where a right-click menu of `width` x `height` goes for a pointer at (x, y): its top-left corner on the pointer,
 * moved left or up when it would leave the window, and shortened to the window (it then scrolls) when it is taller.
 */
export function placeAtPoint(x: number, y: number, width: number, height: number, viewWidth: number, viewHeight: number): Placement {
  const left = Math.max(MARGIN, Math.min(x, viewWidth - width - MARGIN))
  const room = Math.max(0, viewHeight - 2 * MARGIN)
  const shown = Math.min(height, room)
  const top = Math.max(MARGIN, Math.min(y, viewHeight - shown - MARGIN))
  return { left, top, maxHeight: height > room ? room : null }
}
