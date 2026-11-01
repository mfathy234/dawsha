import { describe, expect, it } from 'vitest'
import type { CodeNavResult, CodeNavStatus } from '../../src/shared/codeNav'
import { EMPTY_HISTORY, forgetPath, recordJump, stepBack, stepForward } from '../../src/renderer/files/navHistory'
import { byNameNote, engineLine, planNavigation } from '../../src/renderer/files/navOutcome'
import { relocateHit } from '../../src/renderer/files/relocate'
import { indentSettings } from '../../src/renderer/files/indentRules'
import { lineCount } from '../../src/renderer/files/lineCount'
import { shouldSearch } from '../../src/renderer/files/searchGate'
import { enclosingSymbols, filterOutline, parseLineInput } from '../../src/renderer/files/jumpInputs'
import type { OutlineItem } from '../../src/renderer/files/outline'

const hit = (path: string, line: number) => ({ path, line, column: 1, preview: `line ${line}` })
const exact = (hits: ReturnType<typeof hit>[], outside = false): CodeNavResult => ({ ok: true, hits, engine: 'typescript', outside })
const byName = (hits: ReturnType<typeof hit>[]): CodeNavResult => ({ ok: true, hits, engine: 'name', outside: false })

describe('navigation history', () => {
  it('goes back and forward through the places it left', () => {
    let history = recordJump(EMPTY_HISTORY, { path: 'a.ts', pos: 10 })
    history = recordJump(history, { path: 'b.ts', pos: 20 })
    const back = stepBack(history, { path: 'c.ts', pos: 5 })
    expect(back?.to).toEqual({ path: 'b.ts', pos: 20 })
    const again = stepBack(back!.history, { path: 'b.ts', pos: 20 })
    expect(again?.to).toEqual({ path: 'a.ts', pos: 10 })
    expect(stepBack(again!.history, { path: 'a.ts', pos: 10 })).toBeNull()
    const forward = stepForward(again!.history, { path: 'a.ts', pos: 10 })
    expect(forward?.to).toEqual({ path: 'b.ts', pos: 20 })
  })

  it('drops Forward on a new jump and does not stack the same place twice', () => {
    let history = recordJump(EMPTY_HISTORY, { path: 'a.ts', pos: 1 })
    history = stepBack(history, { path: 'b.ts', pos: 2 })!.history
    expect(history.forward).toHaveLength(1)
    history = recordJump(history, { path: 'c.ts', pos: 3 })
    expect(history.forward).toEqual([])
    expect(recordJump(history, { path: 'c.ts', pos: 3 }).back).toEqual(history.back)
  })

  it('does not change the history it was given', () => {
    const history = recordJump(EMPTY_HISTORY, { path: 'a.ts', pos: 1 })
    const snapshot = JSON.stringify(history)
    stepBack(history, { path: 'b.ts', pos: 2 })
    recordJump(history, { path: 'z.ts', pos: 9 })
    expect(JSON.stringify(history)).toBe(snapshot)
  })

  it('forgets files that were closed', () => {
    const history = recordJump(recordJump(EMPTY_HISTORY, { path: 'a.ts', pos: 1 }), { path: 'b.ts', pos: 2 })
    expect(forgetPath(history, 'a.ts').back).toEqual([{ path: 'b.ts', pos: 2 }])
  })
})

describe('navigation outcomes', () => {
  it('jumps on one exact definition and says nothing about the engine', () => {
    expect(planNavigation('definition', 'X', exact([hit('a.ts', 3)]))).toEqual({ kind: 'jump', hit: hit('a.ts', 3), note: null })
  })

  it('peeks several results and labels by-name answers', () => {
    const plan = planNavigation('implementation', 'X', byName([hit('a.ts', 1), hit('b.ts', 2), hit('c.ts', 3)]))
    expect(plan).toMatchObject({ kind: 'peek', note: 'Best match by name · 2 other matches' })
    expect(planNavigation('implementation', 'X', exact([hit('a.ts', 1), hit('b.ts', 2)]))).toMatchObject({ kind: 'peek', note: '2 implementations' })
  })

  it('always peeks references, even one', () => {
    expect(planNavigation('references', 'X', exact([hit('a.ts', 1)]))).toMatchObject({ kind: 'peek', note: '1 reference' })
  })

  it('words the empty and outside answers', () => {
    expect(planNavigation('definition', 'matchMedia', exact([]))).toEqual({ kind: 'message', text: 'No definition found for matchMedia.', outside: false })
    expect(planNavigation('definition', 'useState', exact([], true))).toEqual({ kind: 'message', text: 'useState is defined outside this project.', outside: true })
    expect(planNavigation('references', 'X', { ok: false, error: 'boom' })).toMatchObject({ kind: 'message', text: 'No references found for X.' })
  })

  it('says how many other matches by name', () => {
    expect(byNameNote(1)).toBe('Best match by name')
    expect(byNameNote(2)).toBe('Best match by name · 1 other match')
  })

  it('writes the status bar line for each language server state', () => {
    const status = (state: CodeNavStatus['state'], engine: CodeNavStatus['engine'] = 'typescript', canInstall = false): CodeNavStatus => ({ engine, state, canInstall })
    expect(engineLine(status('ready')).text).toBe('TypeScript ready')
    expect(engineLine(status('starting')).text).toBe('TypeScript starting. Results are by name until it is ready.')
    expect(engineLine(status('stopped'))).toEqual({ text: 'TypeScript stopped. Results are by name.', action: 'restart', actionLabel: 'Restart' })
    expect(engineLine(status('missing', 'csharp', true))).toMatchObject({ text: 'C# by name', action: 'install' })
    expect(engineLine(status('missing', 'csharp', false)).action).toBeNull()
    expect(engineLine(status('none', 'name')).text).toBe('')
    expect(engineLine(null).text).toBe('')
  })
})

