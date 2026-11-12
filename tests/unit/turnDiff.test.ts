import { describe, expect, it } from 'vitest'
import { changesLabel, editedSince, isFolded, parseTurnDiff, TURN_DIFF_FOLD, visibleRows } from '../../src/shared/turnDiff'

const SAMPLE = [
  'diff --git a/x b/x',
  '--- a/x',
  '+++ b/x',
  '@@ -12,3 +12,4 @@ parseDate(input: string)',
  '   const trimmed = input.trim()',
  '-  return new Date(trimmed)',
  '+  const hasZone = true',
  '+  return new Date(hasZone ? trimmed : `${trimmed}Z`)',
  ' }',
  '@@ -40,1 +41,1 @@',
  '-old',
  '+new'
].join('\n')

describe('parseTurnDiff', () => {
  it('numbers old and new lines from each hunk and names hunks by their text', () => {
    const diff = parseTurnDiff(SAMPLE)
    expect(diff.hunks).toBe(2)
    expect(diff.rows[0]).toEqual({ k: 'hunk', t: '@@ parseDate(input: string) @@' })
    expect(diff.rows[1]).toEqual({ k: 'ctx', old: 12, new: 12, t: '  const trimmed = input.trim()' })
    expect(diff.rows[2]).toEqual({ k: 'del', old: 13, t: '  return new Date(trimmed)' })
    expect(diff.rows[3]).toMatchObject({ k: 'add', new: 13 })
    expect(diff.rows[4]).toMatchObject({ k: 'add', new: 14 })
    expect(diff.rows[5]).toMatchObject({ k: 'ctx', old: 14, new: 15 })
    expect(diff.rows[6]).toEqual({ k: 'hunk', t: '@@ -40 +41 @@' })
    expect(diff).toMatchObject({ added: 3, removed: 2 })
  })

  it('ignores headers, the no-newline marker and text with no hunk', () => {
    expect(parseTurnDiff('')).toMatchObject({ rows: [], hunks: 0 })
    expect(parseTurnDiff('Binary files differ').rows).toEqual([])
    expect(parseTurnDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b').rows.map((row) => row.k)).toEqual(['hunk', 'del', 'add'])
  })

  it('cuts very long lines', () => {
    const row = parseTurnDiff(`@@ -1 +1 @@\n+${'x'.repeat(500)}`).rows[1]
    expect(row.t.length).toBe(301)
    expect(row.t.endsWith('…')).toBe(true)
  })
})

describe('folding', () => {
  const long = parseTurnDiff(`@@ -1,60 +1,60 @@\n${Array.from({ length: 59 }, (_, i) => `+line ${i}`).join('\n')}`)

  it('shows the first 40 rows of a long diff until it is opened', () => {
    expect(long.rows.length).toBe(60)
    expect(isFolded(long, false)).toBe(true)
    expect(visibleRows(long, false)).toHaveLength(TURN_DIFF_FOLD)
    expect(visibleRows(long, true)).toHaveLength(60)
    expect(isFolded(long, true)).toBe(false)
  })

  it('does not fold a short diff', () => {
    const short = parseTurnDiff(SAMPLE)
    expect(isFolded(short, false)).toBe(false)
    expect(visibleRows(short, false)).toBe(short.rows)
  })

  it('counts the changes on screen', () => {
    expect(changesLabel(parseTurnDiff(SAMPLE), false)).toBe('2 of 2 changes')
    expect(changesLabel(parseTurnDiff('@@ -1 +1 @@\n-a\n+b'), false)).toBe('1 of 1 change')
    const many = parseTurnDiff(`@@ -1 +1 @@\n${Array.from({ length: 45 }, () => '+a').join('\n')}\n@@ -90 +90 @@\n+z`)
    expect(changesLabel(many, false)).toBe('1 of 2 changes')
    expect(changesLabel(many, true)).toBe('2 of 2 changes')
  })
})

describe('editedSince', () => {
  it('is true only for a save clearly after the reply', () => {
    expect(editedSince(10_000, 1_000)).toBe(true)
    expect(editedSince(2_000, 1_000)).toBe(false)
    expect(editedSince(4_000, 1_000)).toBe(false)
    expect(editedSince(4_001, 1_000)).toBe(true)
  })

  it('is false when either time is unknown', () => {
    expect(editedSince(null, 1_000)).toBe(false)
    expect(editedSince(10_000, undefined)).toBe(false)
  })
})
