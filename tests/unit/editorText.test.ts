import { EditorState, type Transaction } from '@codemirror/state'
import { history, isolateHistory, redo, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { eolFor, resetEol, textForSave } from '../../src/renderer/files/editorText'
import { saveWithRules } from '../../src/main/editorConfig'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeProjectFile } from '../../src/main/gitWorkspace'

describe('editor line endings', () => {
  it('keeps the surviving LF when the first duplicate line is deleted', () => {
    const original = 'a\r\na\nb'
    const state = EditorState.create({ doc: original, extensions: eolFor(original) })
    const edited = state.update({ changes: { from: 0, to: state.doc.line(2).from } }).state
    expect(textForSave(edited)).toBe('a\nb')
  })

  it.each(['a\r\nb\nc\r\n', 'a\nb\r\nc\r', 'a\rb\rc\r'])('shows every mixed or CR line separately: %j', text => {
    const state = EditorState.create({ doc: text, extensions: eolFor(text) })
    expect(state.doc.lines).toBe(4)
    expect(state.doc.line(2).text).toBe('b')
    expect(state.doc.line(3).text).toBe('c')
    expect(textForSave(state)).toBe(text)
  })

  it('retains pure CRLF serialization', () => {
    const text = 'a\r\nb\r\n'
    const state = EditorState.create({ doc: text, extensions: eolFor(text) })
    expect(textForSave(state)).toBe(text)
    const edited = state.update({ changes: { from: 0, insert: 'new\n' } }).state
    expect(textForSave(edited)).toBe('new\r\na\r\nb\r\n')
  })

  it('resets separators when reloaded text has identical normalized content', () => {
    const state = EditorState.create({ doc: 'a\r\nb\n', extensions: eolFor('a\r\nb\n') })
    const reloaded = state.update({ effects: resetEol('a\nb\r\n') }).state
    expect(reloaded.doc).toBe(state.doc)
    expect(textForSave(reloaded)).toBe('a\nb\r\n')
    const newText = 'new\ra\nb\r\n'
    const replaced = reloaded.update({ changes: { from: 0, to: reloaded.doc.length, insert: newText }, effects: resetEol(newText) }).state
    expect(textForSave(replaced)).toBe(newText)
  })

  it('restores exact separators through separate and grouped undo/redo transactions', () => {
    const original = 'a\r\na\nb\r'
    let state = EditorState.create({ doc: original, extensions: [eolFor(original), history()] })
    const target = { get state() { return state }, dispatch(transaction: Transaction) { state = transaction.state } }
    state = state.update({ changes: { from: 0, to: state.doc.line(2).from }, annotations: isolateHistory.of('full') }).state
    expect(textForSave(state)).toBe('a\nb\r')
    state = state.update({ changes: { from: 0, insert: 'new\n' }, annotations: isolateHistory.of('full') }).state
    expect(textForSave(state)).toBe('new\r\na\nb\r')
    expect(undo(target)).toBe(true)
    expect(textForSave(state)).toBe('a\nb\r')
    expect(undo(target)).toBe(true)
    expect(textForSave(state)).toBe(original)
    expect(redo(target)).toBe(true)
    expect(textForSave(state)).toBe('a\nb\r')
    expect(redo(target)).toBe(true)
    expect(textForSave(state)).toBe('new\r\na\nb\r')

    state = EditorState.create({ doc: original, extensions: [eolFor(original), history()] })
    state = state.update({ changes: { from: 0, insert: 'x\n' }, userEvent: 'input.type' }).state
    state = state.update({ changes: { from: 2, insert: 'y\n' }, userEvent: 'input.type' }).state
    expect(undo(target)).toBe(true)
    expect(textForSave(state)).toBe(original)
    expect(redo(target)).toBe(true)
    expect(textForSave(state)).toBe('x\r\ny\r\na\r\na\nb\r')
  })

  it('keeps a 10,000-line replace-all and repeated serialization responsive', () => {
    const original = Array.from({ length: 10_000 }, (_, index) => `const a${index} = ${index}${index % 2 ? '\r\n' : '\n'}`).join('')
    let state = EditorState.create({ doc: original, extensions: eolFor(original) })
    const changes = Array.from({ length: 10_000 }, (_, index) => {
      const from = state.doc.line(index + 1).from
      return { from, to: from + 5, insert: 'let' }
    })
    const started = performance.now()
    state = state.update({ changes }).state
    for (let pass = 0; pass < 3; pass += 1) expect(textForSave(state)).toBe(original.replace(/const/g, 'let'))
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('preserves unchanged mixed separators through edits, inserted lines, deletes and restored text', () => {
    const original = 'first\r\nsecond\nthird\r\nfourth\r'
    let state = EditorState.create({ doc: original, extensions: eolFor(original) })
    const initial = state
    state = state.update({ changes: { from: 0, to: 5, insert: 'FIRST' } }).state
    expect(saveWithRules(textForSave(state), original, {})).toBe('FIRST\r\nsecond\nthird\r\nfourth\r')
    state = state.update({ changes: { from: 0, insert: 'new\n' } }).state
    expect(textForSave(state)).toBe('new\r\nFIRST\r\nsecond\nthird\r\nfourth\r')
    const third = state.doc.line(4)
    state = state.update({ changes: { from: third.from, to: third.to + 1 } }).state
    expect(textForSave(state)).toBe('new\r\nFIRST\r\nsecond\nfourth\r')
    expect(textForSave(initial)).toBe(original)
  })

  it('saves a mixed editor buffer through the normal main-process path without changing untouched separators', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-editor-eol-'))
    try {
      const path = join(root, 'mixed.ts')
      const original = 'const first = 1\r\nconst second = 2\nconst third = 3\r\n'
      writeFileSync(path, original)
      const state = EditorState.create({ doc: original, extensions: eolFor(original) })
      const edited = state.update({ changes: { from: state.doc.line(2).to - 1, to: state.doc.line(2).to, insert: '4' } }).state
      expect(edited.doc.lines).toBe(4)
      expect(await writeProjectFile(root, 'mixed.ts', textForSave(edited), statSync(path).mtimeMs)).toMatchObject({ ok: true })
      expect(readFileSync(path, 'utf8')).toBe('const first = 1\r\nconst second = 4\nconst third = 3\r\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
