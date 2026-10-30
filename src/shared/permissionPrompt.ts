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
const ASKS = /Do you want to|Would you like to/i
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

export type PermissionOptionKind = 'once' | 'always' | 'deny' | 'other'

export interface PermissionOption {
  number: number
  label: string
  kind: PermissionOptionKind
}

export interface PermissionDetail {
  /** Bash, Edit, Write, Read, WebFetch or 'Requested action' when the prompt names no tool. */
  tool: string
  /** The command for Bash, the file for edits. Empty when the prompt does not show one. */
  target: string
  options: PermissionOption[]
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
const OPTION = /^[❯›>▸▶●◉]?\s*([1-9])[.)]\s+(.+)$/
const INLINE_CALL = /\b(Bash|Read|Edit|Write|Glob|Grep|NotebookEdit|WebFetch|WebSearch)\((.+)\)/
const HEADER_TOOLS: [RegExp, string][] = [
  [/^Bash command$/i, 'Bash'],
  [/^Edit file$/i, 'Edit'],
  [/^Create file$/i, 'Write'],
  [/^Write file$/i, 'Write'],
  [/^Read file$/i, 'Read'],
  [/^Fetch$/i, 'WebFetch']
]
const CODEX_TOOLS: [RegExp, string][] = [
  [/would you like to run the following command/i, 'Bash'],
  [/would you like to make the following edits/i, 'Edit']
]
const ALWAYS_LABEL = /don'?t ask again|do not ask again|this session|from now on|always|for these files|for commands that start/i
const DENY_LABEL = /^No\b|tell (?:Claude|Codex|Gemini)/i
const FILE_LINE = /^(.+?)\s*\(\+\d+\s+-\d+\)$/

function cleanTail(tail: string): string[] {
  return tail
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.replace(/\r/g, '').replace(BOX_EDGES, '').trim())
    .filter((line) => line !== '')
}

function optionKind(label: string): PermissionOptionKind {
  if (ALWAYS_LABEL.test(label)) return 'always'
  if (DENY_LABEL.test(label)) return 'deny'
  if (/^Yes\b/i.test(label)) return 'once'
  return 'other'
}

/** The numbered choices under the question: the last run that starts at "1.". */
function optionsOf(lines: string[]): PermissionOption[] {
  const start = lines.findLastIndex((line) => OPTION.exec(line)?.[1] === '1')
  if (start < 0) return []
  const options: { number: number; label: string }[] = []
  for (const line of lines.slice(start)) {
    const match = OPTION.exec(line)
    if (match && Number(match[1]) === options.length + 1) {
      options.push({ number: options.length + 1, label: match[2] })
    } else if (options.length > 0) {
      const last = options[options.length - 1]
      last.label = `${last.label} ${line}`
    }
  }
  return options.map(({ number, label }) => {
    const text = label.replace(/\s*\(\w+\)$/, '').trim()
    return { number, label: text, kind: optionKind(text) }
  })
}

function headerAt(lines: string[], question: number): { tool: string; target: string } | null {
  const head = lines.slice(0, Math.max(0, question))
  const index = head.findLastIndex((line) => HEADER_TOOLS.some(([pattern]) => pattern.test(line)))
  if (index >= 0) {
    const tool = HEADER_TOOLS.find(([pattern]) => pattern.test(head[index]))?.[1] ?? 'Requested action'
    return { tool, target: head[index + 1] ?? '' }
  }
  const codex = lines.findLastIndex((line) => CODEX_TOOLS.some(([pattern]) => pattern.test(line)))
  if (codex < 0) return null
  const tool = CODEX_TOOLS.find(([pattern]) => pattern.test(lines[codex]))?.[1] ?? 'Requested action'
  const after = lines.slice(codex + 1)
  const command = after.find((line) => line.startsWith('$ '))
  if (tool === 'Bash') return { tool, target: command ? command.slice(2).trim() : '' }
  const file = after.map((line) => FILE_LINE.exec(line)?.[1] ?? '').find((path) => path !== '')
  return { tool, target: file ?? '' }
}

/**
 * Reads the tool, the command or file, and the numbered choices from a permission prompt's screen text.
 * Handles Claude Code's "Bash command" and "Edit file" boxes and Codex's "run the following command" prompts.
 */
export function parsePermissionDetail(tail: string): PermissionDetail {
  const lines = cleanTail(tail)
  const question = lines.findLastIndex((line) => ASKS.test(line))
  const options = optionsOf(lines)
  const header = question >= 0 ? headerAt(lines, question) : null
  if (header) return { ...header, options }
  const inline = INLINE_CALL.exec(tail)
  if (inline) return { tool: inline[1], target: inline[2].trim(), options }
  return { tool: 'Requested action', target: '', options }
}
