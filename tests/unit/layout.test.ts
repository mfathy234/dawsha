import { describe, expect, it } from 'vitest'
import { layoutForCount } from '../../src/shared/layout'
import { defaultSplit, resolveSplit, sanitizeSplits, withSplit } from '../../src/shared/splits'

describe('layoutForCount', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 6, 3],
    [8, 6, 3],
    [9, 6, 3],
    [10, 6, 4]
  ])('%i panes -> %i columns x %i rows', (count, cols, rows) => {
    const layout = layoutForCount(count)
    expect(layout.cols).toBe(cols)
    expect(layout.rows).toBe(rows)
    expect(layout.cells).toHaveLength(count)
  })

  it('gives pane 1 a tall left column for three panes', () => {
    const { cells, variant, rowsFrom } = layoutForCount(3)
    expect(cells).toEqual([
      { row: 1, col: 1, colSpan: 1, rowSpan: 2 },
      { row: 1, col: 2, colSpan: 1, rowSpan: 1 },
      { row: 2, col: 2, colSpan: 1, rowSpan: 1 }
    ])
    expect(variant).toBe('b')
    expect(rowsFrom).toBe(1)
  })

  it('puts a tall pane beside a 2x2 block for five panes', () => {
    const { cells } = layoutForCount(5)
    expect(cells[0]).toEqual({ row: 1, col: 1, colSpan: 1, rowSpan: 2 })
    expect(cells.slice(1).map((c) => [c.row, c.col])).toEqual([[1, 2], [1, 3], [2, 2], [2, 3]])
  })

  it('leaves full grids plain', () => {
    for (const count of [2, 4, 6]) {
      const layout = layoutForCount(count)
      expect(layout.variant).toBe('')
      expect(layout.cells.every((c) => c.colSpan === 1 && c.rowSpan === 1)).toBe(true)
    }
  })

  it('scrolls from seven panes', () => {
    expect(layoutForCount(6).scrolls).toBe(false)
    expect(layoutForCount(7).scrolls).toBe(true)
  })

  it('handles an empty grid', () => {
    expect(layoutForCount(0).cells).toEqual([])
  })

  it('never leaves a pane alone on a row or two cells overlapping', () => {
    for (let count = 2; count <= 24; count += 1) {
      const { cells, cols, rows } = layoutForCount(count)
      const taken = new Set<string>()
      for (const c of cells) {
        expect(c.col + c.colSpan - 1).toBeLessThanOrEqual(cols)
        expect(c.row + c.rowSpan - 1).toBeLessThanOrEqual(rows)
        for (let r = c.row; r < c.row + c.rowSpan; r += 1) {
          for (let k = c.col; k < c.col + c.colSpan; k += 1) {
            expect(taken.has(`${r}:${k}`)).toBe(false)
            taken.add(`${r}:${k}`)
          }
        }
      }
      expect(taken.size).toBe(cols * rows)
      const widest = Math.max(...cells.map((c) => c.colSpan))
      expect(widest).toBeLessThan(cols)
    }
  })
})

describe('tall-first splits', () => {
  it('opens with a wide first column', () => {
    expect(defaultSplit(2, 2, 'b').cols).toEqual([0.57, 0.43])
    expect(resolveSplit(undefined, 2, 2, 'b').cols).toEqual([0.57, 0.43])
    expect(resolveSplit(undefined, 2, 2).cols).toEqual([0.5, 0.5])
  })

  it('keeps resized columns apart from the plain grid of the same size', () => {
    const stored = withSplit({}, 2, 2, 'cols', [0.7, 0.3], 'b')
    expect(Object.keys(stored)).toEqual(['2x2b'])
    expect(resolveSplit(stored, 2, 2).cols).toEqual([0.5, 0.5])
    expect(withSplit(stored, 2, 2, 'cols', [0.57, 0.43], 'b')).toEqual({})
  })

  it('accepts saved tall-first shapes', () => {
    expect(sanitizeSplits({ '3x2b': { cols: [1, 1, 2], rows: [1, 1] } })).toEqual({
      '3x2b': { cols: [0.25, 0.25, 0.5], rows: [0.5, 0.5] }
    })
  })
})
