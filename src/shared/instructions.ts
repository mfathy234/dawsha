export const INSTRUCTION_FILES = [
  { name: 'CLAUDE.md', agent: 'Claude Code' },
  { name: 'AGENTS.md', agent: 'Codex CLI' },
  { name: 'GEMINI.md', agent: 'Gemini CLI' }
] as const

export type InstructionFileName = (typeof INSTRUCTION_FILES)[number]['name']

export const INSTRUCTION_MAX_BYTES = 512 * 1024
export const SHARED_START = '<!-- dawsha:shared:start -->'
export const SHARED_END = '<!-- dawsha:shared:end -->'

export interface FileStamp {
  mtimeMs: number
  size: number
}

export type InstructionRead =
  | { ok: true; exists: boolean; content: string; size: number; mtimeMs: number }
  | { ok: false; message: string }

export interface InstructionWriteRequest {
  folder: string
  name: string
  content: string
  expected: FileStamp | null
  overwrite: boolean
}

export type InstructionWriteResult =
  | { ok: true; size: number; mtimeMs: number }
  | { ok: false; reason: 'changed' | 'invalid' | 'toolarge' | 'error'; message: string }

export type Eol = '\n' | '\r\n'

export function isInstructionName(value: unknown): value is InstructionFileName {
  return typeof value === 'string' && INSTRUCTION_FILES.some((file) => file.name === value)
}

export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n'
}

export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function withEol(text: string, eol: Eol): string {
  const lf = toLf(text)
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n')
}

type Span = { start: number; end: number }

function markerLines(text: string, marker: string): Span[] {
  const spans: Span[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(marker, from)
    if (at < 0) return spans
    spans.push({ start: at, end: at + marker.length })
    from = at + marker.length
  }
}

export type SharedBlock =
  | { status: 'missing' }
  | { status: 'found'; content: string; start: number; end: number }
  | { status: 'invalid'; message: string }

export function findSharedBlock(text: string): SharedBlock {
  const starts = markerLines(text, SHARED_START)
  const ends = markerLines(text, SHARED_END)
  if (starts.length === 0 && ends.length === 0) return { status: 'missing' }
  if (starts.length > 1 || ends.length > 1) {
    return { status: 'invalid', message: 'The shared block markers appear more than once. Remove the duplicates first.' }
  }
  if (starts.length !== ends.length || ends[0].start < starts[0].end) {
    return { status: 'invalid', message: 'The shared block has a start or end marker missing or out of order. Fix the markers first.' }
  }
  const inner = text.slice(starts[0].end, ends[0].start)
  const content = toLf(inner).replace(/^\n/, '').replace(/\n$/, '')
  return { status: 'found', content, start: starts[0].start, end: ends[0].end }
}

export function readSharedBlock(text: string): string | null {
  const block = findSharedBlock(text)
  return block.status === 'found' ? block.content : null
}

export type ApplyResult = { ok: true; text: string; changed: boolean } | { ok: false; message: string }

export function applySharedBlock(text: string, shared: string): ApplyResult {
  const found = findSharedBlock(text)
  if (found.status === 'invalid') return { ok: false, message: found.message }
  const eol = detectEol(text)
  const body = toLf(shared).replace(/^\n+|\n+$/g, '')
  const block = withEol(`${SHARED_START}\n${body}\n${SHARED_END}`, eol)
  if (found.status === 'found') {
    const next = text.slice(0, found.start) + block + text.slice(found.end)
    return { ok: true, text: next, changed: next !== text }
  }
  if (text.trim() === '') return { ok: true, text: block + eol, changed: true }
  const base = text.endsWith('\n') ? text : text + eol
  const gap = /(\r?\n){2}$/.test(base) ? '' : eol
  return { ok: true, text: base + gap + block + eol, changed: true }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
}
