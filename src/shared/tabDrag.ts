/**
 * Where a dragged tab would land: the number of tabs whose middle lies left of the pointer, so 0 is before the first tab
 * and `centers.length` is after the last. `centers` are the horizontal middles of the tabs in order.
 */
export function dropSlot(centers: readonly number[], pointerX: number): number {
  let slot = 0
  for (const center of centers) if (pointerX > center) slot += 1
  return slot
}

/** The index a tab at `from` ends up at once it is dropped in `slot` (a gap, as dropSlot counts it). */
export function slotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot
}

/** Whether dropping in `slot` leaves the tab where it is: the gaps just before and after it. */
export const isNoMove = (from: number, slot: number): boolean => slot === from || slot === from + 1
