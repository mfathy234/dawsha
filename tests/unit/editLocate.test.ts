import { describe, expect, it } from 'vitest'
import { locateEdits, type LocatableEdit } from '../../src/shared/editLocate'
import { changeFromEdit, changeFromPatch, CHANGE_MAX_CHARS } from '../../src/shared/editChange'

const edit = (at: number, ...pieces: string[]): LocatableEdit => ({ at, change: { pieces: pieces.map((text) => ({ text })) } })
const linesOf = (owners: ReadonlyMap<number, number>, index: number): number[] => [...owners].filter(([, owner]) => owner === index).map(([line]) => line).sort((a, b) => a - b)

describe('locateEdits', () => {
  const file = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n')

  it('finds the lines a multi-line edit wrote', () => {
    const result = locateEdits(file, [edit(1, 'three\nfour')])
    expect(linesOf(result.owners, 0)).toEqual([3, 4])
    expect(result.estimate.size).toBe(0)
  })
  it('claims the whole line when the edit changed part of it', () => {
    expect(linesOf(locateEdits('const total = a + b\nreturn total', [edit(1, 'a + b')]).owners, 0)).toEqual([1])
  })
  it('does not claim the newline around a block', () => {
    expect(linesOf(locateEdits(file, [edit(1, '\nthree\n')]).owners, 0)).toEqual([3])
    expect(linesOf(locateEdits(file, [edit(1, 'two\n')]).owners, 0)).toEqual([2])
  })
  it('finds text in a CRLF file with the lines the editor shows', () => {
    const crlf = 'one\r\ntwo\r\nthree\r\nfour\r\n'
    expect(linesOf(locateEdits(crlf, [edit(1, 'two\nthree')]).owners, 0)).toEqual([2, 3])
    expect(linesOf(locateEdits(file, [edit(1, 'two\r\nthree')]).owners, 0)).toEqual([2, 3])
  })
  it('gives each edit its own lines and keeps the later edit where they overlap', () => {
    const result = locateEdits(file, [edit(1, 'two\nthree'), edit(2, 'three\nfour')])
    expect(linesOf(result.owners, 1)).toEqual([3, 4])
    expect(linesOf(result.owners, 0)).toEqual([2])
  })
  it('treats an edit whose text was overwritten later as overwritten, not as unknown', () => {
    const result = locateEdits('alpha\nbeta', [edit(1, 'draft line'), edit(2, 'beta')])
    expect(linesOf(result.owners, 1)).toEqual([2])
    expect(result.owners.size).toBe(1)
    expect(result.estimate.size).toBe(0)
  })
  it('leaves an ambiguous duplicate to the estimate', () => {
    const result = locateEdits('x = 1\nfoo()\ny = 2\nfoo()', [edit(1, 'foo()')])
    expect(result.owners.size).toBe(0)
    expect([...result.estimate.keys()]).toEqual([0])
  })
  it('uses a duplicate that a later edit already explains', () => {
    const result = locateEdits('x = 1\nfoo()\ny = 2\nfoo()', [edit(1, 'foo()'), edit(2, 'y = 2\nfoo()')])
    expect(linesOf(result.owners, 1)).toEqual([3, 4])
    expect(linesOf(result.owners, 0)).toEqual([2])
  })
  it('claims every occurrence for a replace-all edit', () => {
    const result = locateEdits('foo()\nbar\nfoo()', [{ at: 1, change: { pieces: [{ text: 'foo()', all: true }] } }])
    expect(linesOf(result.owners, 0)).toEqual([1, 3])
  })
  it('sends edits without text to the estimate, and treats one that wrote nothing as done', () => {
    const result = locateEdits(file, [{ at: 1 }, edit(2, 'two', 'ghost'), { at: 3, change: { pieces: [] } }])
    expect([...result.estimate.keys()]).toEqual([0])
    expect(linesOf(result.owners, 1)).toEqual([2])
  })
  it('places lines of a written file in order, also when a person changed a line afterwards', () => {
    const written = 'a1\na2\na3\na4\na5'
    const current = 'a1\na2\nA3 changed\na4\na5'
    const result = locateEdits(current, [{ at: 1, change: { pieces: [{ text: written }], whole: true } }])
    expect(linesOf(result.owners, 0)).toEqual([1, 2, 4, 5])
  })
  it('does not let a written file claim the lines a later edit wrote', () => {
    const result = locateEdits('a1\nnew\na3', [{ at: 1, change: { pieces: [{ text: 'a1\na2\na3' }], whole: true } }, edit(2, 'new')])
    expect(linesOf(result.owners, 1)).toEqual([2])
    expect(linesOf(result.owners, 0)).toEqual([1, 3])
  })
  it('ignores edits made before the file was deleted and written again', () => {
    const edits: LocatableEdit[] = [edit(1, 'one', 'two'), { at: 2, change: { pieces: [], deleted: true } }, { at: 3, change: { pieces: [{ text: 'fresh\nfile' }], whole: true } }]
    const result = locateEdits('fresh\nfile', edits)
    expect(linesOf(result.owners, 2)).toEqual([1, 2])
    expect(result.owners.size).toBe(2)
    expect(result.estimate.size).toBe(0)
  })
  it('places nothing in a file that is gone', () => {
    const result = locateEdits('', [edit(1, 'one'), { at: 2, change: { pieces: [], deleted: true } }])
    expect(result.owners.size).toBe(0)
    expect(result.estimate.size).toBe(0)
  })
  it('uses patch context to tell identical added lines apart', () => {
    const current = ['function a() {', '  return 1', '}', 'function b() {', '  return 1', '}'].join('\n')
    const change = { pieces: [{ text: '  return 1', before: 'function b() {', after: '}' }] }
    expect(linesOf(locateEdits(current, [{ at: 1, change }]).owners, 0)).toEqual([5])
  })
  it('falls back to the text alone when the context changed afterwards', () => {
    const change = { pieces: [{ text: 'unique line', before: 'old context', after: 'other' }] }
    expect(linesOf(locateEdits('a\nunique line\nb', [{ at: 1, change }]).owners, 0)).toEqual([2])
  })
})

