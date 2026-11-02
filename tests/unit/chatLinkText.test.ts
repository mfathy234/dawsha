import { describe, expect, it } from 'vitest'
import { candidatePaths, splitByMatches, wholePath } from '../../src/shared/chatLinkText'
import { findFilePaths } from '../../src/shared/filePaths'
import { lineOf, toolShape } from '../../src/main/chatLog/toolShape'

describe('splitByMatches', () => {
  const text = 'Edit src/app.ts:12 and notes.md, not foo.bar'

  it('turns only the accepted matches into references', () => {
    const segments = splitByMatches(text, findFilePaths(text), (match) => match.path !== 'foo.bar')
    expect(segments.filter((s) => s.kind === 'file').map((s) => s.kind === 'file' && s.ref)).toEqual([{ path: 'src/app.ts', line: 12 }, { path: 'notes.md' }])
    expect(segments.map((s) => s.text).join('')).toBe(text)
  })

  it('leaves the text alone when nothing is accepted', () => {
    expect(splitByMatches(text, findFilePaths(text), () => false)).toEqual([{ kind: 'text', text }])
  })
})

describe('wholePath', () => {
  it('accepts a code span that is only a path', () => {
    expect(wholePath('src/app.ts:7')).toMatchObject({ path: 'src/app.ts', line: 7 })
    expect(wholePath(' notes.md ')).toMatchObject({ path: 'notes.md' })
  })

  it('refuses a span with other words', () => {
    expect(wholePath('git add src/app.ts')).toBeNull()
    expect(wholePath('npm test')).toBeNull()
  })
})

describe('candidatePaths', () => {
  it('lists each path once', () => {
    expect(candidatePaths(findFilePaths('a/b.ts then a/b.ts:3 and c.md'))).toEqual(['a/b.ts', 'c.md'])
  })
})

describe('tool row file and line', () => {
  it('carries the file a Read touched and its offset', () => {
    expect(toolShape('Read', { file_path: 'src/a.ts', offset: 40 })).toMatchObject({ verb: 'Read', path: 'src/a.ts', line: 40 })
    expect(toolShape('Read', { file_path: 'src/a.ts' }).line).toBeUndefined()
  })

  it('carries the first file an edit touched', () => {
    expect(toolShape('Edit', { file_path: 'src/b.ts', old_string: 'a', new_string: 'b' }).path).toBe('src/b.ts')
  })

  it('has no file for a search', () => {
    expect(toolShape('Grep', { pattern: 'foo' }).path).toBeUndefined()
  })

  it('reads a line from a number or a string only when positive', () => {
    expect(lineOf(3)).toEqual({ line: 3 })
    expect(lineOf('12')).toEqual({ line: 12 })
    expect(lineOf(0)).toEqual({})
    expect(lineOf(undefined)).toEqual({})
  })
})
