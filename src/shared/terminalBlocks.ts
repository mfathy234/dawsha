import type { TabAgent } from './types'

export type BlockKind = 'prompt' | 'tool' | 'command' | 'reply' | 'question'
export type BlockStatus = 'ok' | 'failed' | 'running'

export interface BlockError {
  row: number
  text: string
}

export interface Block {
  kind: BlockKind
  title: string
  startRow: number
  endRow: number
  status: BlockStatus
  durationMs: number | null
  diff: boolean
  /** A short outcome for the row, such as "+6 −2". */
  detail: string | null
  errors: BlockError[]
}

/** One line the program printed: wrapped rows are already joined, `rows` says how many screen rows it takes. */
export interface BlockLine {
  row: number
  rows: number
  text: string
}

/** A command a shell integration marked: it starts a block at `row`. */
export interface ExternalCommand {
  row: number
  title: string
  exitCode?: number | null
}

export interface BlockOptions {
  agent?: TabAgent
  /** The agent is working, so the last block is still running. */
  running?: boolean
  /** Rows at or below this belong to the live area (input box, spinner) and are not part of any block. */
  liveFromRow?: number
  /** Rows where the user sent a prompt, from the prompt markers. */
  promptRows?: ReadonlySet<number>
  commands?: readonly ExternalCommand[]
}

