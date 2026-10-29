import { describe, expect, it } from 'vitest'
import { groupProblems, parseProblems, problemsLabel, resolveProblemFile } from '../../src/shared/problems'

const lines = (...rows: string[]): string => rows.join('\n')

describe('parseProblems: bounded input', () => {
  it('skips oversized lines but keeps diagnostics up to 2000 characters', () => {
    const prefix = 'a.ts(1,1): error TS1: '
    const boundary = prefix + 'x'.repeat(2000 - prefix.length)
    expect(parseProblems(lines(`${boundary}x`, boundary))).toEqual([
      expect.objectContaining({ file: 'a.ts', message: 'x'.repeat(2000 - prefix.length) })
    ])
  })
  it('parses hostile whitespace and long lines in under 200 ms', () => {
    const output = lines(' '.repeat(200_000) + 'x', 'a.ts(1,1): error TS1: ' + 'x'.repeat(200_000),
      'a.js:1:1: x' + ' '.repeat(200_000), ' FAIL ' + ' '.repeat(200_000),
      ' '.repeat(1900) + 'x', 'a.ts(2,1): error TS1: kept')
    const start = performance.now()
    expect(parseProblems(output)).toEqual([expect.objectContaining({ line: 2, message: 'kept' })])
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('parseProblems: TypeScript', () => {
  it('reads the plain tsc format', () => {
    expect(parseProblems("src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.")).toEqual([
      { severity: 'error', file: 'src/a.ts', line: 12, column: 5, message: "Type 'string' is not assignable to type 'number'.", source: 'typescript', code: 'TS2322' }
    ])
  })
  it('reads the pretty tsc format and ignores its code frame', () => {
    const out = lines(
      "\u001b[96msrc/b.ts\u001b[0m:\u001b[93m3\u001b[0m:\u001b[93m7\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2304: \u001b[0mCannot find name 'x'.",
      '',
      '3 const y = x',
      '        ~',
      '',
      'Found 1 error.'
    )
    expect(parseProblems(out)).toEqual([{ severity: 'error', file: 'src/b.ts', line: 3, column: 7, message: "Cannot find name 'x'.", source: 'typescript', code: 'TS2304' }])
  })
  it('reads warnings and Windows paths', () => {
    expect(parseProblems('C:\\work\\app\\src\\c.ts(1,1): warning TS6133: unused.')).toEqual([
      { severity: 'warning', file: 'C:\\work\\app\\src\\c.ts', line: 1, column: 1, message: 'unused.', source: 'typescript', code: 'TS6133' }
    ])
  })
})

describe('parseProblems: ESLint', () => {
  it('reads the stylish format under its file heading', () => {
    const out = lines(
      '/repo/src/a.js',
      "  3:10  error    'x' is not defined        no-undef",
      '  8:1   warning  Unexpected console statement  no-console',
      '',
      '/repo/src/b.js',
      '  1:1  error  Parsing error: Unexpected token',
      '',
      '✖ 3 problems (2 errors, 1 warning)'
    )
    expect(parseProblems(out)).toEqual([
      { severity: 'error', file: '/repo/src/a.js', line: 3, column: 10, message: "'x' is not defined", source: 'eslint', code: 'no-undef' },
      { severity: 'warning', file: '/repo/src/a.js', line: 8, column: 1, message: 'Unexpected console statement', source: 'eslint', code: 'no-console' },
      { severity: 'error', file: '/repo/src/b.js', line: 1, column: 1, message: 'Parsing error: Unexpected token', source: 'eslint' }
    ])
  })
  it('reads the unix format', () => {
    expect(parseProblems("/repo/src/a.js:3:10: 'x' is not defined. [Error/no-undef]")).toEqual([
      { severity: 'error', file: '/repo/src/a.js', line: 3, column: 10, message: "'x' is not defined.", source: 'eslint', code: 'no-undef' }
    ])
    expect(parseProblems('src/a.js:8:1: Unexpected console statement. [Warning/no-console]')[0]).toMatchObject({ severity: 'warning', code: 'no-console' })
  })
})

describe('parseProblems: .NET', () => {
  it('reads MSBuild errors and drops the project suffix from the message', () => {
    const out = lines(
      '  Determining projects to restore...',
      "C:\\repo\\src\\Api\\Program.cs(14,13): error CS0103: The name 'foo' does not exist in the current context [C:\\repo\\src\\Api\\Api.csproj]",
      "src/Api/Util.cs(9,5): warning CS8618: Non-nullable property 'Name' must contain a non-null value [/repo/src/Api/Api.csproj::TargetFramework=net8.0]"
    )
    expect(parseProblems(out)).toEqual([
      { severity: 'error', file: 'C:\\repo\\src\\Api\\Program.cs', line: 14, column: 13, message: "The name 'foo' does not exist in the current context", source: 'dotnet', code: 'CS0103' },
      { severity: 'warning', file: 'src/Api/Util.cs', line: 9, column: 5, message: "Non-nullable property 'Name' must contain a non-null value", source: 'dotnet', code: 'CS8618' }
    ])
  })
  it('accepts a range and a line only', () => {
    expect(parseProblems('a.cs(4,2,4,9): error CS1002: ; expected')[0]).toMatchObject({ line: 4, column: 2 })
    expect(parseProblems('a.cs(4): error CS1002: ; expected')[0]).toMatchObject({ line: 4, column: undefined })
  })
  it('does not turn a bare MSBuild error without a file into a problem', () => {
    expect(parseProblems('MSBUILD : error MSB1009: Project file does not exist.')).toEqual([])
  })
})

describe('parseProblems: tests', () => {
  it('takes the first project frame of a Vitest failure', () => {
    const out = lines(
      ' FAIL  tests/unit/math.test.ts > math > adds',
      'AssertionError: expected 1 to be 2 // Object.is equality',
      '',
      ' ❯ tests/unit/math.test.ts:5:19',
      "      3|   it('adds', () => {",
      '      5|     expect(1).toBe(2)'
    )
    expect(parseProblems(out)).toEqual([
      { severity: 'error', file: 'tests/unit/math.test.ts', line: 5, column: 19, message: 'math > adds: AssertionError: expected 1 to be 2 // Object.is equality', source: 'test' }
    ])
  })
  it('skips frames in node_modules and node internals', () => {
    const out = lines(
      ' FAIL  tests/a.test.ts > a',
      'Error: boom',
      ' ❯ node_modules/vitest/dist/index.js:10:2',
      ' ❯ node:internal/process/task_queues:95:5',
      ' ❯ tests/a.test.ts:7:3'
    )
    expect(parseProblems(out)).toEqual([expect.objectContaining({ file: 'tests/a.test.ts', line: 7, column: 3, source: 'test' })])
  })
  it('honours the project filter so a frame outside the checkout is passed over', () => {
    const out = lines(' FAIL  t > x', 'Error: no', ' ❯ /elsewhere/lib.ts:1:1', ' ❯ /repo/tests/t.test.ts:2:2')
    expect(parseProblems(out, { accepts: (file) => file.startsWith('/repo/') })).toEqual([expect.objectContaining({ file: '/repo/tests/t.test.ts', line: 2 })])
  })
  it('reads a Jest failure and its at-frame', () => {
    const out = lines(
      '  ● math › adds',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
      '',
      '    Expected: 2',
      '    Received: 1',
      '',
      '      4 |   test("adds", () => {',
      '    > 5 |     expect(1).toBe(2)',
      '',
      '      at Object.<anonymous> (src/math.test.js:5:17)',
      '      at node_modules/jest-circus/build/run.js:100:5'
    )
    expect(parseProblems(out)).toEqual([
      { severity: 'error', file: 'src/math.test.js', line: 5, column: 17, message: 'math › adds: expect(received).toBe(expected) // Object.is equality', source: 'test' }
    ])
  })
  it('reads a frame with a file URL', () => {
    const out = lines(' FAIL  t > x', 'TypeError: bad', '    at file:///C:/repo/tests/t.test.ts:9:4')
    expect(parseProblems(out)[0]).toMatchObject({ file: 'file:///C:/repo/tests/t.test.ts', line: 9, column: 4 })
  })
  it('does not double up the same failure printed in a summary and in the details', () => {
    const body = lines(' FAIL  t.test.ts > x', 'Error: no', ' ❯ t.test.ts:3:1')
    expect(parseProblems(`${body}\n${body}`)).toHaveLength(1)
  })
})

describe('parseProblems: generic and noise', () => {
  it('reads path:line:col lines, with a severity word or not', () => {
    expect(parseProblems('./main.go:12:5: undefined: x')).toEqual([{ severity: 'error', file: './main.go', line: 12, column: 5, message: 'undefined: x', source: 'generic' }])
    expect(parseProblems('src/lib.rs:3:1: warning: unused import')[0]).toMatchObject({ severity: 'warning', message: 'unused import' })
    expect(parseProblems('src/x.py:40: error: Incompatible types')[0]).toMatchObject({ severity: 'error', line: 40, column: undefined })
  })
  it('ignores lines that only look like paths', () => {
    expect(parseProblems(lines('http://localhost:3000/x', 'listening on 127.0.0.1:8080', '    at run (src/a.ts:1:2)', 'src/a.ts:12'))).toEqual([])
  })
  it('handles empty output, ansi and carriage returns', () => {
    expect(parseProblems('')).toEqual([])
    expect(parseProblems('\u001b[31mfoo.ts(1,2): error TS1: bad\u001b[0m\r\n')).toHaveLength(1)
  })
  it('removes exact duplicates but keeps different lines of one file', () => {
    const out = lines('a.ts(1,1): error TS1: x', 'a.ts(1,1): error TS1: x', 'a.ts(2,1): error TS1: x')
    expect(parseProblems(out)).toHaveLength(2)
  })
  it('caps the number of problems', () => {
    const out = Array.from({ length: 800 }, (_, i) => `a.ts(${i + 1},1): error TS1: x`).join('\n')
    expect(parseProblems(out)).toHaveLength(500)
  })
})

describe('resolveProblemFile', () => {
  it('resolves relative paths against the run working directory', () => {
    expect(resolveProblemFile('src/a.ts', '/repo/app', '/repo')).toBe('app/src/a.ts')
    expect(resolveProblemFile('./src/a.ts', '/repo', '/repo')).toBe('src/a.ts')
    expect(resolveProblemFile('../lib/b.ts', '/repo/app', '/repo')).toBe('lib/b.ts')
  })
  it('keeps absolute paths inside the checkout and drops those outside', () => {
    expect(resolveProblemFile('/repo/src/a.ts', '/repo/app', '/repo')).toBe('src/a.ts')
    expect(resolveProblemFile('/other/a.ts', '/repo', '/repo')).toBeNull()
    expect(resolveProblemFile('../../etc/passwd', '/repo/app', '/repo')).toBeNull()
    expect(resolveProblemFile('/repo-two/a.ts', '/repo', '/repo')).toBeNull()
  })
  it('handles Windows paths, drive case and backslashes', () => {
    expect(resolveProblemFile('C:\\Work\\App\\src\\a.cs', 'C:\\Work\\App', 'C:\\Work\\App')).toBe('src/a.cs')
    expect(resolveProblemFile('c:\\work\\app\\src\\a.cs', 'C:\\Work\\App', 'C:\\Work\\App')).toBe('src/a.cs')
    expect(resolveProblemFile('src\\a.cs', 'C:\\Work\\App', 'C:\\Work\\App')).toBe('src/a.cs')
    expect(resolveProblemFile('D:\\x\\a.cs', 'C:\\Work\\App', 'C:\\Work\\App')).toBeNull()
  })
  it('handles file URLs and node_modules', () => {
    expect(resolveProblemFile('file:///C:/repo/tests/t.ts', 'C:/repo', 'C:/repo')).toBe('tests/t.ts')
    expect(resolveProblemFile('node_modules/x/i.js', '/repo', '/repo')).toBeNull()
  })
})

describe('groupProblems and problemsLabel', () => {
  it('groups by file in first-seen order', () => {
    const groups = groupProblems([
      { severity: 'error', file: 'a.ts', line: 1, message: 'x', source: 'typescript' },
      { severity: 'warning', file: 'b.ts', line: 2, message: 'y', source: 'eslint' },
      { severity: 'error', file: 'a.ts', line: 9, message: 'z', source: 'typescript' }
    ])
    expect(groups.map((group) => [group.file, group.items.length])).toEqual([['a.ts', 2], ['b.ts', 1]])
  })
  it('labels the tab with the count', () => {
    expect(problemsLabel(0)).toBe('Problems')
    expect(problemsLabel(3)).toBe('Problems 3')
  })
})
