import type { CastEvent } from './cast'
import { detectPermissionPrompt } from './permissionPrompt'
import type { ReplayMarker } from './replayTiming'

export interface SearchIndex {
  text: string
  starts: number[]
  eventIndexes: number[]
}

export interface SearchMatch {
  eventIndex: number
  t: number
  offset: number
  line: string
}

export const SEARCH_LIMIT = 300
export const SNIPPET_CHARS = 160
const MARKER_GAP_SECONDS = 5
const PROMPT_TAIL_CHARS = 3000

const enum Mode {
  Text,
  Escape,
  Csi,
  String,
  StringEscape,
  Skip,
  Return
}

const NEWLINE_FINALS = new Set(['A', 'B', 'E', 'F', 'H', 'f', 'd'])
const SPACE_FINALS = new Set(['C', 'G'])

export class AnsiStripper {
  private mode: Mode = Mode.Text

  feed(chunk: string): string {
    let out = ''
    for (let index = 0; index < chunk.length; index += 1) {
      const ch = chunk[index]
      const code = chunk.charCodeAt(index)
      switch (this.mode) {
        case Mode.Return:
          this.mode = Mode.Text
          out += '\n'
          if (ch === '\n') break
          index -= 1
          break
        case Mode.Text:
          if (code === 0x1b) this.mode = Mode.Escape
          else if (ch === '\r') this.mode = Mode.Return
          else if (ch === '\n' || ch === '\t' || (code >= 0x20 && code !== 0x7f)) out += ch
          break
        case Mode.Escape:
          if (ch === '[') this.mode = Mode.Csi
          else if (ch === ']' || ch === 'P' || ch === 'X' || ch === '^' || ch === '_') this.mode = Mode.String
          else if (ch === '(' || ch === ')' || ch === '*' || ch === '+' || ch === '#') this.mode = Mode.Skip
          else this.mode = Mode.Text
          break
        case Mode.Skip:
          this.mode = Mode.Text
          break
        case Mode.Csi:
          if (code >= 0x40 && code <= 0x7e) {
            this.mode = Mode.Text
            if (NEWLINE_FINALS.has(ch)) out += '\n'
            else if (SPACE_FINALS.has(ch)) out += ' '
          }
          break
        case Mode.String:
          if (code === 0x07) this.mode = Mode.Text
          else if (code === 0x1b) this.mode = Mode.StringEscape
          break
        case Mode.StringEscape:
          this.mode = ch === '\\' ? Mode.Text : Mode.Escape
          if (this.mode === Mode.Escape) index -= 1
          break
      }
    }
    return out
  }
}

export function stripAnsi(text: string): string {
  return new AnsiStripper().feed(text)
}

export function buildSearchIndex(events: CastEvent[]): SearchIndex {
  const stripper = new AnsiStripper()
  const parts: string[] = []
  const starts: number[] = []
  const eventIndexes: number[] = []
  let offset = 0
  events.forEach((event, index) => {
    if (event.kind !== 'o') return
    const clean = stripper.feed(event.data)
    if (clean === '') return
    starts.push(offset)
    eventIndexes.push(index)
    parts.push(clean)
    offset += clean.length
  })
  return { text: parts.join(''), starts, eventIndexes }
}

function slotAt(index: SearchIndex, offset: number): number {
  let low = 0
  let high = index.starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >>> 1
    if (index.starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

function lineAround(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const found = text.indexOf('\n', offset)
  const line = text.slice(start, found < 0 ? text.length : found).trim()
  return line.length > SNIPPET_CHARS ? `${line.slice(0, SNIPPET_CHARS - 1)}…` : line
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function searchRecording(index: SearchIndex, events: CastEvent[], query: string, limit = SEARCH_LIMIT): SearchMatch[] {
  const needle = query.trim()
  if (needle === '' || index.starts.length === 0) return []
  const pattern = new RegExp(escapeRegex(needle), 'gi')
  const matches: SearchMatch[] = []
  let previousLine = ''
  for (let found = pattern.exec(index.text); found !== null && matches.length < limit; found = pattern.exec(index.text)) {
    const slot = slotAt(index, found.index + found[0].length - 1)
    const eventIndex = index.eventIndexes[slot]
    const line = lineAround(index.text, found.index)
    if (line === previousLine) continue
    previousLine = line
    matches.push({ eventIndex, t: events[eventIndex].t, offset: found.index, line })
  }
  return matches
}

export function derivePermissionMarkers(index: SearchIndex, events: CastEvent[]): ReplayMarker[] {
  const markers: ReplayMarker[] = []
  let lastAt = -Infinity
  for (let slot = 0; slot < index.starts.length; slot += 1) {
    const eventIndex = index.eventIndexes[slot]
    const t = events[eventIndex].t
    if (t - lastAt < MARKER_GAP_SECONDS) continue
    const end = slot + 1 < index.starts.length ? index.starts[slot + 1] : index.text.length
    const chunk = index.text.slice(index.starts[slot], end)
    if (!/Yes|Do you want to/.test(chunk)) continue
    if (!detectPermissionPrompt(index.text.slice(Math.max(0, end - PROMPT_TAIL_CHARS), end))) continue
    markers.push({ index: eventIndex, t, kind: 'permission' })
    lastAt = t
  }
  return markers
}
