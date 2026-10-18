const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const BRACKET_START = '\u001b[200~'
const BRACKET_END = '\u001b[201~'

export interface Insertion {
  data: string
  flattened: boolean
}

export function insertionData(text: string, bracketedPaste: boolean): Insertion {
  const clean = text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '')
  if (!clean.includes('\n')) return { data: clean, flattened: false }
  if (bracketedPaste) return { data: `${BRACKET_START}${clean.replace(/\n/g, '\r')}${BRACKET_END}`, flattened: false }
  const joined = clean
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return { data: joined, flattened: true }
}
