import type { AskOption, AskPrompt, AskQuestion } from './chatAsk'
import type { ChatItem } from './chatLog'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const EDGES = /^[\s│┃|╭╮╰╯]+|[\s│┃|╭╮╰╯]+$/g
const OPTION = /^[❯›>▸▶●◉]?\s*(\d{1,2})[.)]\s+(.+)$/
const RULE_LINE = /^[\s─━═\-_]*$/
const HINT = /(?:enter|return)\s+to\s+\w+|esc(?:ape)?\s+to\s+\w+|[↑↓]\s*\/?\s*[↑↓]|arrow\s+keys/i
const OTHER_LABEL = /^(?:type something|other|something else|type your own|enter your own)\b/i
const SKIP_LABEL = /^chat about this$/i
/** A picker is only drawn in chat when it asks something; a list titled "Select model" stays in the terminal. */
const ASKS = /[?؟:]\s*$/
const QUESTION_TABS = /^[←→\s☐☒✔✓]+/
const OPTIONS_MAX = 12
const NAMES_MAX = 160

function cleanLines(tail: string): string[] {
  return tail
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.replace(/\r/g, '').replace(EDGES, '').trimEnd())
    .filter((line) => line.trim() !== '' && !RULE_LINE.test(line))
}

interface Row {
  index: number
  number: number
  label: string
}

/** The last run of rows numbered 1, 2, 3 … in the lines; lines between rows (an option's description) are skipped. */
function lastRun(lines: readonly string[]): Row[] {
  const rows: Row[] = []
  lines.forEach((line, index) => {
    const match = OPTION.exec(line.trim())
    if (match) rows.push({ index, number: Number(match[1]), label: match[2].trim() })
  })
  const start = rows.findLastIndex((row) => row.number === 1)
  if (start < 0) return []
  const run: Row[] = []
  for (const row of rows.slice(start)) {
    if (row.number !== run.length + 1) break
    run.push(row)
  }
  return run
}

function describe(lines: readonly string[], row: Row, next: Row | undefined): string {
  const end = next ? next.index : lines.length
  return lines
    .slice(row.index + 1, end)
    .filter((line) => !HINT.test(line))
    .map((line) => line.trim())
    .join(' ')
    .slice(0, NAMES_MAX * 2)
}

function questionBefore(lines: readonly string[], first: Row): string {
  for (let at = first.index - 1; at >= 0; at -= 1) {
    const text = lines[at].trim().replace(QUESTION_TABS, '')
    if (text !== '' && !HINT.test(text)) return text.slice(0, NAMES_MAX * 3)
  }
  return ''
}

/**
 * Reads a numbered picker from the screen text: its question and the rows a number key chooses.
 * Null when there are fewer than two numbered rows, which is a menu chat has no way to draw (a /model list, a settings screen).
 */
export function parseMenuPrompt(tail: string): AskPrompt | null {
  const lines = cleanLines(tail)
  const run = lastRun(lines)
  if (run.length < 2 || run.length > OPTIONS_MAX) return null
  const options: AskOption[] = run
    .map((row, at) => ({ number: row.number, label: row.label, description: describe(lines, row, run[at + 1]) }))
    .filter((option) => !SKIP_LABEL.test(option.label))
  const other = options.find((option) => OTHER_LABEL.test(option.label))
  const choices = options.filter((option) => option !== other)
  if (choices.length < 2) return null
  const asked = questionBefore(lines, run[0])
  if (!ASKS.test(asked)) return null
  const question: AskQuestion = {
    header: '',
    question: asked,
    multiSelect: false,
    options: choices,
    otherNumber: other ? other.number : null
  }
  return { id: `screen:${question.question}|${choices.map((option) => option.label).join('|')}`, questions: [question] }
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** The first label's start is enough to tell the picker on screen is this call's, however the label wraps. */
function onScreen(prompt: AskPrompt, tail: string): boolean {
  const screen = squash(tail.replace(ANSI, ''))
  const label = prompt.questions[0]?.options[0]?.label ?? ''
  return label !== '' && screen.includes(squash(label).slice(0, 24))
}

/** The question the agent logged and is still waiting on, when the picker on screen is its own. */
function loggedPrompt(items: readonly ChatItem[], tail: string): AskPrompt | null {
  const last = items[items.length - 1]
  if (last?.kind !== 'tool' || last.done || !last.ask || last.ask.length === 0) return null
  const prompt: AskPrompt = { id: last.id, questions: last.ask }
  return onScreen(prompt, tail) ? prompt : null
}

/** What chat can ask the user right now: the logged AskUserQuestion when it is the one on screen, else the numbered rows on screen. */
export function askPromptFor(items: readonly ChatItem[], tail: string): AskPrompt | null {
  return loggedPrompt(items, tail) ?? parseMenuPrompt(tail)
}

/** The row to press to confirm a review screen ("Submit answers"), from the screen text. */
export function submitRowNumber(tail: string): number | null {
  const row = lastRun(cleanLines(tail)).find((candidate) => /^submit\b/i.test(candidate.label))
  return row ? row.number : null
}
