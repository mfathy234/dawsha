import { terminalWidthProvider } from './terminalUnicode'
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
  let from = startRow >= 0 ? startRow + 1 : 0
  // A prompt line wider than the terminal continues on wrapped rows; those are still the prompt, not the reply.
  if (startRow >= 0) while (from < lines.length && lines[from].isWrapped) from += 1
  const region = lines.slice(from)
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
    width += terminalWidthProvider.wcwidth(char.codePointAt(0) ?? 0)
  }
  return width
}