const PROMPT_RE = /^\s{0,2}[>›❯]\s+(\S.*)$/
const OPTION_RE = /^\d+\.\s/
const SHELL_RE = /^\s{0,2}\$\s+(\S.*)$/
const CLAUDE_TOOL_RE = /^\s{0,2}[●⏺]\s+([A-Za-z_][\w:.-]*)\((.*)$/
const CLAUDE_SUMMARY_RE = /^\s{0,2}[●⏺]\s+((?:Read|Searched for|Searched|Listed|Fetched|Wrote|Created|Updated|Edited|Ran)\s+\d+.*)$/
const CLAUDE_REPLY_RE = /^\s{0,2}[●⏺]\s+(\S.*)$/
const CODEX_TOOL_RE = /^\s{0,2}•\s+(Ran|Edited|Added|Deleted|Explored|Read|Searched|Updated|Called|Applied|Listed|Viewed|Opened|Waited)\b\s*(.*)$/
const CODEX_REPLY_RE = /^\s{0,2}•\s+(\S.*)$/
const PATCH_RE = /^\s{0,4}(?:[•●]\s+)?(apply_patch\b.*)$/
const QUESTION_RE = /^[\s│]*((?:Do you want to|Would you like to)\b.*\?)[\s│]*$/
const DIFF_TITLE_RE = /^(Update|Edit|MultiEdit|Write|Create|Edited|Added|Deleted|Applied|apply_patch)\b/
const HUNK_RE = /^\s*@@ /
const ADD_RE = /^\s*\d*\s*\+(?!\+\+)/
const DEL_RE = /^\s*\d*\s*-(?!--)/
const ERROR_RE = /✗|✘|\bFAIL(?:ED)?\b|\b[Ee]rror:|\bTraceback \(most recent|\bAssertionError\b|\bExit code [1-9]\d*|\bCommand failed\b|\bpanic:|\b(?:Type|Reference|Syntax)Error\b|\b[1-9]\d* (?:failed|failing|errors?)\b|^\s*at\s.+:\d+:\d+\)?\s*$/
const FRAME_RE = /^\s*(?:at\s|File ")/
const DURATION_RE = /(?:\bDuration\s+|\(|·\s*|\bin\s+|\btook\s+)(\d+(?:\.\d+)?)\s*(ms|s|m)\b/
const TITLE_MAX = 90
const ERRORS_KEPT = 4

const clip = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean
}

interface Start {
  kind: BlockKind
  title: string
  exitCode?: number | null
}

function claudeStart(text: string): Start | null {
  const tool = CLAUDE_TOOL_RE.exec(text)
  if (tool) {
    const arg = tool[2].replace(/\)\s*$/, '')
    return { kind: 'tool', title: clip(tool[1] === 'Bash' ? arg : `${tool[1]} ${arg}`) }
  }
  const summary = CLAUDE_SUMMARY_RE.exec(text)
  if (summary) return { kind: 'tool', title: clip(summary[1].replace(/\s*\(ctrl\+o.*$/i, '')) }
  const reply = CLAUDE_REPLY_RE.exec(text)
  return reply ? { kind: 'reply', title: clip(reply[1]) } : null
}

function codexStart(text: string): Start | null {
  const tool = CODEX_TOOL_RE.exec(text)
  if (tool) return { kind: 'tool', title: clip(tool[1] === 'Ran' ? tool[2] : `${tool[1]} ${tool[2]}`) }
  const patch = PATCH_RE.exec(text)
  if (patch) return { kind: 'tool', title: clip(patch[1]) }
  const reply = CODEX_REPLY_RE.exec(text)
  return reply ? { kind: 'reply', title: clip(reply[1]) } : null
}

function classify(line: BlockLine, options: BlockOptions, external: Map<number, ExternalCommand>): Start | null {
  const command = external.get(line.row)
  if (command) return { kind: 'command', title: clip(command.title), exitCode: command.exitCode }
  if (options.promptRows?.has(line.row)) return { kind: 'prompt', title: clip(line.text.replace(PROMPT_RE, '$1').replace(/^[\s>›❯$]+/, '')) }
  const question = QUESTION_RE.exec(line.text)
  if (question) return { kind: 'question', title: clip(question[1]) }
  const prompt = PROMPT_RE.exec(line.text)
  if (prompt && !OPTION_RE.test(prompt[1])) return { kind: 'prompt', title: clip(prompt[1]) }
  const found = claudeStart(line.text) ?? codexStart(line.text)
  if (found) return found
  const shell = options.agent === 'shell' ? SHELL_RE.exec(line.text) : null
  return shell ? { kind: 'command', title: clip(shell[1]) } : null
}

const seconds = (value: string, unit: string): number => {
  const n = Number(value)
  return unit === 'ms' ? n : unit === 'm' ? n * 60_000 : n * 1000
}

export function parseDuration(text: string): number | null {
  const found = DURATION_RE.exec(text)
  return found ? Math.round(seconds(found[1], found[2])) : null
}

function errorsOf(lines: BlockLine[]): BlockError[] {
  const hits = lines.filter((line) => ERROR_RE.test(line.text))
  const messages = hits.filter((line) => !FRAME_RE.test(line.text))
  const picked = (messages.length > 0 ? [...messages, ...hits.filter((line) => FRAME_RE.test(line.text)).slice(0, 1)] : hits).slice(0, ERRORS_KEPT)
  return picked.map((line) => ({ row: line.row, text: clip(line.text.replace(/^[\s⎿└│]+/, '')) }))
}

function diffDetail(lines: BlockLine[]): string | null {
  const added = lines.filter((line) => ADD_RE.test(line.text)).length
  const removed = lines.filter((line) => DEL_RE.test(line.text)).length
  return added + removed === 0 ? null : `+${added} −${removed}`
}

function finish(start: Start, lines: BlockLine[], running: boolean): Block {
  const body = start.kind === 'prompt' || start.kind === 'reply' ? [] : lines.slice(1)
  const last = lines[lines.length - 1]
  const errors = errorsOf(body)
  const failedExit = start.exitCode !== undefined && start.exitCode !== null && start.exitCode !== 0
  const diff = DIFF_TITLE_RE.test(start.title) || body.some((line) => HUNK_RE.test(line.text))
  const tail = lines.slice(-4).map((line) => line.text).join('\n')
  const status: BlockStatus = running ? 'running' : errors.length > 0 || failedExit ? 'failed' : 'ok'
  return {
    kind: start.kind,
    title: start.title,
    startRow: lines[0].row,
    endRow: last.row + last.rows - 1,
    status,
    durationMs: start.kind === 'tool' || start.kind === 'command' ? parseDuration(`${start.title}\n${tail}`) : null,
    diff,
    detail: diff ? diffDetail(body) : null,
    errors
  }
}

const trimBlank = (lines: BlockLine[]): BlockLine[] => {
  let end = lines.length
  while (end > 1 && lines[end - 1].text.trim() === '') end -= 1
  return lines.slice(0, end)
}

/** Splits a session's lines into blocks: your prompts, the agent's tool calls and replies, shell commands and permission questions. */
export function parseBlocks(lines: readonly BlockLine[], options: BlockOptions = {}): Block[] {
  const external = new Map((options.commands ?? []).map((command) => [command.row, command]))
  const limit = options.liveFromRow ?? Number.POSITIVE_INFINITY
  const blocks: Block[] = []
  let start: Start | null = null
  let current: BlockLine[] = []
  const close = (): void => {
    if (start && current.length > 0) blocks.push(finish(start, trimBlank(current), false))
    start = null
    current = []
  }
  for (const line of lines) {
    if (line.row >= limit) break
    const next = classify(line, options, external)
    if (next) {
      close()
      start = next
    }
    if (start) current.push(line)
  }
  close()
  if (options.running === true && blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    blocks[blocks.length - 1] = { ...last, status: 'running' }
  }
  return blocks
}

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const total = ms / 1000
  if (total < 10) return `${total.toFixed(1)}s`
  if (total < 60) return `${Math.round(total)}s`
  const minutes = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

export const blockRowCount = (block: Block): number => block.endRow - block.startRow + 1

export const blockCountLabel = (block: Block): string => {
  const rows = blockRowCount(block)
  return `${rows} ${rows === 1 ? 'line' : 'lines'}`
}

/** The block a row falls in, or the closest one above it. */
export function blockAtRow(blocks: readonly Block[], row: number): Block | null {
  let found: Block | null = null
  for (const block of blocks) {
    if (block.startRow > row) break
    found = block
  }
  return found
}

/** The next or previous block start away from `row`, for Alt+Up and Alt+Down. */
export function stepBlock(blocks: readonly Block[], row: number, direction: 1 | -1): Block | null {
  if (direction === 1) return blocks.find((block) => block.startRow > row) ?? null
  return [...blocks].reverse().find((block) => block.startRow < row) ?? null
}

/** Whether the viewport top sits inside a block taller than the viewport, and how far in. */
export function longBlockPosition(blocks: readonly Block[], top: number, rows: number): { block: Block; line: number } | null {
  const block = blockAtRow(blocks, top)
  if (!block || top > block.endRow || blockRowCount(block) <= rows) return null
  return { block, line: top - block.startRow + 1 }
}

/** The prompt block that the output on screen answers: the closest prompt at or above the row. */
export function promptAboveRow(blocks: readonly Block[], row: number): Block | null {
  let found: Block | null = null
  for (const block of blocks) {
    if (block.startRow > row) break
    if (block.kind === 'prompt') found = block
  }
  return found
}

export function blockMarkdown(block: Block, text: string): string {
  if (block.kind === 'prompt') return `> ${text.trim()}`
  if (block.kind === 'reply' || block.kind === 'question') return text.trim()
  const fence = text.includes('```') ? '````' : '```'
  return `${fence}${block.diff ? 'diff' : ''}\n${text.replace(/\s+$/, '')}\n${fence}`
}

export const OUTLINE_KINDS: readonly BlockKind[] = ['prompt', 'tool', 'command', 'question']

export interface OutlineEntry {
  key: string
  row: number
  kind: BlockKind | 'error'
  title: string
  status: BlockStatus
  detail: string | null
  block: Block
}

/** What the outline lists: your prompts, each command with its outcome, each error and each question. */
export function outlineEntries(blocks: readonly Block[]): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const block of blocks) {
    if (!OUTLINE_KINDS.includes(block.kind)) continue
    const detail = block.detail ?? (block.durationMs !== null ? formatDuration(block.durationMs) : null)
    entries.push({ key: `b${block.startRow}`, row: block.startRow, kind: block.kind, title: block.title, status: block.status, detail, block })
    const first = block.errors[0]
    if (first && block.kind !== 'prompt') {
      entries.push({ key: `e${first.row}`, row: first.row, kind: 'error', title: first.text, status: 'failed', detail: null, block })
    }
  }
  return entries
}

export function filterOutline(entries: readonly OutlineEntry[], query: string): OutlineEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...entries]
  return entries.filter((entry) => {
    const hay = `${entry.title} ${entry.kind} ${entry.status} ${entry.detail ?? ''}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
}

/** A failure block as one message for another session: the block text plus the first file:line it names. */
export function failureMessage(block: Block, text: string): string {
  const location = /([\w./\\-]+\.\w+):(\d+)(?::\d+)?/.exec(block.errors.map((error) => error.text).join('\n') + '\n' + text)
  const where = location ? `\nLocation: ${location[1]}:${location[2]}` : ''
  return `This failed:\n\n${blockMarkdown(block, text)}${where}`
}
