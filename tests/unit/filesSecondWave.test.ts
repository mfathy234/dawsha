import { describe, expect, it } from 'vitest'
import type { AgentEditEvent, EditPreviewFile, StaleCaller } from '../../src/shared/codeNavExtras'
import { askMessage } from '../../src/renderer/files/askAgent'
import { dirtyConflicts, outcomeText, placesIn, renameCopy, replaceCopy } from '../../src/renderer/files/editPlan'
import { followTarget, mayFollow } from '../../src/renderer/files/followAgent'
import { touchedLines, touchNote, touchText } from '../../src/renderer/files/lineTouch'
import { staleNote, staleRows } from '../../src/renderer/files/staleList'
import { stickyHeaders } from '../../src/renderer/files/stickyScroll'
import type { OutlineItem } from '../../src/renderer/files/outline'

const file = (path: string, matches: number): EditPreviewFile => ({ path, expectedMtime: 1, edits: [], matches })
const hit = (path: string, line: number, preview = 'call()') => ({ path, line, column: 1, preview })

describe('ask an agent', () => {
  it('names the file, the lines, the code and where it is used', () => {
    const text = askMessage({ path: 'src/a.ts', startLine: 4, endLine: 6, symbol: 'load', selection: 'function load() {}\n', references: [hit('src/b.ts', 9, 'load()')], referencesByName: false })
    expect(text).toContain('About @src/a.ts#L4-6 (load):')
    expect(text).toContain('```\nfunction load() {}\n```')
    expect(text).toContain('Used here:\n- src/b.ts:9  load()')
    expect(text.endsWith('\n\n')).toBe(true)
  })

  it('says best guesses when the references came from a name search, and caps the list', () => {
    const many = Array.from({ length: 11 }, (_, index) => hit('src/c.ts', index + 1))
    const text = askMessage({ path: 'a.ts', startLine: 2, endLine: 2, symbol: null, selection: '', references: many, referencesByName: true })
    expect(text).toContain('About @a.ts#L2:')
    expect(text).toContain('best guesses found by name')
    expect(text).toContain('- and 3 more')
    expect(text).not.toContain('```')
  })
})

describe('line sessions', () => {
  it('tells the truth about each precision', () => {
    const file = touchText({ sessionId: 's', agent: 'claude', at: Date.UTC(2026, 0, 1, 10, 0), precision: 'file' })
    expect(file.title).toMatch(/edited this file/)
    expect(file.title).toMatch(/does not say which lines/)
    const time = touchText({ sessionId: 's', agent: 'codex', at: Date.UTC(2026, 0, 1, 10, 0), precision: 'time' })
    expect(time.title).toMatch(/Matched by time/)
    expect(time.guess).toBe(true)
  })

  it('keeps lines that have a session and explains an unknown result', () => {
    const touch = { sessionId: 's', agent: 'gemini' as const, at: 1, precision: 'time' as const }
    const result = { ok: true as const, precision: 'time' as const, lines: [{ line: 2, session: touch }, { line: 3 }], note: 'Matched by time.' }
    expect([...touchedLines(result).keys()]).toEqual([2])
    expect(touchNote(result)).toBe('Matched by time.')
    expect(touchNote({ ok: true, precision: 'unknown', lines: [], note: '' })).toMatch(/No agent session/)
    expect(touchNote({ ok: false, error: 'Not a repository.' })).toBe('Not a repository.')
    expect(touchedLines(null).size).toBe(0)
  })
})

describe('unupdated callers', () => {
  const symbol = { path: 'src/a.ts', line: 1, column: 1, preview: 'export function load(id: string)' }
  it('lists callers and implementations, labelled when found by name', () => {
    const exact: StaleCaller = { symbol, engine: 'typescript', references: [hit('src/b.ts', 3)], implementations: [hit('src/c.ts', 4)] }
    const guess: StaleCaller = { symbol, engine: 'name', references: [hit('src/d.ts', 5)], implementations: [] }
    const rows = staleRows([exact, guess])
    expect(rows.map((row) => row.kind)).toEqual(['caller', 'implementation', 'caller'])
    expect(rows[0].group).toBe('export function load(id: string)')
    expect(rows[2].group).toContain('best guesses by name')
    expect(new Set(rows.map((row) => row.id)).size).toBe(3)
  })

  it('explains a scan that stopped early', () => {
    expect(staleNote({ ok: true, symbols: [], stoppedEarly: false, scannedSymbols: 4 })).toBe('')
    expect(staleNote({ ok: true, symbols: [], stoppedEarly: true, reason: 'timeout', scannedSymbols: 4 })).toMatch(/took too long/)
    expect(staleNote({ ok: true, symbols: [], stoppedEarly: true, reason: 'symbolCap', scannedSymbols: 50 })).toMatch(/first 50/)
  })
})

