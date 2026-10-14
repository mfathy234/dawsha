const OPTION_YES = /\b1\.\s+Yes\b/
const OPTION_NO = /\b\d\.\s+No\b/
const HINT = /Do you want to|Esc to cancel/i
const TAIL_LINES = 18

export function detectPermissionPrompt(tail: string): boolean {
  const text = tail
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-TAIL_LINES)
    .join('\n')
  return OPTION_YES.test(text) && (OPTION_NO.test(text) || HINT.test(text))
}

const QUESTION = /Do you want to/i
const BOX_EDGES = /^[\s│┃|╭╮╰╯─━]+|[\s│┃|╭╮╰╯─━]+$/g
const MAX_PROMPT_CHARS = 160

export function permissionPromptText(tail: string): string {
  const lines = tail
    .split('\n')
    .map((line) => line.replace(BOX_EDGES, ''))
    .filter((line) => line !== '')
  const question = lines.findLastIndex((line) => QUESTION.test(line))
  if (question < 1) return ''
  const text = lines[question - 1]
  return text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS - 1)}…` : text
}
