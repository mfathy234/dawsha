import { describe, expect, it } from 'vitest'
import { addedLines, changedRanges, gapBefore, parseUnifiedDiff, splitRows } from '../../src/shared/diffView'

const DIFF = [
  'diff --git a/src/theme.tsx b/src/theme.tsx',
  'index 5eed43c..eddcd88 100644',
  '--- a/src/theme.tsx',
  '+++ b/src/theme.tsx',
  '@@ -1,7 +1,8 @@',
  "-import { createContext } from 'react'",
  "+import { createContext, useState } from 'react'",
  ' ',
  " export const ThemeContext = createContext('dark')",
  ' ',
  ' export function useTheme() {',
  "-  return 'dark'",
  "+  const [theme, setTheme] = useState('dark')",
  '+  return { theme, setTheme }',
  ' }',
  '@@ -20,3 +21,3 @@ export default App',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4'
].join('\n')

describe('parseUnifiedDiff', () => {
  it('numbers old and new lines per hunk', () => {
    const hunks = parseUnifiedDiff(DIFF)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldCount: 7, newStart: 1, newCount: 8 })
    expect(hunks[0].lines[0]).toEqual({ kind: 'del', oldNo: 1, newNo: null, text: "import { createContext } from 'react'" })
    expect(hunks[0].lines[1]).toEqual({ kind: 'add', oldNo: null, newNo: 1, text: "import { createContext, useState } from 'react'" })
    expect(hunks[0].lines.at(-1)).toEqual({ kind: 'context', oldNo: 7, newNo: 8, text: '}' })
    expect(hunks[1].lines[1]).toMatchObject({ kind: 'del', oldNo: 21 })
  })

  it('does not read the newline that ends the diff as an extra blank line', () => {
    const hunks = parseUnifiedDiff(`${DIFF}\n`)
    expect(hunks[1].lines).toHaveLength(4)
    const blank = parseUnifiedDiff('@@ -1,2 +1,2 @@\n-a\n+b\n\n')
    expect(blank[0].lines.map((line) => line.kind)).toEqual(['del', 'add', 'context'])
  })

  it('reads a whole new file and ignores the no-newline marker', () => {
    const hunks = parseUnifiedDiff('--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file')
    expect(hunks[0].lines.map((line) => [line.kind, line.newNo, line.text])).toEqual([['add', 1, 'one'], ['add', 2, 'two']])
  })
})

describe('splitRows', () => {
  it('pairs removed and added lines side by side and leaves the extra added line alone', () => {
    const rows = splitRows(parseUnifiedDiff(DIFF)[0])
    expect(rows[0].left).toMatchObject({ no: 1, kind: 'del' })
    expect(rows[0].right).toMatchObject({ no: 1, kind: 'add' })
    expect(rows[0].right?.marks).toEqual([[22, 32]])
    const extra = rows.find((row) => row.left === null)
    expect(extra?.right).toMatchObject({ no: 7, kind: 'add', text: '  return { theme, setTheme }' })
    expect(rows.at(-1)).toMatchObject({ left: { no: 7, kind: 'context' }, right: { no: 8, kind: 'context' } })
  })
})

describe('changedRanges', () => {
  it('marks the changed middle of two similar lines', () => {
    expect(changedRanges('const b = 2', 'const b = 3')).toEqual({ before: [[10, 11]], after: [[10, 11]] })
  })

  it('marks nothing when the lines share almost nothing', () => {
    expect(changedRanges('alpha', 'zzzzzzzz')).toEqual({ before: [], after: [] })
  })
})

describe('gaps and added lines', () => {
  it('finds the unchanged lines before and between hunks', () => {
    const hunks = parseUnifiedDiff(DIFF)
    expect(gapBefore(hunks, 0)).toBeNull()
    expect(gapBefore(hunks, 1)).toEqual({ from: 9, to: 20 })
  })

  it('lists the new-file lines that were added', () => {
    expect([...addedLines(DIFF)].sort((a, b) => a - b)).toEqual([1, 6, 7, 22])
  })
})