describe('rename and replace confirmations', () => {
  const files = [file('src/a.ts', 3), file('src/b.ts', 1)]

  it('names the files and counts on the message and the button', () => {
    const rename = renameCopy('load', 'fetchData', files)
    expect(rename.title).toBe('Rename load to fetchData?')
    expect(rename.body).toContain('4 places in 2 files')
    expect(rename.body).toContain('src/a.ts  3 places')
    expect(rename.body).toContain('src/b.ts  1 place')
    expect(rename.confirmLabel).toBe('Rename in 2 files (4 places)')
    const replace = replaceCopy('foo', 'bar', files)
    expect(replace.title).toBe('Replace "foo" with "bar" in 2 files?')
    expect(replace.confirmLabel).toBe('Replace 4 matches in 2 files')
  })

  it('lists at most eight files and counts the rest', () => {
    const many = Array.from({ length: 11 }, (_, index) => file(`f${index}.ts`, 1))
    expect(replaceCopy('a', 'b', many).body).toContain('and 3 more files')
    expect(placesIn(many)).toBe('11 places in 11 files')
  })

  it('finds the files that have unsaved edits', () => {
    expect(dirtyConflicts(files, ['src/b.ts', 'src/z.ts'])).toEqual(['src/b.ts'])
  })

  it('reports files that were not changed with the reason', () => {
    const done = outcomeText([{ path: 'a.ts', ok: true }, { path: 'b.ts', ok: false, conflict: true }, { path: 'c.ts', ok: false, error: 'Read only' }])
    expect(done.changed).toEqual(['a.ts'])
    expect(done.text).toContain('Changed 1 file. 2 files not changed.')
    expect(done.text).toContain('b.ts: changed on disk since the preview')
    expect(done.text).toContain('c.ts: Read only')
    expect(outcomeText([{ path: 'a.ts', ok: true }, { path: 'b.ts', ok: true }]).text).toBe('Changed 2 files')
  })
})

describe('follow the agent', () => {
  const event: AgentEditEvent = { folder: 'C:\\Work\\app\\', path: 'src/a.ts', sessionId: 's', agent: 'claude', at: 1, precision: 'file' }

  it('does nothing while it is off', () => {
    expect(followTarget(event, 'C:\\Work\\app', '', false)).toBeNull()
  })

  it('opens the edited file of this folder, in repo form', () => {
    expect(followTarget(event, 'c:\\work\\app', '', true)).toBe('src/a.ts')
    expect(followTarget(event, 'C:\\Work\\app', 'packages/web', true)).toBe('packages/web/src/a.ts')
    expect(followTarget(event, 'C:\\Other', '', true)).toBeNull()
  })

  it('does not switch away from unsaved work', () => {
    expect(mayFollow(null)).toBe(true)
    expect(mayFollow({ dirty: false, editing: false })).toBe(true)
    expect(mayFollow({ dirty: true, editing: true })).toBe(false)
    expect(mayFollow({ dirty: false, editing: true })).toBe(false)
  })
})

describe('sticky scroll', () => {
  const item = (name: string, line: number, depth: number): OutlineItem => ({ name, kind: 'function', from: line * 10, line, depth })
  const outline = [item('Store', 1, 0), item('read', 3, 1), item('write', 9, 1), item('helper', 20, 0)]

  it('shows the class and the method that scrolled off', () => {
    expect(stickyHeaders(outline, 12).map((entry) => entry.name)).toEqual(['Store', 'write'])
    expect(stickyHeaders(outline, 21).map((entry) => entry.name)).toEqual(['helper'])
  })

  it('shows nothing while the header is still in view', () => {
    expect(stickyHeaders(outline, 1)).toEqual([])
    expect(stickyHeaders(outline, 3).map((entry) => entry.name)).toEqual(['Store'])
  })

  it('keeps at most three', () => {
    const deep = [item('a', 1, 0), item('b', 2, 1), item('c', 3, 2), item('d', 4, 3)]
    expect(stickyHeaders(deep, 10).map((entry) => entry.name)).toEqual(['b', 'c', 'd'])
  })
})
