import type { ChatImageRef } from '../../shared/chatImage'
import { classifyTool } from '../../shared/timelineParse'
import { toolKind, type ToolKind } from '../../shared/chatKind'
import { CHAT_OUTPUT_LINES, CHAT_OUTPUT_MAX, CHAT_TARGET_MAX, boundText } from '../../shared/chatLog'
import { parseAskQuestions, type AskQuestion } from '../../shared/chatAsk'
import { cleanText, flat, isRecord, toolArg, type Json } from '../../shared/transcript'

export interface ToolShape {
  kind: ToolKind
  verb: string
  target: string
  added?: number
  removed?: number
  /** Text shown when the call is opened and no result replaces it: a diff for an edit. */
  preview: string
  /** The questions of an AskUserQuestion call. */
  ask?: AskQuestion[]
  /** Pictures the call itself carries, such as one the agent was asked to view. */
  images?: ChatImageRef[]
  /** The one file this call touched, for the open button. */
  path?: string
  line?: number
}

const CREATE_TOOLS = new Set(['write', 'create_file', 'write_file'])
const SEARCH_TOOLS = new Set(['glob', 'grep', 'ls', 'list_directory', 'search_file_content', 'grep_search'])
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const prefixed = (text: string, mark: string): string =>
  text === '' ? '' : text.replace(/\n$/, '').split('\n').map((line) => `${mark}${line}`).join('\n')

function diffPreview(input: Json): string {
  const content = str(input.content ?? input.file_text)
  if (content !== '') return prefixed(content, '+')
  const pairs = Array.isArray(input.edits) ? input.edits.filter(isRecord) : [input]
  return pairs
    .map((pair) => [prefixed(str(pair.old_string ?? pair.old_str), '-'), prefixed(str(pair.new_string ?? pair.new_str), '+')].filter((part) => part !== '').join('\n'))
    .filter((part) => part !== '')
    .join('\n')
}

/** A positive whole number from a tool argument, as the line it points at. */
export function lineOf(value: unknown): { line?: number } {
  const line = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isInteger(line) && line > 0 ? { line } : {}
}

export function boundedOutput(text: string): { output: string; truncated: boolean } {
  const bounded = boundText(cleanText(text), CHAT_OUTPUT_MAX, CHAT_OUTPUT_LINES)
  return { output: bounded.text, truncated: bounded.truncated }
}

function editShape(name: string, input: Json, edits: { path: string; added: number; removed: number }[]): ToolShape {
  const first = edits[0]
  const more = edits.length > 1 ? ` and ${edits.length - 1} more` : ''
  return {
    kind: CREATE_TOOLS.has(name) ? 'create' : 'edit',
    verb: CREATE_TOOLS.has(name) ? 'Created' : 'Edited',
    target: `${first.path}${more}`,
    path: first.path,
    added: edits.reduce((sum, edit) => sum + edit.added, 0),
    removed: edits.reduce((sum, edit) => sum + edit.removed, 0),
    preview: diffPreview(input)
  }
}

const PLAIN_VERBS: Readonly<Record<string, string>> = { task: 'Agent', agent: 'Agent', webfetch: 'Fetched', web_fetch: 'Fetched', websearch: 'Searched', web_search: 'Searched' }

function questionShape(input: Json): ToolShape {
  const ask = parseAskQuestions(input)
  const first = ask[0]?.question ?? toolArg(input)
  return { kind: 'question', verb: 'Asked', target: flat(first, CHAT_TARGET_MAX), preview: '', ...(ask.length > 0 ? { ask } : {}) }
}

/** mcp__server__tool, the name Claude logs for a tool an MCP server gives it. */
export function mcpParts(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { server: flat(match[1], 40), tool: flat(match[2], 80) } : null
}

/** One line for a tool call: a verb, what it touches, and for an edit how many lines it adds and removes. */
export function toolShape(rawName: unknown, rawInput: unknown): ToolShape {
  const name = (typeof rawName === 'string' ? rawName : '').toLowerCase()
  const input = isRecord(rawInput) ? rawInput : {}
  const tool = classifyTool(rawName, rawInput)
  if (tool?.kind === 'edit') return editShape(name, input, tool.edits)
  if (tool?.kind === 'read') {
    const search = SEARCH_TOOLS.has(name)
    const target = flat(tool.paths.join(', '), CHAT_TARGET_MAX)
    return { kind: search ? 'search' : 'read', verb: search ? 'Searched' : 'Read', target, preview: '', ...(search || tool.paths.length !== 1 ? {} : { path: tool.paths[0], ...lineOf(input.offset) }) }
  }
  if (tool?.kind === 'command') {
    const line = tool.command.split('\n')[0]
    return { kind: 'shell', verb: 'Ran', target: flat(line, CHAT_TARGET_MAX), preview: tool.command.includes('\n') ? tool.command : '' }
  }
  if (toolKind(rawName) === 'question') return questionShape(input)
  const mcp = mcpParts(typeof rawName === 'string' ? rawName : '')
  if (mcp) return { kind: 'mcp', verb: mcp.server, target: mcp.tool, preview: '' }
  const label = PLAIN_VERBS[name] ?? flat(typeof rawName === 'string' && rawName !== '' ? rawName : 'tool', 60)
  return { kind: toolKind(rawName), verb: label, target: toolArg(rawInput).slice(0, CHAT_TARGET_MAX), preview: '' }
}
