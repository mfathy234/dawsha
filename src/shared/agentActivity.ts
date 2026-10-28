import { flattenText, realPrompt } from './sessionText'

type Rec = Record<string, unknown>

export type BgChange = 'A' | 'M' | 'D'

export interface BgToolCall {
  at: number | null
  name: string
  brief: string
}

export interface BgFileTouch {
  path: string
  change: BgChange
  added: number | null
  removed: number | null
}

/** What the transcript shows an agent was asked and did, beyond its status. */
export interface AgentActivity {
  prompt: string
  tools: BgToolCall[]
  files: BgFileTouch[]
}

export const TOOL_CALLS_KEPT = 8
export const FILES_KEPT = 40
const PROMPT_MAX = 1600
const BRIEF_MAX = 140

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const time = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(ms) ? null : ms
}
const lineCount = (text: unknown): number => (typeof text === 'string' && text !== '' ? text.replace(/\n$/, '').split('\n').length : 0)

/** One tool call as a short line: its most telling argument. */
export function briefInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!isRec(input)) return ''
  for (const key of ['command', 'cmd', 'file_path', 'path', 'notebook_path', 'pattern', 'query', 'url', 'description', 'prompt', 'message']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ')
  }
  return Object.values(input).find((value): value is string => typeof value === 'string') ?? ''
}

const clip = (text: string, limit: number): string => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`)

const toolCall = (at: number | null, name: string, input: unknown): BgToolCall => ({ at, name, brief: clip(flattenText(briefInput(input)), BRIEF_MAX) })

/** Several edits to one file become one row: the first change decides A, a later delete wins, a re-created file is M. */
export function mergeFiles(touches: readonly BgFileTouch[]): BgFileTouch[] {
  const byPath = new Map<string, BgFileTouch>()
  for (const touch of touches) {
    const prev = byPath.get(touch.path)
    if (!prev) {
      byPath.set(touch.path, touch)
      continue
    }
    const change: BgChange = touch.change === 'D' ? 'D' : prev.change === 'D' ? 'M' : prev.change === 'A' ? 'A' : 'M'
    const sum = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0))
    byPath.set(touch.path, { path: touch.path, change, added: sum(prev.added, touch.added), removed: sum(prev.removed, touch.removed) })
  }
  return [...byPath.values()].slice(0, FILES_KEPT)
}

const deletedBy = (command: string): string[] => {
  const match = /^\s*(?:git\s+)?rm\s+(.+?)\s*(?:$|&&|;|\|)/.exec(command)
  if (!match) return []
  return match[1].split(/\s+/).filter((part) => part !== '' && !part.startsWith('-')).map((part) => part.replace(/^['"]|['"]$/g, ''))
}

function claudeTouches(name: string, input: unknown): BgFileTouch[] {
  if (!isRec(input)) return []
  const path = str(input.file_path) ?? str(input.notebook_path)
  if (name === 'Write' && path) return [{ path, change: 'A', added: lineCount(input.content), removed: 0 }]
  if (name === 'Edit' && path) return [{ path, change: 'M', added: lineCount(input.new_string), removed: lineCount(input.old_string) }]
  if (name === 'MultiEdit' && path && Array.isArray(input.edits)) {
    const edits = input.edits.filter(isRec)
    return [{ path, change: 'M', added: edits.reduce((n, edit) => n + lineCount(edit.new_string), 0), removed: edits.reduce((n, edit) => n + lineCount(edit.old_string), 0) }]
  }
  if (name === 'NotebookEdit' && path) return [{ path, change: 'M', added: null, removed: null }]
  if (name === 'Bash') return deletedBy(str(input.command) ?? '').map((target) => ({ path: target, change: 'D', added: null, removed: null }))
  return []
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (isRec(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')).filter(Boolean).join('\n')
}

function cleanPrompt(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim()
  return clip(text, PROMPT_MAX)
}

/** `records` is every parsed line from the head and tail samples, in order; the prompt comes from the first user turn. */
export function claudeActivity(records: readonly Rec[]): AgentActivity {
  let prompt = ''
  const tools: BgToolCall[] = []
  const touches: BgFileTouch[] = []
  for (const record of records) {
    if (!isRec(record.message)) continue
    if (record.type === 'user' && !prompt) {
      const text = textOf(record.message.content)
      if (text.trim() && !/^<(?:system-reminder|command-)/.test(text.trim())) prompt = cleanPrompt(text)
      continue
    }
    if (record.type !== 'assistant' || !Array.isArray(record.message.content)) continue
    for (const block of record.message.content) {
      if (!isRec(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue
      tools.push(toolCall(time(record.timestamp), block.name, block.input))
      touches.push(...claudeTouches(block.name, block.input))
    }
  }
  return { prompt, tools: tools.slice(-TOOL_CALLS_KEPT).reverse(), files: mergeFiles(touches) }
}

/** Reads "*** Add File: x / *** Update File: y / *** Delete File: z" patches, counting added and removed lines. */
export function patchTouches(patch: string): BgFileTouch[] {
  const out: BgFileTouch[] = []
  let current: BgFileTouch | null = null
  for (const line of patch.split('\n')) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+?)\s*$/.exec(line)
    if (header) {
      current = { path: header[2], change: header[1] === 'Add' ? 'A' : header[1] === 'Delete' ? 'D' : 'M', added: 0, removed: 0 }
      out.push(current)
      continue
    }
    if (!current || line.startsWith('***') || line.startsWith('@@')) continue
    if (line.startsWith('+')) current.added = (current.added ?? 0) + 1
    else if (line.startsWith('-')) current.removed = (current.removed ?? 0) + 1
  }
  return out.map((touch) => (touch.change === 'D' ? { ...touch, added: null, removed: null } : touch))
}

function codexUserPrompt(payload: Rec): string {
  if (payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) return ''
  for (const block of payload.content) {
    if (isRec(block) && typeof block.text === 'string' && realPrompt(block.text)) return cleanPrompt(block.text)
  }
  return ''
}

export function codexActivity(records: readonly Rec[]): AgentActivity {
  let prompt = ''
  const tools: BgToolCall[] = []
  const touches: BgFileTouch[] = []
  for (const record of records) {
    const payload = isRec(record.payload) ? record.payload : null
    if (record.type !== 'response_item' || !payload) continue
    if (!prompt) prompt = codexUserPrompt(payload)
    if ((payload.type !== 'function_call' && payload.type !== 'custom_tool_call') || typeof payload.name !== 'string') continue
    let args: unknown = payload.arguments ?? payload.input
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        // Plain text arguments (an apply_patch body) stay as they are.
      }
    }
    const text = typeof args === 'string' ? args : JSON.stringify(args ?? '')
    const patch = text.includes('*** Begin Patch') ? (typeof args === 'string' ? args : (isRec(args) ? (Array.isArray(args.command) ? args.command.join('\n') : str(args.input) ?? str(args.patch) ?? '') : '')) : ''
    if (patch) touches.push(...patchTouches(patch))
    tools.push(toolCall(time(record.timestamp), payload.name, patch ? { path: patchTouches(patch).map((touch) => touch.path).join(', ') } : args))
  }
  return { prompt, tools: tools.slice(-TOOL_CALLS_KEPT).reverse(), files: mergeFiles(touches) }
}
