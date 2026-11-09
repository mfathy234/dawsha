import { describe, expect, it } from 'vitest'
import { promptLayout, shrinkSelection, wordStartBefore } from '../../src/shared/promptLayout'

describe('promptLayout', () => {
  it('finds a Claude Code prompt between rules and maps each character to its cell', () => {
    const rows = ['some output', '─────────────', '> fix the login bug', '─────────────', '  ? for shortcuts']
    const layout = promptLayout(rows, 40)!
    expect(layout.text).toBe('fix the login bug')
    expect(layout.cells[0]).toEqual({ row: 2, col: 2 })
    expect(layout.cells.at(-1)).toEqual({ row: 2, col: 18 })
  })
  it('follows a prompt that wraps onto indented rows', () => {
    const rows = ['─────────', '> one two three', '  four five', '─────────']
    const layout = promptLayout(rows, 15)!
    expect(layout.text).toBe('one two three four five')
    expect(layout.cells[layout.text.indexOf('four')]).toEqual({ row: 2, col: 2 })
  })
  it('reads a Codex composer', () => {
    const layout = promptLayout(['› add tests'], 30)!
    expect(layout.text).toBe('add tests')
    expect(layout.cells[0]).toEqual({ row: 0, col: 2 })
  })
  it('reads a boxed prompt', () => {
    const layout = promptLayout(['╭──────────╮', '│ > hello  │', '╰──────────╯'], 12)!
    expect(layout.text).toBe('hello')
    expect(layout.cells[0]).toEqual({ row: 1, col: 4 })
  })
  it('is null when there is no prompt or it is empty', () => {
    expect(promptLayout(['PS C:\\work> dir'], 40)).toBeNull()
    expect(promptLayout(['─────', '> ', '─────'], 40)).toBeNull()
  })
})

describe('word steps', () => {
  const text = 'fix the  login bug'
  it('moves back a word at a time, past spaces', () => {
    expect(wordStartBefore(text, text.length)).toBe(15)
    expect(wordStartBefore(text, 15)).toBe(9)
    expect(wordStartBefore(text, 9)).toBe(4)
    expect(wordStartBefore(text, 4)).toBe(0)
    expect(wordStartBefore(text, 0)).toBe(0)
  })
  it('gives words back from the start of the selection', () => {
    expect(shrinkSelection(text, 0)).toBe(4)
    expect(shrinkSelection(text, 4)).toBe(9)
    expect(shrinkSelection(text, 15)).toBe(text.length)
  })
})
