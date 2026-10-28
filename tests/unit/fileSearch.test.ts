import { describe, expect, it } from 'vitest'
import {
  buildGrepArgs, globToRegExp, includePatterns, matchesInclude, matcherFor, matchRanges, parseGrepOutput, searchText, shouldSkipDir, shouldSkipFile, validateSearchRequest, SEARCH_MAX_PER_FILE, type SearchRequest
} from '../../src/shared/fileSearch'

const request = (over: Partial<SearchRequest> = {}): SearchRequest => ({ query: 'foo', matchCase: false, wholeWord: false, regex: false, include: '', ...over })
const record = (path: string, line: number, text: string): string => `${path}\x00${line}\x00${text}`

describe('buildGrepArgs', () => {
  it('searches fixed strings, case-insensitively, with untracked files and without ignored ones', () => {
    const args = buildGrepArgs(request())
    expect(args).toEqual(expect.arrayContaining(['grep', '-I', '-n', '--null', '--untracked', '--exclude-standard', '-i', '-F']))
    expect(args.slice(args.indexOf('-e'))).toEqual(['-e', 'foo', '--', '.'])
  })
  it('maps the options', () => {
    const args = buildGrepArgs(request({ matchCase: true, wholeWord: true, regex: true }))
    expect(args).not.toContain('-i')
    expect(args).toContain('-w')
    expect(args).toContain('-E')
    expect(args).not.toContain('-F')
  })
  it('keeps a query that looks like a flag after -e', () => {
    const args = buildGrepArgs(request({ query: '--exec=evil' }))
    expect(args[args.indexOf('-e') + 1]).toBe('--exec=evil')
  })
  it('turns include globs into glob pathspecs inside the scope', () => {
    expect(buildGrepArgs(request({ include: '*.ts, docs/**/*.md' }), 'pkg').slice(-2)).toEqual([':(glob)pkg/**/*.ts', ':(glob)pkg/docs/**/*.md'])
    expect(buildGrepArgs(request(), 'pkg').slice(-1)).toEqual([':(glob)pkg/**'])
  })
})

describe('validateSearchRequest', () => {
  it('accepts a normal request and trims the include', () => {
    expect(validateSearchRequest({ query: 'x', include: ' *.ts ' })).toMatchObject({ ok: true, request: { query: 'x', include: '*.ts', matchCase: false } })
  })
  it('refuses empty, huge, NUL and non-object requests', () => {
    for (const bad of [null, 5, { query: '' }, { query: '   ' }, { query: 'a'.repeat(501) }, { query: 'a\x00b' }]) expect(validateSearchRequest(bad).ok).toBe(false)
  })
  it('refuses include globs that escape the checkout or use pathspec magic', () => {
    for (const include of ['../x', 'a/../../b', '/etc/*', 'C:\\Windows', ':(top)x']) expect(validateSearchRequest({ query: 'x', include }).ok).toBe(false)
  })
  it('refuses an invalid regular expression only when regex is on', () => {
    expect(validateSearchRequest({ query: '(', regex: true }).ok).toBe(false)
    expect(validateSearchRequest({ query: '(', regex: false }).ok).toBe(true)
  })
})

