import { pairOf } from './compare'
import type { Cell, GridLayout } from './layout'
import type { CompareLink } from './types'

/** Calm focus: one large pane and quieter siblings in a column. Mission control: equal tiles. */
export type GridStyle = 'focus' | 'tiles'

export const DEFAULT_GRID_STYLE: GridStyle = 'focus'
export const GRID_STYLE_LABELS: Record<GridStyle, string> = { focus: 'Calm focus', tiles: 'Mission control' }

export const isGridStyle = (value: unknown): value is GridStyle => value === 'focus' || value === 'tiles'

export const NEEDS_PROMOTION = 2.6
const TILE_TRACKS = 12
const MAX_TILES_PER_ROW = 3

/** Sibling rows in the focus column, weighted so a sibling that needs you is taller. */
export function promotedRows(siblings: number, needs: boolean[]): number[] {
  if (siblings <= 0) return []
  const weights = Array.from({ length: siblings }, (_, index) => (needs[index] ? NEEDS_PROMOTION : 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

/** Focus unit spans every row of column one; the other units stack in column two. */
export function focusLayout(count: number, focus: number): GridLayout {
  const siblings = Math.max(0, count - 1)
  let ordinal = 0
  const cells: Cell[] = Array.from({ length: count }, (_, index) => {
    if (index === focus) return { row: 1, col: 1, colSpan: 1, rowSpan: Math.max(1, siblings) }
    ordinal += 1
    return { row: ordinal, col: 2, colSpan: 1, rowSpan: 1 }
  })
  return { cols: 2, rows: Math.max(1, siblings), scrolls: false, variant: 'b', rowsFrom: 1, cells }
}

/** Rows of at most three equal tiles; a row count is spread evenly so no row holds one tile alone. */
export function tileRowSizes(count: number): number[] {
  if (count <= 0) return []
  const rows = Math.ceil(count / MAX_TILES_PER_ROW)
  const base = Math.floor(count / rows)
  const extra = count % rows
  return Array.from({ length: rows }, (_, index) => (index < extra ? base + 1 : base))
}

/** Equal tiles on a twelve-track grid: each row of n tiles spans 12 / n tracks each. */
export function tileLayout(count: number): GridLayout {
  const sizes = tileRowSizes(count)
  const cells: Cell[] = []
  sizes.forEach((size, row) => {
    const span = TILE_TRACKS / size
    for (let slot = 0; slot < size; slot += 1) cells.push({ row: row + 1, col: slot * span + 1, colSpan: span, rowSpan: 1 })
  })
  return { cols: TILE_TRACKS, rows: Math.max(1, sizes.length), scrolls: false, variant: '', rowsFrom: 0, cells }
}

/**
 * The pane that is large in Calm focus. With "move the session I pick to the large spot" on it is
 * the focused pane; off, it is the remembered large pane while that still exists, then the focused
 * pane, then the first one. Null only when there are no panes.
 */
export function resolveLargePane(ids: string[], focusedId: string | null, largeId: string | null, moveOnFocus: boolean): string | null {
  if (ids.length === 0) return null
  const focused = focusedId !== null && ids.includes(focusedId) ? focusedId : null
  if (moveOnFocus && focused) return focused
  if (largeId !== null && ids.includes(largeId)) return largeId
  return focused ?? ids[0]
}

/** Index of the unit (a pane, or a compare pair) that holds the large pane; 0 when none does. */
export function largeUnitIndex(units: string[][], largeId: string | null): number {
  return Math.max(0, units.findIndex((unit) => largeId !== null && unit.includes(largeId)))
}

/** Panes to dim: everything outside the large unit, except the pane you are working in. */
export function quietPaneIds(units: string[][], largeIndex: number, focusedId: string | null): Set<string> {
  const quiet = new Set<string>()
  units.forEach((unit, index) => {
    if (index === largeIndex) return
    for (const id of unit) if (id !== focusedId) quiet.add(id)
  })
  return quiet
}

/** Whether "Make large" applies to a pane: Calm focus, two or more units, and it is not large already. */
export function canMakeLarge(style: GridStyle, units: string[][], largeId: string | null, paneId: string): boolean {
  if (style !== 'focus' || units.length < 2) return false
  const unit = units.find((candidate) => candidate.includes(paneId))
  return unit !== undefined && !(largeId !== null && unit.includes(largeId))
}

/** Index of a pane in the saved workspace, tolerant of old data that never saved one. */
export function largeIndexOf(ids: string[], largeId: string | null): number | undefined {
  const index = largeId === null ? -1 : ids.indexOf(largeId)
  return index >= 0 ? index : undefined
}

/** Pane ids grouped the way the grid lays them out: a compare pair is one unit. */
export function paneUnitIds(panes: { id: string; compare?: CompareLink }[]): string[][] {
  const units: string[][] = []
  for (let index = 0; index < panes.length; index += 1) {
    const pair = pairOf(panes, index)
    units.push(pair ? [pair.a.id, pair.b.id] : [panes[index].id])
    if (pair) index += 1
  }
  return units
}
