
export interface ScreenLine {
  text: string
  isWrapped: boolean
}

export interface ExtractedReply {
  text: string
  lineCount: number
}

const WINDOWS_PROMPT = /^(?:PS\s.*|[A-Za-z]:\\.*)>$/
const UNIX_PROMPT = /^\S+[$#%]$/

export const isShellPromptLine = (text: string): boolean => {
  const line = text.trim()
  return WINDOWS_PROMPT.test(line) || UNIX_PROMPT.test(line)
}

export function unwrapLines(lines: ScreenLine[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const last = out.length - 1
    if (line.isWrapped && last >= 0) out[last] += line.text
    else out.push(line.text)
  }
  return out
}

export function extractReply(lines: ScreenLine[], startRow: number): ExtractedReply {
  const region = startRow >= 0 ? lines.slice(startRow + 1) : lines
  const logical = unwrapLines(region).map((text) => text.replace(/\s+$/, ''))
  while (logical.length > 0 && logical[logical.length - 1] === '') logical.pop()
  if (logical.length > 0 && isShellPromptLine(logical[logical.length - 1])) logical.pop()
  while (logical.length > 0 && logical[logical.length - 1] === '') logical.pop()
  while (logical.length > 0 && logical[0] === '') logical.shift()
  return { text: logical.join('\n'), lineCount: logical.length }
}

const ESCAPE_SEQUENCE = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|[\s\S])/

export function applyTyped(current: string, data: string): string {
  let typed = current
  let index = 0
  while (index < data.length) {
    const char = data[index]
    if (char === '\x1b') {
      const match = ESCAPE_SEQUENCE.exec(data.slice(index))
      index += match ? match[0].length : 1
      continue
    }
    index += 1
    if (char === '\r' || char === '\n' || char === '\x03' || char === '\x15') typed = ''
    else if (char === '\x7f' || char === '\b') typed = Array.from(typed).slice(0, -1).join('')
    else if (char >= ' ') typed += char
  }
  return typed
}

export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) continue
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    width += wide ? 2 : 1
  }
  return width
}
