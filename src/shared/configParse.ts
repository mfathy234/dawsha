export interface FlatSetting {
  key: string
  value: string
  line: number
}

export const MAX_CONFIG_BYTES = 512 * 1024
export const MAX_CONFIG_ENTRIES = 5000
const MAX_DEPTH = 48
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

export class ConfigParseError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(message)
  }
}

class JsonScanner {
  private at = 0
  private line = 1
  private lineStart = 0
  readonly out: FlatSetting[] = []

  constructor(private readonly text: string) {}

  fail(message: string): never {
    throw new ConfigParseError(message, this.line, this.at - this.lineStart + 1)
  }

  private newline(): void {
    this.line++
    this.lineStart = this.at + 1
  }

  skip(): void {
    for (;;) {
      const ch = this.text[this.at]
      if (ch === '/' && this.text[this.at + 1] === '/') {
        while (this.at < this.text.length && this.text[this.at] !== '\n') this.at++
      } else if (ch === '/' && this.text[this.at + 1] === '*') {
        this.blockComment()
      } else if (ch === '\n') {
        this.newline()
        this.at++
      } else if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '﻿') {
        this.at++
      } else {
        return
      }
    }
  }

  private blockComment(): void {
    const start = this.line
    const startColumn = this.at - this.lineStart + 1
    this.at += 2
    while (this.at < this.text.length && !(this.text[this.at] === '*' && this.text[this.at + 1] === '/')) {
      if (this.text[this.at] === '\n') this.newline()
      this.at++
    }
    if (this.at >= this.text.length) throw new ConfigParseError('A /* comment is never closed.', start, startColumn)
    this.at += 2
  }

  peek(): string | undefined {
    return this.text[this.at]
  }

  eat(ch: string): boolean {
    this.skip()
    if (this.text[this.at] !== ch) return false
    this.at++
    return true
  }

  string(): string {
    if (this.text[this.at] !== '"') this.fail('Expected a quoted string.')
    this.at++
    let out = ''
    for (;;) {
      const ch = this.text[this.at]
      if (ch === undefined || ch === '\n') this.fail('A string is not closed.')
      this.at++
      if (ch === '"') return out
      out += ch === '\\' ? this.escape() : ch
    }
  }

  private escape(): string {
    const ch = this.text[this.at++]
    if (ch === 'u') {
      const hex = this.text.slice(this.at, this.at + 4)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('A \\u escape needs four hex digits.')
      this.at += 4
      return String.fromCharCode(parseInt(hex, 16))
    }
    if (ch === undefined || !(ch in ESCAPES)) this.fail('Unknown escape in a string.')
    return ESCAPES[ch]
  }

  private literal(): string {
    const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(this.text.slice(this.at, this.at + 64))
    if (!match) this.fail('Expected a value.')
    this.at += match[0].length
    return match[0]
  }

  value(path: string, line: number, depth: number): void {
    if (depth > MAX_DEPTH) this.fail('The nesting is too deep.')
    this.skip()
    const ch = this.peek()
    if (ch === '{') this.object(path, depth)
    else if (ch === '[') this.array(path, depth)
    else this.push(path, ch === '"' ? this.string() : this.literal(), line)
  }

  private push(key: string, value: string, line: number): void {
    if (this.out.length >= MAX_CONFIG_ENTRIES) this.fail(`More than ${MAX_CONFIG_ENTRIES} settings in one file.`)
    this.out.push({ key, value, line })
  }

  private object(path: string, depth: number): void {
    this.at++
    for (;;) {
      if (this.eat('}')) return
      this.skip()
      const line = this.line
      const name = this.string()
      if (!this.eat(':')) this.fail('Expected ":" after a name.')
      this.value(path ? `${path}:${name}` : name, line, depth + 1)
      if (this.eat(',')) continue
      if (this.eat('}')) return
      this.fail('Expected "," or "}" here.')
    }
  }

  private array(path: string, depth: number): void {
    this.at++
    for (let index = 0; ; index++) {
      if (this.eat(']')) return
      this.skip()
      this.value(`${path}:${index}`, this.line, depth + 1)
      if (this.eat(',')) continue
      if (this.eat(']')) return
      this.fail('Expected "," or "]" here.')
    }
  }
}

/** Flattens a JSON config file to Section:Key settings with their lines. Comments and trailing commas are allowed, as .NET allows them. */
export function parseJsonConfig(text: string): FlatSetting[] {
  const scanner = new JsonScanner(text)
  scanner.skip()
  if (scanner.peek() === undefined) return []
  scanner.value('', 1, 0)
  scanner.skip()
  if (scanner.peek() !== undefined) scanner.fail('Unexpected text after the end of the JSON.')
  return scanner.out
}

function closed(raw: string, quote: string): boolean {
  return raw.slice(1).includes(quote)
}

function plainValue(raw: string): string {
  const quote = raw[0]
  if (quote === '"' || quote === "'") {
    const end = raw.indexOf(quote, 1)
    const inner = raw.slice(1, end)
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner
  }
  return raw.replace(/\s+#.*$/, '').trim()
}

/** KEY=value lines of a .env file; `export`, quotes, comments and quoted values that run over several lines are understood. */
export function parseDotenv(text: string): FlatSetting[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out: FlatSetting[] = []
  for (let i = 0; i < lines.length && out.length < MAX_CONFIG_ENTRIES; i++) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/.exec(lines[i])
    if (!match) continue
    let raw = match[2].trim()
    const start = i
    const quote = raw[0]
    if ((quote === '"' || quote === "'") && !closed(raw, quote)) {
      while (i + 1 < lines.length && !closed(raw, quote)) raw += `\n${lines[++i]}`
      if (!closed(raw, quote)) throw new ConfigParseError(`The value of ${match[1]} opens a quote that is never closed.`, start + 1, 1)
    }
    out.push({ key: match[1], value: plainValue(raw), line: start + 1 })
  }
  return out
}
