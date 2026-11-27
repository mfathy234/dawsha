import { describe, expect, it } from 'vitest'
import { formatAgo, formatClock, lineTimeLabel, parseBlocks, quoteText } from '../../src/shared/terminalBlocks'
import { marksOf, thinTicks } from '../../src/renderer/terminalBlockBars'
import { liveStartRow } from '../../src/renderer/terminalBlocks'
import { CLAUDE_SESSION, toLines } from '../support/blockFixtures'

describe('scrollbar marks', () => {
  const lines = toLines(CLAUDE_SESSION)
  const blocks = parseBlocks(lines, { agent: 'claude', liveFromRow: lines.findIndex((line) => line.text.startsWith('╭')) })

  it('marks prompts, commands and failures but not replies', () => {
    const kinds = marksOf(blocks).map((tick) => tick.kind)
    expect(kinds.filter((kind) => kind === 'prompt')).toHaveLength(1)
    expect(kinds).toContain('error')
    expect(kinds.filter((kind) => kind === 'command')).toHaveLength(4)
  })

  it('keeps one tick per slot and lets an error win over a command', () => {
    const thinned = thinTicks([{ row: 10, kind: 'command' }, { row: 10, kind: 'error' }, { row: 11, kind: 'command' }], 1000, 10)
    expect(thinned).toEqual([{ row: 10, kind: 'error' }])
  })
})

describe('live area detection', () => {
  it('finds the top of the input box near the bottom', () => {
    const rows = ['● reply', '', '✻ Thinking…', '╭────────╮', '│ >      │', '╰────────╯']
    expect(liveStartRow(rows, 100)).toBe(103)
  })

  it('finds a Codex input line and nothing in plain output', () => {
    expect(liveStartRow(['• done', '', '› Ask anything'], 0)).toBe(2)
    expect(liveStartRow(['ls', 'a.txt'], 0)).toBeUndefined()
  })
})

describe('line times', () => {
  it('formats the clock and the age', () => {
    const at = new Date(2026, 10, 26, 14, 2, 31).getTime()
    expect(formatClock(at)).toBe('14:02:31')
    expect(formatAgo(at, at + 2000)).toBe('just now')
    expect(formatAgo(at, at + 45_000)).toBe('45s ago')
    expect(formatAgo(at, at + 180_000)).toBe('3m ago')
    expect(formatAgo(at, at + 7_200_000)).toBe('2h ago')
    expect(lineTimeLabel(at, at + 180_000)).toBe('14:02:31 · 3m ago')
  })

  it('quotes text for another session', () => {
    expect(quoteText('a\n\nb\n')).toBe('> a\n>\n> b')
  })
})
