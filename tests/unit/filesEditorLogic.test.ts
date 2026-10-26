import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { diffStat } from '../../src/renderer/files/diffStat'
import { outlineOf } from '../../src/renderer/files/outline'

const names = (doc: string, language: ReturnType<typeof javascript>): Array<[string, string, number]> =>
  outlineOf(EditorState.create({ doc, extensions: [language] })).map((item) => [item.name, item.kind, item.depth])

describe('diffStat', () => {
  it('counts the lines added and removed against the base', () => {
    expect(diffStat('a\nb\nc\n', 'a\nb\nc\n')).toEqual({ added: 0, removed: 0 })
    expect(diffStat('a\nb\nc\n', 'a\nB\nc\nd\ne\n')).toEqual({ added: 3, removed: 1 })
    expect(diffStat(null, 'x\ny\n')).toEqual({ added: 2, removed: 0 })
    expect(diffStat('x\ny\n', '')).toEqual({ added: 0, removed: 2 })
  })
})

describe('outlineOf', () => {
  it('lists classes with their methods, functions, types and arrow-function constants', () => {
    const doc = [
      'export class Store {',
      '  load() {}',
      '  save() {}',
      '}',
      'export function build() {}',
      'const total = 5',
      'export const run = async () => {}',
      'interface Opts {}',
      'type Id = string'
    ].join('\n')
    expect(names(doc, javascript({ typescript: true }))).toEqual([
      ['Store', 'class', 0],
      ['load', 'function', 1],
      ['save', 'function', 1],
      ['build', 'function', 0],
      ['run', 'function', 0],
      ['Opts', 'type', 0],
      ['Id', 'type', 0]
    ])
  })

  it('lists python classes and functions', () => {
    const doc = 'class A:\n    def m(self):\n        pass\n\ndef top():\n    pass\n'
    expect(names(doc, python() as never).map((row) => row[0])).toEqual(['A', 'm', 'top'])
  })

  it('lists markdown headings by level', () => {
    const rows = names('# Title\n\ntext\n\n## Part\n', markdown() as never)
    expect(rows).toEqual([['Title', 'heading', 0], ['Part', 'heading', 1]])
  })
})
