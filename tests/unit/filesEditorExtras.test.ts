import { javascript } from '@codemirror/lang-javascript'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { csharpOutline } from '../../src/renderer/files/csharpOutline'
import { markRange, marksForFile } from '../../src/renderer/files/problemMarks'
import { outlineOf, outlineResult } from '../../src/renderer/files/outline'
import { identifierAt } from '../../src/renderer/files/symbolAt'

const CS = [
  'namespace Acme.Stock;',
  '',
  'public interface IStockLedger',
  '{',
  '    Task<int> BalanceAsync(Guid serviceId, CancellationToken token);',
  '}',
  '',
  'public sealed class StockService(IStockLedger ledger)',
  '{',
  '    public int Total { get; set; }',
  '',
  '    public Task<int> BalanceOfAsync(Guid serviceId, CancellationToken token) =>',
  '        ledger.BalanceAsync(serviceId, token);',
  '',
  '    private void Reset()',
  '    {',
  '        var rows = Load(1);',
  '        if (rows > 0) Log(rows);',
  '    }',
  '}'
].join('\n')

describe('csharpOutline', () => {
  it('lists types and their members, and nothing from inside a method body', () => {
    expect(csharpOutline(CS).map((item) => [item.name, item.depth, item.line])).toEqual([
      ['IStockLedger', 0, 3],
      ['BalanceAsync', 1, 5],
      ['StockService', 0, 8],
      ['Total', 1, 10],
      ['BalanceOfAsync', 1, 12],
      ['Reset', 1, 15]
    ])
  })

  it('gives each item the offset where its line starts, after the indent', () => {
    const item = csharpOutline(CS).find((entry) => entry.name === 'Reset')!
    expect(CS.slice(item.from, item.from + 'private void Reset'.length)).toBe('private void Reset')
  })

  it('handles a block namespace and nested types', () => {
    const text = 'namespace A\n{\n    public class Outer\n    {\n        public enum Kind { One, Two }\n        void Go() { }\n    }\n}\n'
    expect(csharpOutline(text).map((item) => [item.name, item.depth])).toEqual([['Outer', 0], ['Kind', 1], ['Go', 1]])
  })
})

describe('outline of a big file', () => {
  const big = Array.from({ length: 60_000 }, (_, i) => `export function f${i}(a: number): number { return a + ${i} }`).join('\n')

  it('still lists what is parsed when the quick budget runs out, and says it is incomplete', () => {
    const state = EditorState.create({ doc: big, extensions: [javascript({ typescript: true })] })
    const result = outlineResult(state)
    expect(result.complete).toBe(false)
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items[0].name).toBe('f0')
  })

  it('lists everything once the parse has finished', () => {
    const state = EditorState.create({ doc: big, extensions: [javascript({ typescript: true })] })
    expect(ensureSyntaxTree(state, state.doc.length, 20_000)).not.toBeNull()
    const result = outlineResult(state)
    expect(result.complete).toBe(true)
    expect(outlineOf(state).length).toBeGreaterThan(100)
  })
})

describe('marks from a run', () => {
  const problem = (path: string | null, line: number, column?: number, code?: string) => ({ path, line, column, message: 'Bad call', severity: 'error' as const, source: 'typescript', code })

  it('keeps the problems of one file, using repo paths', () => {
    const problems = [problem('src/a.ts', 3, 5, 'TS2554'), problem('src/b.ts', 1), problem(null, 2)]
    expect(marksForFile(problems, 'web', 'web/src/a.ts')).toEqual([{ severity: 'error', line: 3, column: 5, message: 'Bad call (TS2554)', source: 'typescript' }])
    expect(marksForFile(problems, '', 'src/b.ts')).toHaveLength(1)
  })

  it('underlines the word at the column, or the line when there is none', () => {
    const doc = Text.of(['  const value = compute(1)', 'x'])
    expect(markRange(doc, 1, 17)).toEqual({ from: 16, to: 23 })
    expect(markRange(doc, 1, undefined)).toEqual({ from: 2, to: 26 })
    expect(markRange(doc, 9, 1)).toBeNull()
    expect(markRange(Text.of(['', 'y']), 1, 4)).toEqual({ from: 0, to: 0 })
  })
})

describe('identifierAt', () => {
  const ts = (doc: string) => EditorState.create({ doc, extensions: [javascript({ typescript: true })] })

  it('finds a name from the syntax tree, at either edge', () => {
    const state = ts('const store: ThemeStore = make()')
    expect(identifierAt(state, 14)).toEqual({ name: 'ThemeStore', from: 13, to: 23 })
    expect(identifierAt(state, 23)?.name).toBe('ThemeStore')
    expect(identifierAt(state, 6)?.name).toBe('store')
  })

  it('falls back to a word where there is no syntax tree', () => {
    const state = EditorState.create({ doc: 'public sealed class StockService(IStockLedger ledger)' })
    expect(identifierAt(state, 25)).toEqual({ name: 'StockService', from: 20, to: 32 })
  })

  it('gives nothing inside comments, strings or on a blank spot', () => {
    const state = ts('// say hello\nconst s = "hello world"\n\n')
    expect(identifierAt(state, 6)).toBeNull()
    expect(identifierAt(state, 26)).toBeNull()
    expect(identifierAt(state, state.doc.length)).toBeNull()
  })
})
