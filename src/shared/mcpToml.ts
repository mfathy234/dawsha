/** A small TOML reader for what Codex's config.toml holds in its tables: strings, numbers, booleans, arrays and inline tables. It does not validate, and a line it cannot read is skipped. */
export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue }

export type TomlItem =
  | { kind: 'table'; path: string[]; line: number }
  | { kind: 'kv'; path: string[]; key: string; value: TomlValue; line: number; endLine: number }

class Skip extends Error {}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' }

class Reader {
  i = 0
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.i >= this.text.length
  }
  peek(n = 1): string {
    return this.text.slice(this.i, this.i + n)
  }
  inlineSpace(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.i++
  }
  /** Blank space, line breaks and comments. */
  trivia(): void {
    for (;;) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++
      else if (c === '#') this.skipLine()
      else return
    }
  }
  skipLine(): void {
    while (!this.done && this.peek() !== '\n') this.i++
  }
}

function basicString(r: Reader, multi: boolean): string {
  let out = ''
  for (;;) {
    if (r.done) throw new Skip()
    const c = r.text[r.i]
    if (multi ? r.peek(3) === '"""' : c === '"') {
      r.i += multi ? 3 : 1
      return out
    }
    if (c === '\n' && !multi) throw new Skip()
    r.i++
    if (c !== '\\') {
      out += c
      continue
    }
    const e = r.text[r.i++]
    if (e === 'u' || e === 'U') {
      const len = e === 'u' ? 4 : 8
      out += String.fromCodePoint(parseInt(r.text.slice(r.i, r.i + len), 16))
      r.i += len
    } else if (e in ESCAPES) out += ESCAPES[e]
    else if (multi && (e === '\n' || e === '\r' || e === ' ')) while (/\s/.test(r.peek())) r.i++
    else throw new Skip()
  }
}

function literalString(r: Reader, multi: boolean): string {
  const close = multi ? "'''" : "'"
  const end = r.text.indexOf(close, r.i)
  if (end < 0) throw new Skip()
  const body = r.text.slice(r.i, end)
  if (!multi && body.includes('\n')) throw new Skip()
  r.i = end + close.length
  return body
}

function quoted(r: Reader): string {
  const q = r.text[r.i]
  const multi = r.peek(3) === q.repeat(3)
  r.i += multi ? 3 : 1
  if (multi && r.peek() === '\n') r.i++
  return q === '"' ? basicString(r, multi) : literalString(r, multi)
}

function bare(r: Reader): string {
  const start = r.i
  while (!r.done && /[\w.+:-]/.test(r.text[r.i])) r.i++
  if (r.i === start) throw new Skip()
  return r.text.slice(start, r.i)
}

function keyPath(r: Reader, stop: RegExp): string[] {
  const parts: string[] = []
  for (;;) {
    r.inlineSpace()
    const c = r.peek()
    if (c === '"' || c === "'") parts.push(quoted(r))
    else {
      const start = r.i
      while (!r.done && /[A-Za-z0-9_-]/.test(r.text[r.i])) r.i++
      if (r.i === start) throw new Skip()
      parts.push(r.text.slice(start, r.i))
    }
    r.inlineSpace()
    if (r.peek() === '.') {
      r.i++
      continue
    }
    if (!stop.test(r.peek() || '\n')) throw new Skip()
    return parts
  }
}

function list(r: Reader): TomlValue[] {
  r.i++
  const items: TomlValue[] = []
  for (;;) {
    r.trivia()
    if (r.peek() === ']') {
      r.i++
      return items
    }
    items.push(value(r))
    r.trivia()
    if (r.peek() === ',') r.i++
    else if (r.peek() !== ']') throw new Skip()
  }
}

function inlineTable(r: Reader): { [key: string]: TomlValue } {
  r.i++
  const out: { [key: string]: TomlValue } = {}
  for (;;) {
    r.trivia()
    if (r.peek() === '}') {
      r.i++
      return out
    }
    const path = keyPath(r, /=/)
    r.i++
    r.trivia()
    out[path.join('.')] = value(r)
    r.trivia()
    if (r.peek() === ',') r.i++
    else if (r.peek() !== '}') throw new Skip()
  }
}

function value(r: Reader): TomlValue {
  const c = r.peek()
  if (c === '"' || c === "'") return quoted(r)
  if (c === '[') return list(r)
  if (c === '{') return inlineTable(r)
  const word = bare(r)
  if (word === 'true') return true
  if (word === 'false') return false
  const num = Number(word.replace(/_/g, ''))
  return Number.isNaN(num) ? word : num
}

function header(r: Reader): string[] {
  r.i++
  if (r.peek() === '[') {
    r.skipLine()
    throw new Skip()
  }
  const path = keyPath(r, /\]/)
  r.i++
  return path
}

/** Every table header and `key = value` line of the text, in order, with the table each belongs to. */
export function parseToml(text: string): TomlItem[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const lineOf = (index: number): number => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (starts[mid] <= index) low = mid
      else high = mid - 1
    }
    return low
  }
  const r = new Reader(text)
  const items: TomlItem[] = []
  let table: string[] = []
  for (r.trivia(); !r.done; r.trivia()) {
    const begin = r.i
    try {
      if (r.peek() === '[') {
        table = header(r)
        items.push({ kind: 'table', path: table, line: lineOf(begin) })
      } else {
        const key = keyPath(r, /=/)
        r.i++
        r.inlineSpace()
        const parsed = value(r)
        items.push({ kind: 'kv', path: table, key: key.join('.'), value: parsed, line: lineOf(begin), endLine: lineOf(Math.max(begin, r.i - 1)) })
      }
      r.inlineSpace()
      if (r.peek() !== '#' && r.peek() !== '\n' && r.peek() !== '\r' && !r.done) throw new Skip()
    } catch (error) {
      if (!(error instanceof Skip)) throw error
      r.i = Math.max(r.i, begin)
      r.skipLine()
    }
  }
  return items
}
