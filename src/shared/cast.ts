export type CastKind = 'o' | 'r' | 'm'

export interface CastHeader {
  version: 2
  width: number
  height: number
  timestamp: number
  title?: string
  env?: Record<string, string>
}

export interface CastEvent {
  t: number
  kind: CastKind
  data: string
}

export interface ParsedCast {
  header: CastHeader
  events: CastEvent[]
}

export type CastMarkerKind = 'prompt' | 'permission' | 'exit' | 'paused' | 'resumed' | 'truncated'

export const MAX_COLS = 1000
export const MAX_ROWS = 500

const KINDS: readonly string[] = ['o', 'r', 'm']

export const roundSeconds = (seconds: number): number => Math.round(Math.max(0, seconds) * 1000) / 1000

export function castHeaderLine(header: CastHeader): string {
  return `${JSON.stringify(header)}\n`
}

export function castEventLine(seconds: number, kind: CastKind, data: string): string {
  return `${JSON.stringify([roundSeconds(seconds), kind, data])}\n`
}

export const resizeData = (cols: number, rows: number): string => `${cols}x${rows}`

export function parseResize(data: string): { cols: number; rows: number } | null {
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(data)
  if (!match) return null
  const cols = Number(match[1])
  const rows = Number(match[2])
  return cols >= 2 && rows >= 1 ? { cols: Math.min(cols, MAX_COLS), rows: Math.min(rows, MAX_ROWS) } : null
}

function parseHeader(line: string): CastHeader | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    if (raw === null || typeof raw !== 'object' || raw.version !== 2) return null
    const width = Number(raw.width)
    const height = Number(raw.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 1) return null
    const header: CastHeader = {
      version: 2,
      width: Math.min(MAX_COLS, Math.floor(width)),
      height: Math.min(MAX_ROWS, Math.floor(height)),
      timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : 0
    }
    if (typeof raw.title === 'string') header.title = raw.title
    return header
  } catch {
    return null
  }
}

function parseEvent(line: string): CastEvent | null {
  try {
    const raw = JSON.parse(line) as unknown
    if (!Array.isArray(raw) || raw.length < 3) return null
    const [t, kind, data] = raw as [unknown, unknown, unknown]
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null
    if (typeof kind !== 'string' || !KINDS.includes(kind) || typeof data !== 'string') return null
    return { t, kind: kind as CastKind, data }
  } catch {
    return null
  }
}

const PARSE_BATCH_LINES = 20_000

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function parseLines(lines: string[], first: number): ParsedCast | null {
  const header = parseHeader(lines[first])
  return header ? { header, events: [] } : null
}

function appendEvent(events: CastEvent[], line: string, last: number): number {
  const event = parseEvent(line)
  if (!event) return last
  const t = Math.max(event.t, last)
  events.push(t === event.t ? event : { ...event, t })
  return t
}

export function parseCast(text: string): ParsedCast | null {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first < 0) return null
  const parsed = parseLines(lines, first)
  if (!parsed) return null
  let last = 0
  for (let index = first + 1; index < lines.length; index += 1) {
    if (lines[index] !== '') last = appendEvent(parsed.events, lines[index], last)
  }
  return parsed
}

export async function parseCastAsync(text: string, yielder: () => Promise<void> = yieldToLoop): Promise<ParsedCast | null> {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first < 0) return null
  const parsed = parseLines(lines, first)
  if (!parsed) return null
  let last = 0
  for (let index = first + 1; index < lines.length; index += 1) {
    if (lines[index] !== '') last = appendEvent(parsed.events, lines[index], last)
    if ((index - first) % PARSE_BATCH_LINES === 0) await yielder()
  }
  return parsed
}

export function castDuration(events: CastEvent[]): number {
  return events.length === 0 ? 0 : events[events.length - 1].t
}
