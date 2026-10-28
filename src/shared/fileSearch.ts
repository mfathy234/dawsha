export interface SearchRequest {
  query: string
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
  include: string
}

export interface SearchMatch {
  line: number
  text: string
}

export interface SearchFile {
  path: string
  matches: SearchMatch[]
}

export type SearchResult =
  | { ok: true; files: SearchFile[]; total: number; truncated: boolean; engine: 'git' | 'walk' }
  | { ok: false; error: string }

export const SEARCH_MAX_MATCHES = 500
export const SEARCH_MAX_PER_FILE = 60
export const SEARCH_MAX_QUERY = 500
export const SEARCH_MAX_INCLUDE = 200
export const SEARCH_SNIPPET_CHARS = 240
export const WALK_MAX_FILES = 5_000
export const WALK_MAX_BYTES = 1024 * 1024

const SKIPPED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'target', 'bin', 'obj', 'coverage', '.turbo', '.vite', '.cache', '__pycache__', '.venv', 'release'
])

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'pdf', 'zip', 'gz', 'tgz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'node', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'webm', 'class', 'jar', 'pdb', 'lock'
])

export const shouldSkipDir = (name: string): boolean => SKIPPED_DIRS.has(name)

export function shouldSkipFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

export type SearchValidation = { ok: true; request: SearchRequest } | { ok: false; error: string }

const splitInclude = (include: string): string[] => include.split(',').map((part) => part.trim().replace(/\\/g, '/')).filter((part) => part !== '')

/** Checks a request that came over IPC: the shape, the sizes, and that an include glob stays inside the checkout. */
export function validateSearchRequest(raw: unknown): SearchValidation {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Invalid search.' }
  const value = raw as Record<string, unknown>
  if (typeof value.query !== 'string' || value.query.trim() === '') return { ok: false, error: 'Type something to search for.' }
  if (value.query.length > SEARCH_MAX_QUERY || value.query.includes('\x00')) return { ok: false, error: 'That search text is too long.' }
  const include = typeof value.include === 'string' ? value.include.trim() : ''
  if (include.length > SEARCH_MAX_INCLUDE || include.includes('\x00')) return { ok: false, error: 'That file filter is too long.' }
  for (const pattern of splitInclude(include)) {
    if (/^([a-zA-Z]:)?[\\/]/.test(pattern) || pattern.split('/').includes('..') || pattern.startsWith(':')) return { ok: false, error: 'The file filter must stay inside this checkout.' }
  }
  const request: SearchRequest = { query: value.query, matchCase: value.matchCase === true, wholeWord: value.wholeWord === true, regex: value.regex === true, include }
  if (request.regex) {
    try {
      new RegExp(request.query)
    } catch (error) {
      return { ok: false, error: `Not a valid regular expression: ${(error as Error).message}` }
    }
  }
  return { ok: true, request }
}

/** Include patterns as globs rooted in the checkout: one without a slash matches in any folder, like a .gitignore line. */
export function includePatterns(include: string, scope = ''): string[] {
  const base = scope === '' ? '' : `${scope.replace(/\/+$/, '')}/`
  return splitInclude(include).map((pattern) => {
    const rooted = pattern.replace(/^\.\//, '').replace(/^\//, '')
    const trimmed = rooted.endsWith('/') ? `${rooted}**` : rooted
    return `${base}${trimmed.includes('/') ? trimmed : `**/${trimmed}`}`
  })
}

export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1
        if (glob[i + 1] === '/') {
          i += 1
          source += '(?:.*/)?'
        } else source += '.*'
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

export function matchesInclude(path: string, include: string, scope = ''): boolean {
  const patterns = includePatterns(include, scope)
  return patterns.length === 0 || patterns.some((pattern) => globToRegExp(pattern).test(path))
}

/** The git grep arguments for a request, run from the repository root. Untracked files are included; ignored ones are not. */
export function buildGrepArgs(request: SearchRequest, scope = ''): string[] {
  const patterns = includePatterns(request.include, scope)
  const pathspec = patterns.length > 0 ? patterns.map((pattern) => `:(glob)${pattern}`) : scope === '' ? ['.'] : [`:(glob)${scope}/**`]
  return [
    '--no-pager', 'grep', '-I', '-n', '--null', '--untracked', '--exclude-standard',
    ...(request.matchCase ? [] : ['-i']),
    ...(request.wholeWord ? ['-w'] : []),
    request.regex ? '-E' : '-F',
    '-e', request.query,
    '--', ...pathspec
  ]
}

export interface ParsedSearch {
  files: SearchFile[]
  total: number
  truncated: boolean
}

const snippet = (text: string): string => {
  const trimmed = text.replace(/\r$/, '').trim()
  return trimmed.length > SEARCH_SNIPPET_CHARS ? `${trimmed.slice(0, SEARCH_SNIPPET_CHARS)}…` : trimmed
}

/** Reads `git grep -n --null` output (`path NUL line NUL text`), grouped by file and capped; the total counts what was dropped too. */
export function parseGrepOutput(stdout: string, cap = SEARCH_MAX_MATCHES): ParsedSearch {
  const byPath = new Map<string, SearchFile>()
  let total = 0
  let kept = 0
  for (const record of stdout.split('\n')) {
    const nul = record.indexOf('\x00')
    if (nul <= 0) continue
    const path = record.slice(0, nul)
    const rest = /^(\d+)\x00([\s\S]*)$/.exec(record.slice(nul + 1))
    if (!rest) continue
    total += 1
    if (kept >= cap) continue
    let file = byPath.get(path)
    if (!file) {
      file = { path, matches: [] }
      byPath.set(path, file)
    }
    if (file.matches.length >= SEARCH_MAX_PER_FILE) continue
    file.matches.push({ line: Number(rest[1]), text: snippet(rest[2]) })
    kept += 1
  }
  return { files: [...byPath.values()].filter((file) => file.matches.length > 0), total, truncated: total > kept }
}

/** The pattern a request means, for the walker and for highlighting. Null when the regular expression is invalid. */
export function matcherFor(request: SearchRequest): RegExp | null {
  const body = request.regex ? request.query : request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = request.wholeWord ? `(?<![\\w])(?:${body})(?![\\w])` : body
  try {
    return new RegExp(source, request.matchCase ? 'g' : 'gi')
  } catch {
    return null
  }
}

export interface Range {
  from: number
  to: number
}

export function matchRanges(text: string, matcher: RegExp | null): Range[] {
  if (!matcher) return []
  const ranges: Range[] = []
  const pattern = new RegExp(matcher.source, matcher.flags)
  let found = pattern.exec(text)
  while (found && ranges.length < 20) {
    if (found[0] === '') pattern.lastIndex += 1
    else ranges.push({ from: found.index, to: found.index + found[0].length })
    found = pattern.exec(text)
  }
  return ranges
}

/** Searches one file's text the way the walker does, in line order. */
export function searchText(text: string, matcher: RegExp, room: number): SearchMatch[] {
  const out: SearchMatch[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && out.length < room; i += 1) {
    if (matchRanges(lines[i], matcher).length > 0) out.push({ line: i + 1, text: snippet(lines[i]) })
  }
  return out
}