describe('changeFromEdit', () => {
  it('reads an edit, a multi-edit and a write', () => {
    expect(changeFromEdit('edit', { file_path: 'a', old_string: 'x', new_string: 'y\nz' })).toEqual({ pieces: [{ text: 'y\nz' }] })
    expect(changeFromEdit('multiedit', { file_path: 'a', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: '' }, { new_string: 'd' }] })).toEqual({ pieces: [{ text: 'b' }, { text: 'd' }] })
    expect(changeFromEdit('write', { file_path: 'a', content: 'one\ntwo' })).toEqual({ pieces: [{ text: 'one\ntwo' }], whole: true })
    expect(changeFromEdit('edit', { file_path: 'a', old_string: 'x', new_string: 'y', replace_all: true })).toEqual({ pieces: [{ text: 'y', all: true }] })
  })
  it('gives nothing for a pure deletion or text too large to keep', () => {
    expect(changeFromEdit('edit', { file_path: 'a', old_string: 'x', new_string: '' })).toEqual({ pieces: [] })
    expect(changeFromEdit('write', { file_path: 'a', content: 'x'.repeat(CHANGE_MAX_CHARS + 1) })).toBeUndefined()
  })
})

describe('changeFromPatch', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/a.ts',
    '@@ function b',
    ' function b() {',
    '-  return 1',
    '+  return 2',
    '+  // note',
    ' }',
    '@@',
    ' tail',
    '+extra',
    '*** Add File: src/new.ts',
    '+first',
    '+second',
    '*** Delete File: src/old.ts',
    '*** End Patch'
  ].join('\n')
  it('gives one change per file: added runs with their context, a whole new file, a deletion', () => {
    const changes = changeFromPatch(patch)
    expect(changes).toHaveLength(3)
    expect(changes[0]).toEqual({ pieces: [{ text: '  return 2\n  // note', before: 'function b() {', after: '}' }, { text: 'extra', before: 'tail', after: '' }] })
    expect(changes[1]).toEqual({ pieces: [{ text: 'first\nsecond' }], whole: true })
    expect(changes[2]).toEqual({ pieces: [], deleted: true })
  })
})