describe('parseGrepOutput', () => {
  const out = [record('src/a.ts', 3, '  const foo = 1  '), record('src/a.ts', 9, 'foo()'), record('src/b.ts', 1, 'foo')].join('\n')
  it('groups matches by file with trimmed snippets', () => {
    const parsed = parseGrepOutput(out)
    expect(parsed.files).toEqual([
      { path: 'src/a.ts', matches: [{ line: 3, text: 'const foo = 1' }, { line: 9, text: 'foo()' }] },
      { path: 'src/b.ts', matches: [{ line: 1, text: 'foo' }] }
    ])
    expect(parsed).toMatchObject({ total: 3, truncated: false })
  })
  it('caps matches and says how many there were', () => {
    const parsed = parseGrepOutput(out, 2)
    expect(parsed.files.flatMap((f) => f.matches)).toHaveLength(2)
    expect(parsed).toMatchObject({ total: 3, truncated: true })
  })
  it('caps matches per file', () => {
    const many = Array.from({ length: SEARCH_MAX_PER_FILE + 5 }, (_, i) => record('x.ts', i + 1, 'foo')).join('\n')
    const parsed = parseGrepOutput(many)
    expect(parsed.files[0].matches).toHaveLength(SEARCH_MAX_PER_FILE)
    expect(parsed.truncated).toBe(true)
  })
  it('keeps colons in the text and ignores garbage', () => {
    expect(parseGrepOutput(`${record('a.ts', 4, 'a:b:c')}\nnonsense\n`).files[0].matches[0]).toEqual({ line: 4, text: 'a:b:c' })
  })
  it('shortens very long lines', () => {
    expect(parseGrepOutput(record('a.ts', 1, 'x'.repeat(600))).files[0].matches[0].text.length).toBeLessThan(300)
  })
})

describe('walker rules', () => {
  it('skips dependency, vcs and build folders but not ordinary ones', () => {
    for (const name of ['node_modules', '.git', 'dist', 'build', 'out', 'coverage']) expect(shouldSkipDir(name)).toBe(true)
    for (const name of ['src', 'docs', 'tests', 'lib']) expect(shouldSkipDir(name)).toBe(false)
  })
  it('skips binary extensions', () => {
    expect(shouldSkipFile('logo.PNG')).toBe(true)
    expect(shouldSkipFile('a.ts')).toBe(false)
    expect(shouldSkipFile('Makefile')).toBe(false)
  })
})

describe('include globs', () => {
  it('roots a bare pattern in any folder and keeps a slashed one where it is', () => {
    expect(includePatterns('*.ts')).toEqual(['**/*.ts'])
    expect(includePatterns('src/*.ts, docs/')).toEqual(['src/*.ts', 'docs/**'])
  })
  it('matches paths', () => {
    expect(matchesInclude('src/a.ts', '*.ts')).toBe(true)
    expect(matchesInclude('a.ts', '*.ts')).toBe(true)
    expect(matchesInclude('src/a.js', '*.ts')).toBe(false)
    expect(matchesInclude('src/deep/a.ts', 'src/*.ts')).toBe(false)
    expect(matchesInclude('src/deep/a.ts', 'src/**/*.ts')).toBe(true)
    expect(matchesInclude('pkg/src/a.ts', '*.ts', 'pkg')).toBe(true)
    expect(matchesInclude('other/a.ts', '*.ts', 'pkg')).toBe(false)
    expect(matchesInclude('anything', '')).toBe(true)
  })
  it('escapes regex characters in a glob', () => {
    expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true)
    expect(globToRegExp('a+b.ts').test('aab.ts')).toBe(false)
  })
})

describe('matcherFor and ranges', () => {
  it('escapes literals unless regex is on', () => {
    expect(matchRanges('a.c abc', matcherFor(request({ query: 'a.c' })))).toEqual([{ from: 0, to: 3 }])
    expect(matchRanges('a.c abc', matcherFor(request({ query: 'a.c', regex: true })))).toHaveLength(2)
  })
  it('respects case and whole word', () => {
    expect(matchRanges('Foo foo', matcherFor(request({ matchCase: true })))).toEqual([{ from: 4, to: 7 }])
    expect(matchRanges('foo food', matcherFor(request({ wholeWord: true })))).toEqual([{ from: 0, to: 3 }])
  })
  it('returns no ranges for an invalid pattern and never loops on empty matches', () => {
    expect(matcherFor(request({ query: '(', regex: true }))).toBeNull()
    expect(matchRanges('abc', matcherFor(request({ query: 'x*', regex: true })))).toEqual([])
  })
  it('searchText finds lines up to the room left', () => {
    const matcher = matcherFor(request())
    expect(searchText('foo\nbar\nFOO\nfoo', matcher as RegExp, 2).map((m) => m.line)).toEqual([1, 3])
  })
})
