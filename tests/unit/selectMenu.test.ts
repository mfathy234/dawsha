import { describe, expect, it } from 'vitest'
import { selectMenuIndex } from '../../src/renderer/components/selectMenu'

const options = [
  { label: 'Alpha' }, { label: 'Blocked', disabled: true },
  { label: 'Budget' }, { label: 'Beta' }, { label: 'Gamma' }
]

describe('dropdown keyboard navigation', () => {
  it('moves with arrows, skips disabled options and stops at the ends', () => {
    expect(selectMenuIndex(options, 0, 'ArrowDown')).toBe(2)
    expect(selectMenuIndex(options, 2, 'ArrowUp')).toBe(0)
    expect(selectMenuIndex(options, 4, 'ArrowDown')).toBe(4)
    expect(selectMenuIndex(options, 0, 'ArrowUp')).toBe(0)
  })

  it('uses Home and End to reach enabled endpoints', () => {
    expect(selectMenuIndex(options, 2, 'Home')).toBe(0)
    expect(selectMenuIndex([...options, { label: 'Hidden', disabled: true }], 0, 'End')).toBe(4)
  })

  it('cycles matching letters case-insensitively and wraps', () => {
    expect(selectMenuIndex(options, 0, 'b')).toBe(2)
    expect(selectMenuIndex(options, 2, 'B')).toBe(3)
    expect(selectMenuIndex(options, 3, 'b')).toBe(2)
    expect(selectMenuIndex(options, 2, 'z')).toBe(2)
  })

  it('handles empty and entirely disabled menus', () => {
    expect(selectMenuIndex([], -1, 'ArrowDown')).toBe(-1)
    expect(selectMenuIndex([{ label: 'Alpha', disabled: true }], -1, 'Home')).toBe(-1)
  })
})
