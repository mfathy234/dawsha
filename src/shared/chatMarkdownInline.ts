/** The small inline syntax chat understands: `code`, **bold**, *italic*, [text](url). Anything else stays plain text. */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'link'; text: string; url: string }

/** How far ahead a closing mark is looked for, so a stray `*` in a long message cannot cost a scan of everything after it. */
const SPAN_MAX = 2_000
const ESCAPABLE = '\\`*[]()|#>_-+.!~'
const SAFE_URL = /^https?:\/\/[^\s]+$/i

/** Only web links can be opened; anything else (a file path, javascript:) is shown as its text. */
export const isWebLink = (url: string): boolean => SAFE_URL.test(url)

interface Match {
  node: Inline
  end: number
}

function codeAt(text: string, at: number): Match | null {
  const close = text.indexOf('`', at + 1)
  if (close <= at + 1 || close - at > SPAN_MAX || text.slice(at + 1, close).includes('\n')) return null
  return { node: { type: 'code', text: text.slice(at + 1, close) }, end: close + 1 }
}

function boldAt(text: string, at: number): Match | null {
  if (!text.startsWith('**', at) || /\s/.test(text[at + 2] ?? ' ')) return null
  const limit = Math.min(text.length, at + SPAN_MAX)
  for (let close = text.indexOf('**', at + 3); close >= 0 && close < limit; close = text.indexOf('**', close + 1)) {
    if (!/\s/.test(text[close - 1])) return { node: { type: 'bold', children: parseInline(text.slice(at + 2, close)) }, end: close + 2 }
  }
  return null
}

function italicAt(text: string, at: number): Match | null {
  if (text[at + 1] === '*' || /\s/.test(text[at + 1] ?? ' ')) return null
  const limit = Math.min(text.length, at + SPAN_MAX)
  for (let close = at + 2; close < limit; close += 1) {
    if (text[close] !== '*' || text[close - 1] === '\\' || text[close + 1] === '*' || /\s/.test(text[close - 1])) continue
    return { node: { type: 'italic', children: parseInline(text.slice(at + 1, close)) }, end: close + 1 }
  }
  return null
}

function linkAt(text: string, at: number): Match | null {
  const mid = text.indexOf('](', at + 1)
  if (mid < 0 || mid - at > SPAN_MAX) return null
  const label = text.slice(at + 1, mid)
  const close = text.indexOf(')', mid + 2)
  if (label === '' || label.includes('\n') || label.includes('[') || close < 0 || close - mid > SPAN_MAX) return null
  const url = text.slice(mid + 2, close).trim()
  if (url === '' || /\s/.test(url)) return null
  return { node: { type: 'link', text: label, url }, end: close + 1 }
}

function matchAt(text: string, at: number): Match | null {
  const char = text[at]
  if (char === '`') return codeAt(text, at)
  if (char === '*') return boldAt(text, at) ?? italicAt(text, at)
  if (char === '[') return linkAt(text, at)
  return null
}

function pushText(out: Inline[], text: string): void {
  if (text === '') return
  const last = out[out.length - 1]
  if (last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + text }
  else out.push({ type: 'text', text })
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let plain = ''
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === '\\' && ESCAPABLE.includes(text[at + 1] ?? '\n')) {
      plain += text[at + 1]
      at += 2
      continue
    }
    const match = matchAt(text, at)
    if (!match) {
      plain += char
      at += 1
      continue
    }
    pushText(out, plain)
    plain = ''
    out.push(match.node)
    at = match.end
  }
  pushText(out, plain)
  return out
}
