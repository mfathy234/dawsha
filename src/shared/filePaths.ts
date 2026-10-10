export interface FileRef {
  path: string
  line?: number
  col?: number
}

export interface FileMatch extends FileRef {
  start: number
  end: number
}

export const MAX_FILE_CANDIDATES = 40
export const MAX_FILE_PATH_LENGTH = 400

const BODY = String.raw`(?:[A-Za-z]:(?=[\\/]))?[^\s"'` + '`' + String.raw`<>|*?(){},;=:\[\]]+`
const SUFFIX = String.raw`(?::(\d{1,7})(?::(\d{1,7}))?|\((\d{1,7})(?:,\s*(\d{1,7}))?\))?`
const URL_SPAN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/
const TRAILING = /[.!…]+$/

const SAFE_TO_OPEN = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'tsv',
  'log', 'env', 'lock', 'diff', 'patch', 'ts', 'tsx', 'jsx', 'mts', 'cts', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'rs', 'go', 'cs', 'csproj', 'sln', 'java', 'kt',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'sql', 'graphql', 'proto', 'vue', 'svelte', 'astro', 'razor', 'cshtml', 'gradle'
])

export const isSafeToOpen = (path: string): boolean => {
  const name = (path.split(/[\\/]/).pop() ?? '').replace(/[. ]+$/, '')
  const dot = name.lastIndexOf('.')
  return dot > 0 && SAFE_TO_OPEN.has(name.slice(dot + 1).toLowerCase())
}

export function fileOpenKind(path: string): 'image' | 'html' | 'default' {
  const ext = (path.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'].includes(ext)) return 'image'
  return 'default'
}

function urlSpans(text: string): [number, number][] {
  return [...text.matchAll(URL_SPAN)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length])
}

function plausible(path: string): boolean {
  if (path.length === 0 || path.length > MAX_FILE_PATH_LENGTH) return false
  if (path.startsWith('-') || /^[./\\]+$/.test(path)) return false
  if (/^[\\/]{2}/.test(path)) return false
  const hasSeparator = /[\\/]/.test(path)
  const name = path.split(/[\\/]/).pop() ?? ''
  if (name === '' || name === '.' || name === '..') return false
  return hasSeparator ? true : EXTENSION.test(name) && name.length > 2
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  return parsed > 0 ? parsed : undefined
}

export function findFilePaths(text: string): FileMatch[] {
  const urls = urlSpans(text)
  const matches: FileMatch[] = []
  const pattern = new RegExp(`${BODY}${SUFFIX}`, 'g')
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0
    const raw = found[0]
    const hasSuffix = found[1] !== undefined || found[3] !== undefined
    const body = hasSuffix ? raw.slice(0, raw.search(/[:(]\d/)) : raw
    const path = hasSuffix ? body : body.replace(TRAILING, '')
    if (!plausible(path)) continue
    const end = start + (hasSuffix ? raw.length : path.length)
    if (urls.some(([from, to]) => start < to && end > from)) continue
    const line = toNumber(found[1] ?? found[3])
    const col = line === undefined ? undefined : toNumber(found[2] ?? found[4])
    const match: FileMatch = { path, start, end }
    if (line !== undefined) match.line = line
    if (col !== undefined) match.col = col
    matches.push(match)
  }
  return matches
}

export function gotoTarget(absolutePath: string, ref: FileRef): string {
  if (ref.line === undefined) return absolutePath
  return ref.col === undefined ? `${absolutePath}:${ref.line}` : `${absolutePath}:${ref.line}:${ref.col}`
}
