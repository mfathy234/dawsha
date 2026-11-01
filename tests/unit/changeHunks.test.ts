import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'
import { afterAll, describe, expect, it } from 'vitest'
import { buildHunks, changePreview, changesOf, hunkAtLine, lineSpan, textLines } from '../../src/renderer/files/changeHunks'
import { diffHunks } from '../../src/main/gitHunks'

const root = mkdtempSync(join(tmpdir(), 'dawsha-hunks-'))
const git = (...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd: root, encoding: 'utf8' })
git('init', '-q', '-b', 'main')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const numbered = (count: number): string => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n') + '\n'

function mine(base: string, cur: string, eol = '\n') {
  const a = textLines(base, eol)
  const b = textLines(cur, eol)
  const baseDoc = Text.of(base.split(eol))
  const curDoc = Text.of(cur.split(eol))
  const changes = changesOf(Chunk.build(baseDoc, curDoc), baseDoc, curDoc)
  return buildHunks(a.lines, b.lines, changes, eol)
}

function theirs(base: string, cur: string): string[] {
  writeFileSync(join(root, 'f.txt'), base)
  git('add', 'f.txt')
  git('commit', '-q', '-m', 'base', '--allow-empty')
  writeFileSync(join(root, 'f.txt'), cur)
  const out = git('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', 'HEAD', '--', 'f.txt')
  git('reset', '-q', '--hard')
  return diffHunks(out).map((hunk) => hunk.text)
}

const edit = (text: string, changes: Array<[number, number, string[]]>): string => {
  const lines = text.split('\n')
  for (const [at, remove, insert] of [...changes].sort((x, y) => y[0] - x[0])) lines.splice(at, remove, ...insert)
  return lines.join('\n')
}

describe('hunks match git diff byte for byte', () => {
  const cases: Array<[string, string, string]> = [
    ['one changed line in the middle', numbered(30), edit(numbered(30), [[14, 1, ['changed']]])],
    ['an added line', numbered(30), edit(numbered(30), [[10, 0, ['added']]])],
    ['a removed line', numbered(30), edit(numbered(30), [[10, 1, []]])],
    ['two far changes make two hunks', numbered(40), edit(numbered(40), [[5, 1, ['a']], [30, 1, ['b']]])],
    ['changes six lines apart share a hunk', numbered(40), edit(numbered(40), [[10, 1, ['a']], [17, 1, ['b']]])],
    ['changes seven lines apart split', numbered(40), edit(numbered(40), [[10, 1, ['a']], [18, 1, ['b']]])],
    ['a change on the first line', numbered(20), edit(numbered(20), [[0, 1, ['top']]])],
    ['a change on the last line', numbered(20), edit(numbered(20), [[19, 1, ['bottom']]])],
    ['text after the file end', numbered(10), numbered(10) + 'tail\n'],
    ['a function name carried into the header', 'function one() {\n  a\n  b\n  c\n  d\n  e\n  f\n  g\n  h\n}\n', 'function one() {\n  a\n  b\n  c\n  d\n  e\n  f\n  g\n  HH\n}\n']
  ]
  for (const [name, base, cur] of cases) {
    it(name, () => {
      const wanted = theirs(base, cur)
      expect(wanted.length).toBeGreaterThan(0)
      expect(mine(base, cur).map((hunk) => hunk.text)).toEqual(wanted)
    })
  }
})

describe('the hunk numbers', () => {
  it('counts added and removed lines and names the span', () => {
    const [hunk] = mine(numbered(30), edit(numbered(30), [[14, 2, ['x', 'y', 'z']]]))
    expect(hunk.added).toBe(3)
    expect(hunk.removed).toBe(2)
    expect(lineSpan(hunk)).toBe('lines 15 to 17')
    expect(hunkAtLine([hunk], 16)).toBe(hunk)
    expect(hunkAtLine([hunk], 3)).toBeNull()
  })

  it('offers nothing when the changes do not rebuild the file', () => {
    expect(buildHunks(['a', 'b'], ['a', 'c'], [{ baseStart: 0, baseEnd: 1, curStart: 0, curEnd: 1 }], '\n')).toEqual([])
  })

  it('keeps carriage returns in the patch lines', () => {
    const [hunk] = mine('a\r\nb\r\nc\r\n', 'a\r\nB\r\nc\r\n', '\r\n')
    expect(hunk.text).toContain('-b\r\n+B\r\n')
  })
})

describe('the confirmation preview', () => {
  it('shows the first changed lines and counts the rest', () => {
    const [hunk] = mine(numbered(30), edit(numbered(30), [[14, 6, ['a', 'b', 'c', 'd', 'e', 'f']]]))
    const lines = changePreview(hunk).split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('-line 15')
    expect(lines[4]).toBe('and 8 more changed lines')
  })
})
