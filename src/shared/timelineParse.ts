import { changeFromEdit, changeFromPatch, type EditChange } from './editChange'
import { isTestCommand, parseTestCounts, testSummary } from './testRun'
import { readText, type TimelineEvent, type TimelineKind } from './timeline'
import { codexOutput, geminiResult, type Outcome } from './timelineOutcome'
import {
  asTime,
  blockText,
  cleanText,
  codexTool,
  flat,
  geminiMessages,
  isPrompt,
  isRecord,
  records,
  type Json
} from './transcript'

export const PROMPT_MAX = 500
export const REPLY_MAX = 220
const ERROR_MAX = 200
type Draft = Omit<TimelineEvent, 'id'>

interface EditPart {
  path: string
  added: number
  removed: number
}

type Tool =
  | { kind: 'read'; paths: string[] }
  | { kind: 'edit'; edits: EditPart[] }
  | { kind: 'command'; command: string }

const EDIT_TOOLS = new Set([
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'replace',
  'write_file',
  'edit_file',
  'create_file',
  'str_replace_editor',
  'str_replace_based_edit_tool'
])
const PATCH_TOOLS = new Set(['apply_patch', 'applypatch'])
const READ_TOOLS = new Set([
  'read',
  'notebookread',
  'glob',
  'grep',
  'ls',
  'read_file',
  'read_many_files',
  'list_directory',
  'search_file_content',
  'grep_search',
  'view'
])
const COMMAND_TOOLS = new Set(['bash', 'shell', 'run_shell_command', 'exec_command', 'local_shell', 'shell_command', 'execute_bash', 'powershell'])
const WRAPPER = /^(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?$/i
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export function lineCount(text: string): number {
  if (text === '') return 0
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length
}

function inputPath(input: Json): string {
  for (const key of ['file_path', 'path', 'absolute_path', 'notebook_path', 'filePath', 'dir_path']) {
    const value = str(input[key])
    if (value !== '') return value
  }
  return ''
}

function commandText(input: unknown): string {
  if (typeof input === 'string') return input
  if (!isRecord(input)) return ''
  const value = input.command ?? input.cmd
  if (Array.isArray(value)) {
    const parts = value.map(String)
    if (parts.length >= 3 && WRAPPER.test(parts[0]) && parts[1].startsWith('-')) return parts[parts.length - 1]
    return parts.join(' ')
  }
  return str(value)
}

/** Files, added lines and removed lines named by an apply_patch body. */
export function parsePatch(patch: string): EditPart[] {
  const parts: EditPart[] = []
  let current: EditPart | null = null
  for (const line of patch.split(/\r?\n/)) {
    const header = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/.exec(line)
    if (header) {
      current = { path: header[1].trim(), added: 0, removed: 0 }
      parts.push(current)
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) current.added += 1
    else if (current && line.startsWith('-') && !line.startsWith('---')) current.removed += 1
  }
  return parts
}

function editParts(name: string, input: Json): EditPart[] {
  const path = inputPath(input)
  if (path === '') return []
  const pair = (source: Json): { added: number; removed: number } => ({
    added: lineCount(str(source.new_string ?? source.newString ?? source.new_str ?? source.new_source)),
    removed: lineCount(str(source.old_string ?? source.oldString ?? source.old_str))
  })
  if (Array.isArray(input.edits)) {
    const sums = input.edits.filter(isRecord).map(pair)
    return [{ path, added: sums.reduce((n, p) => n + p.added, 0), removed: sums.reduce((n, p) => n + p.removed, 0) }]
  }
  const content = input.content ?? input.file_text
  if (typeof content === 'string' && (name === 'write' || name.startsWith('write') || name === 'create_file' || name.includes('replace_editor'))) {
    return [{ path, added: lineCount(content), removed: 0 }]
  }
  return [{ path, ...pair(input) }]
}

function patchBody(input: unknown): string {
  if (typeof input === 'string') return input
  if (!isRecord(input)) return ''
  return str(input.input ?? input.patch ?? input.diff)
}

/** The text each edit of a tool call wrote, in the order classifyTool lists its files. */
export function toolChanges(rawName: unknown, input: unknown): Array<EditChange | undefined> {
  const name = (typeof rawName === 'string' ? rawName : '').toLowerCase()
  const fields = isRecord(input) ? input : {}
  if (PATCH_TOOLS.has(name)) return changeFromPatch(patchBody(input))
  if (EDIT_TOOLS.has(name)) return [changeFromEdit(name, fields)]
  if (COMMAND_TOOLS.has(name)) {
    const command = commandText(input)
    return command.includes('*** Begin Patch') ? changeFromPatch(command) : []
  }
  return []
}

/** What a tool call does to the timeline: reads, edits, a command, or nothing worth showing. */
export function classifyTool(rawName: unknown, input: unknown): Tool | null {
  const name = (typeof rawName === 'string' ? rawName : '').toLowerCase()
  const fields = isRecord(input) ? input : {}
  if (PATCH_TOOLS.has(name)) {
    const edits = parsePatch(patchBody(input))
    return edits.length > 0 ? { kind: 'edit', edits } : null
  }
  if (EDIT_TOOLS.has(name)) {
    const edits = editParts(name, fields)
    return edits.length > 0 ? { kind: 'edit', edits } : null
  }
  if (READ_TOOLS.has(name)) {
    const list = Array.isArray(fields.paths) ? fields.paths.map(String) : []
    const path = inputPath(fields) || str(fields.pattern)
    const paths = list.length > 0 ? list : path ? [path] : []
    return paths.length > 0 ? { kind: 'read', paths } : null
  }
  if (COMMAND_TOOLS.has(name)) {
    const command = commandText(input).trim()
    if (command === '') return null
    if (command.includes('*** Begin Patch')) {
      const edits = parsePatch(command)
      if (edits.length > 0) return { kind: 'edit', edits }
    }
    return { kind: 'command', command }
  }
  return null
}

interface Pending {
  firstIndex: number
  count: number
  command?: string
  tool: Tool['kind']
}

class Builder {
  readonly drafts: Draft[] = []
  private readonly pending = new Map<string, Pending>()

  push(draft: Draft): number {
    this.drafts.push(draft)
    return this.drafts.length - 1
  }

  note(at: number | undefined, kind: TimelineKind, text: string, extra: Partial<Draft> = {}): void {
    if (at === undefined) return
    const body = cleanText(text).replace(/\s+/g, ' ').trim()
    if (body !== '') this.push({ at, kind, text: body, ...extra })
  }

  call(at: number | undefined, callId: string | undefined, name: unknown, input: unknown): void {
    const tool = at === undefined ? null : classifyTool(name, input)
    if (at === undefined || !tool) return
    const firstIndex = this.drafts.length
    if (tool.kind === 'read') {
      this.push({ at, kind: 'read', text: readText(tool.paths), paths: tool.paths })
    } else if (tool.kind === 'edit') {
      const changes = toolChanges(name, input)
      tool.edits.forEach((part, index) => {
        const change = changes[index]
        this.push({ at, kind: 'edit', editStatus: 'pending', text: part.path, path: part.path, added: part.added, removed: part.removed, ...(change ? { change } : {}) })
      })
    } else if (isTestCommand(tool.command)) {
      this.push({ at, kind: 'test', text: 'ran', command: flat(tool.command, 160) })
    } else {
      this.push({ at, kind: 'command', text: flat(tool.command, 160), command: flat(tool.command, 160) })
    }
    if (callId) {
      this.pending.set(callId, { firstIndex, count: this.drafts.length - firstIndex, command: tool.kind === 'command' ? tool.command : undefined, tool: tool.kind })
    }
  }

  result(at: number | undefined, callId: string | undefined, outcome: Outcome): void {
    const pending = callId ? this.pending.get(callId) : undefined
    if (!pending) return
    this.pending.delete(callId as string)
    const draft = this.drafts[pending.firstIndex]
    if (pending.tool === 'edit' && outcome.patch && pending.count === 1) {
      const counts = patchCounts(outcome.patch)
      this.drafts[pending.firstIndex] = { ...draft, added: counts.added, removed: counts.removed }
    }
    if (pending.tool === 'edit') {
      const failed = outcome.failed || (outcome.exitCode !== undefined && outcome.exitCode !== 0)
      for (let index = pending.firstIndex; index < pending.firstIndex + pending.count; index++) {
        this.drafts[index] = { ...this.drafts[index], editStatus: failed ? 'failed' : 'succeeded', editCompletedAt: at }
      }
    }
    if (draft.kind === 'test') {
      const counts = parseTestCounts(outcome.output)
      const ok = outcome.exitCode !== undefined ? outcome.exitCode === 0 && (counts?.failed ?? 0) === 0 : !outcome.failed && (counts?.failed ?? 0) === 0
      this.drafts[pending.firstIndex] = { ...draft, ...counts, ok, text: testSummary(counts ?? {}, ok) }
    } else if (draft.kind === 'command' && outcome.exitCode !== undefined) {
      this.drafts[pending.firstIndex] = { ...draft, ok: outcome.exitCode === 0 }
    } else if (outcome.failed && at !== undefined && draft.kind !== 'edit') {
      this.note(at, 'error', firstLine(outcome.output) || 'The tool call failed', {})
    } else if (outcome.failed && at !== undefined) {
      this.note(at, 'error', `Could not edit ${draft.path ?? 'a file'}`)
    }
  }
}
function firstLine(text: string): string {
  const line = cleanText(text)
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '')
  return line ? flat(line, ERROR_MAX) : ''
}
function patchCounts(hunks: Json[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    if (!Array.isArray(hunk.lines)) continue
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

const finish = (builder: Builder): TimelineEvent[] =>
  builder.drafts.map((draft, index) => ({ ...draft, id: `${index}` })).sort((a, b) => a.at - b.at)

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  return blockText(content, ['text'])
}

function claudeRecord(builder: Builder, record: Json): void {
  {
    if (record.isSidechain === true) return
    const at = asTime(record.timestamp)
    const message = isRecord(record.message) ? record.message : {}
    const content = message.content
    if (record.type === 'user' && record.isMeta !== true) {
      const prompt = blockText(content, ['text'])
      if (isPrompt(prompt)) builder.note(at, 'prompt', prompt.length > PROMPT_MAX ? flat(prompt, PROMPT_MAX) : prompt)
      if (!Array.isArray(content)) return
      const patch = isRecord(record.toolUseResult) && Array.isArray(record.toolUseResult.structuredPatch) ? record.toolUseResult.structuredPatch.filter(isRecord) : undefined
      for (const part of content) {
        if (!isRecord(part) || part.type !== 'tool_result') continue
        builder.result(at, str(part.tool_use_id), {
          output: resultText(part.content),
          failed: part.is_error === true,
          patch
        })
      }
    } else if (record.type === 'assistant') {
      if (typeof content === 'string') builder.note(at, 'reply', flat(content, REPLY_MAX))
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (!isRecord(part)) continue
          if (part.type === 'text' && typeof part.text === 'string') builder.note(at, 'reply', flat(part.text, REPLY_MAX))
          else if (part.type === 'tool_use') builder.call(at, str(part.id), part.name, part.input)
        }
      }
    }
  }
}