describe('relocating a hit in an edited buffer', () => {
  const buffer = ['// new header', '// another', 'export interface ThemeStore {', '  read(): Theme', '}'].join('\n')

  it('keeps the spot when the line is still there', () => {
    expect(relocateHit(buffer, { line: 3, column: 18, preview: 'export interface ThemeStore {' }, 'ThemeStore')).toEqual({ line: 3, column: 18 })
  })

  it('finds the line again after edits moved it', () => {
    expect(relocateHit(buffer, { line: 1, column: 18, preview: 'export interface ThemeStore {' }, 'ThemeStore')).toEqual({ line: 3, column: 18 })
  })

  it('falls back to the symbol when the line text changed', () => {
    expect(relocateHit(buffer, { line: 1, column: 1, preview: 'interface ThemeStore {' }, 'ThemeStore')).toEqual({ line: 3, column: 18 })
  })

  it('does not match a longer name that contains the symbol', () => {
    const text = 'class LocalThemeStore {}\nuse(ThemeStore)'
    expect(relocateHit(text, { line: 1, column: 1, preview: 'gone' }, 'ThemeStore')).toEqual({ line: 2, column: 5 })
  })

  it('keeps the reported spot, clamped, when nothing matches', () => {
    expect(relocateHit('a\nb', { line: 99, column: 4, preview: 'zzz' }, 'Nope')).toEqual({ line: 2, column: 4 })
  })
})

describe('editorconfig indentation', () => {
  it('maps spaces and tabs to an indent unit and tab size', () => {
    expect(indentSettings({ indentStyle: 'space', indentSize: 2 })).toEqual({ unit: '  ', tabSize: 2 })
    expect(indentSettings({ indentStyle: 'tab', tabWidth: 8 })).toEqual({ unit: '\t', tabSize: 8 })
    expect(indentSettings({ indentStyle: 'tab' })).toEqual({ unit: '\t', tabSize: 4 })
    expect(indentSettings({ indentSize: 3 })).toEqual({ unit: '   ', tabSize: 3 })
    expect(indentSettings({ indentStyle: 'space', indentSize: 4, tabWidth: 8 })).toEqual({ unit: '    ', tabSize: 8 })
  })

  it('says nothing when the file sets no indentation or an absurd one', () => {
    expect(indentSettings({})).toBeNull()
    expect(indentSettings({ endOfLine: 'lf' })).toBeNull()
    expect(indentSettings(null)).toBeNull()
    expect(indentSettings({ indentSize: 0 })).toBeNull()
    expect(indentSettings({ indentStyle: 'space', indentSize: 400 })).toEqual({ unit: '    ', tabSize: 4 })
  })
})

describe('removed line count of a deleted file', () => {
  it('does not count the empty piece after a trailing newline', () => {
    expect(lineCount('a\nb\n')).toBe(2)
    expect(lineCount('a\nb')).toBe(2)
    expect(lineCount('a\n')).toBe(1)
    expect(lineCount('')).toBe(0)
    expect(lineCount(null)).toBe(0)
  })
})

describe('search on Enter', () => {
  it('skips the same query when typing but runs it again when forced', () => {
    expect(shouldSearch('k', 'k', false)).toBe(false)
    expect(shouldSearch('k', 'k', true)).toBe(true)
    expect(shouldSearch('k', 'other', false)).toBe(true)
  })
})

describe('go to inputs', () => {
  const item = (name: string, line: number, depth: number): OutlineItem => ({ name, kind: depth ? 'function' : 'class', from: 0, line, depth })
  const items = [item('Store', 1, 0), item('load', 2, 1), item('save', 5, 1), item('helper', 9, 0)]

  it('reads a line, with an optional column, inside the file', () => {
    expect(parseLineInput('12', 40)).toEqual({ line: 12, column: null })
    expect(parseLineInput(' 12:5 ', 40)).toEqual({ line: 12, column: 5 })
    expect(parseLineInput('0', 40)).toBeNull()
    expect(parseLineInput('41', 40)).toBeNull()
    expect(parseLineInput('abc', 40)).toBeNull()
  })

  it('filters symbols by name', () => {
    expect(filterOutline(items, 'sa').map((entry) => entry.name)).toEqual(['save'])
    expect(filterOutline(items, '')).toHaveLength(4)
  })

  it('names the class and method the cursor is in', () => {
    expect(enclosingSymbols(items, 6).map((entry) => entry.name)).toEqual(['Store', 'save'])
    expect(enclosingSymbols(items, 10).map((entry) => entry.name)).toEqual(['helper'])
    expect(enclosingSymbols(items, 1).map((entry) => entry.name)).toEqual(['Store'])
  })
})
