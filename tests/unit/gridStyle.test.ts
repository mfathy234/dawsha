import { describe, expect, it } from 'vitest'
import { canMakeLarge, focusLayout, isGridStyle, largeIndexOf, largeUnitIndex, paneUnitIds, promotedRows, quietPaneIds, resolveLargePane, tileLayout, tileRowSizes } from '../../src/shared/gridStyle'

const covered = (cells: { row: number; col: number; colSpan: number; rowSpan: number }[], cols: number, rows: number): boolean => {
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))
  for (const cell of cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c += 1) grid[r - 1][c - 1] += 1
    }
  }
  return grid.every((row) => row.every((count) => count === 1))
}

describe('grid style', () => {
  it('accepts only the two known styles', () => {
    expect(isGridStyle('focus')).toBe(true)
    expect(isGridStyle('tiles')).toBe(true)
    expect(isGridStyle('board')).toBe(false)
    expect(isGridStyle(undefined)).toBe(false)
  })

  it('puts the focused unit tall in column one and stacks the rest in column two', () => {
    const layout = focusLayout(4, 2)
    expect(layout.cols).toBe(2)
    expect(layout.rows).toBe(3)
    expect(layout.rowsFrom).toBe(1)
    expect(layout.cells[2]).toEqual({ row: 1, col: 1, colSpan: 1, rowSpan: 3 })
    expect(layout.cells.filter((cell) => cell.col === 2).map((cell) => cell.row)).toEqual([1, 2, 3])
    expect(covered(layout.cells, 2, 3)).toBe(true)
  })

  it('keeps one pane as the whole grid in focus mode', () => {
    const layout = focusLayout(1, 0)
    expect(layout.cells).toEqual([{ row: 1, col: 1, colSpan: 1, rowSpan: 1 }])
  })

  it('weights a sibling that needs you as a taller row', () => {
    const rows = promotedRows(3, [false, true, false])
    expect(rows[1]).toBeGreaterThan(rows[0] * 2.5)
    expect(rows.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(promotedRows(2, [false, false])).toEqual([0.5, 0.5])
    expect(promotedRows(0, [])).toEqual([])
  })

  it('spreads tiles into rows of at most three, with no lonely tile', () => {
    expect(tileRowSizes(2)).toEqual([2])
    expect(tileRowSizes(3)).toEqual([3])
    expect(tileRowSizes(4)).toEqual([2, 2])
    expect(tileRowSizes(5)).toEqual([3, 2])
    expect(tileRowSizes(7)).toEqual([3, 2, 2])
    expect(tileRowSizes(8)).toEqual([3, 3, 2])
    expect(tileRowSizes(9)).toEqual([3, 3, 3])
  })

  it('gives every tile in a row the same width for each count from one to nine', () => {
    for (let count = 1; count <= 9; count += 1) {
      const layout = tileLayout(count)
      expect(layout.cells).toHaveLength(count)
      expect(covered(layout.cells, layout.cols, layout.rows)).toBe(true)
      for (let row = 1; row <= layout.rows; row += 1) {
        const spans = layout.cells.filter((cell) => cell.row === row).map((cell) => cell.colSpan)
        expect(new Set(spans).size).toBe(1)
      }
    }
  })
})

describe('resolveLargePane', () => {
  const ids = ['a', 'b', 'c']
  it('follows the focused pane when selecting moves the large spot', () => {
    expect(resolveLargePane(ids, 'c', 'a', true)).toBe('c')
  })
  it('keeps the remembered large pane when the switch is off', () => {
    expect(resolveLargePane(ids, 'c', 'a', false)).toBe('a')
  })
  it('falls back to the focused pane, then the first, when the remembered one is gone', () => {
    expect(resolveLargePane(ids, 'b', 'gone', false)).toBe('b')
    expect(resolveLargePane(ids, null, null, false)).toBe('a')
    expect(resolveLargePane(ids, 'gone', 'gone', true)).toBe('a')
  })
  it('is null without panes', () => {
    expect(resolveLargePane([], 'a', 'a', true)).toBeNull()
  })
})

describe('large units and quiet panes', () => {
  const units = [['a'], ['b', 'c'], ['d']]
  it('finds the unit that holds the large pane, including a compare pair', () => {
    expect(largeUnitIndex(units, 'c')).toBe(1)
    expect(largeUnitIndex(units, null)).toBe(0)
    expect(largeUnitIndex(units, 'zzz')).toBe(0)
  })
  it('dims everything outside the large unit except the focused pane', () => {
    expect([...quietPaneIds(units, 0, 'd')].sort()).toEqual(['b', 'c'])
    expect([...quietPaneIds(units, 1, 'b')].sort()).toEqual(['a', 'd'])
    expect([...quietPaneIds(units, 0, 'a')].sort()).toEqual(['b', 'c', 'd'])
  })
  it('groups compare pairs into one unit', () => {
    const link = (slot: 'a' | 'b') => ({ id: 'k', slot }) as never
    expect(paneUnitIds([{ id: 'a' }, { id: 'b', compare: link('a') }, { id: 'c', compare: link('b') }, { id: 'd' }])).toEqual([['a'], ['b', 'c'], ['d']])
  })
  it('offers Make large only in calm focus with two or more units and a non-large pane', () => {
    expect(canMakeLarge('focus', units, 'a', 'b')).toBe(true)
    expect(canMakeLarge('focus', units, 'a', 'a')).toBe(false)
    expect(canMakeLarge('focus', units, 'b', 'c')).toBe(false)
    expect(canMakeLarge('tiles', units, 'a', 'b')).toBe(false)
    expect(canMakeLarge('focus', [['a']], 'a', 'a')).toBe(false)
  })
  it('turns a large pane id into a saved index and back, tolerating missing data', () => {
    expect(largeIndexOf(['a', 'b'], 'b')).toBe(1)
    expect(largeIndexOf(['a', 'b'], 'x')).toBeUndefined()
    expect(largeIndexOf(['a'], null)).toBeUndefined()
  })
})