const hasConversationEvents = (all: Json[]): boolean =>
  all.some((r) => r.type === 'event_msg' && isRecord(r.payload) && (r.payload.type === 'user_message' || r.payload.type === 'agent_message'))

function codexRecord(builder: Builder, record: Json, hasEvents: boolean): void {
  {
    const payload = isRecord(record.payload) ? record.payload : {}
    const at = asTime(record.timestamp)
    if (record.type === 'event_msg') {
      const message = str(payload.message)
      if (hasEvents && payload.type === 'user_message' && isPrompt(message)) builder.note(at, 'prompt', flat(message, PROMPT_MAX))
      else if (hasEvents && payload.type === 'agent_message') builder.note(at, 'reply', flat(message, REPLY_MAX))
      else if (payload.type === 'error') builder.note(at, 'error', flat(message, ERROR_MAX))
      return
    }
    if (record.type !== 'response_item') return
    if (payload.type === 'message' && !hasEvents) {
      const role = payload.role === 'user' ? 'prompt' : payload.role === 'assistant' ? 'reply' : null
      const body = blockText(payload.content, ['input_text', 'output_text'])
      if (role === 'reply') builder.note(at, 'reply', flat(body, REPLY_MAX))
      else if (role === 'prompt' && isPrompt(body)) builder.note(at, 'prompt', flat(body, PROMPT_MAX))
      return
    }
    const tool = codexTool(payload)
    if (tool) {
      builder.call(at, str(payload.call_id ?? payload.id), tool.name, tool.input)
      return
    }
    if (typeof payload.type === 'string' && payload.type.endsWith('_output')) {
      builder.result(at, str(payload.call_id), codexOutput(payload.output))
    }
  }
}

