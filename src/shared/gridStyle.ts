import type { Cell, GridLayout } from './layout'

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
