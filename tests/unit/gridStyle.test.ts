import { describe, expect, it } from 'vitest'
import { focusLayout, isGridStyle, promotedRows, tileLayout, tileRowSizes } from '../../src/shared/gridStyle'

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