export function parseGeminiTimeline(text: string): TimelineEvent[] {
  const builder = new Builder()
  const { messages } = geminiMessages(text)
  messages.forEach((message, messageIndex) => {
    const at = asTime(message.timestamp)
    const body = blockText(message.content, ['text']).trim()
    if (message.type === 'user' && body && !body.startsWith('/') && !body.startsWith('?')) builder.note(at, 'prompt', flat(body, PROMPT_MAX))
    if (message.type !== 'gemini') return
    if (body) builder.note(at, 'reply', flat(body, REPLY_MAX))
    if (!Array.isArray(message.toolCalls)) return
    message.toolCalls.forEach((call, callIndex) => {
      if (!isRecord(call)) return
      const when = asTime(call.timestamp) ?? at
      const id = `g${messageIndex}-${callIndex}`
      builder.call(when, id, call.name ?? call.displayName, call.args)
      if (['success', 'error', 'cancelled'].includes(str(call.status))) builder.result(when, id, geminiResult(call))
    })
  })
  return finish(builder)
}

/** Reads an append-only log in pieces. Tool results can arrive in a later piece than their call, so the parser keeps its state between pieces. */
export interface TimelineParser {
  /** Adds whole lines of log text. */
  feed(text: string): void
  events(): TimelineEvent[]
}

export function createLineParser(agent: 'claude' | 'codex'): TimelineParser {
  const builder = new Builder()
  let hasEvents = false
  return {
    feed(text) {
      const all = records(text)
      if (agent === 'claude') {
        for (const record of all) claudeRecord(builder, record)
        return
      }
      hasEvents = hasEvents || hasConversationEvents(all)
      for (const record of all) codexRecord(builder, record, hasEvents)
    },
    events: () => finish(builder)
  }
}

export function parseClaudeTimeline(text: string): TimelineEvent[] {
  const parser = createLineParser('claude')
  parser.feed(text)
  return parser.events()
}

export function parseCodexTimeline(text: string): TimelineEvent[] {
  const parser = createLineParser('codex')
  parser.feed(text)
  return parser.events()
}

export function parseTimeline(agent: 'claude' | 'codex' | 'gemini', text: string): TimelineEvent[] {
  if (agent === 'claude') return parseClaudeTimeline(text)
  return agent === 'codex' ? parseCodexTimeline(text) : parseGeminiTimeline(text)
}
