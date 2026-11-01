import { CHAT_TARGET_MAX, type ChatItem } from '../../shared/chatLog'
import { lineCount, parsePatch } from '../../shared/timelineParse'
import { asTime, flat, isRecord, type Json } from '../../shared/transcript'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { ChatBuilder } from './builder'
import type { ChatLineReader, ReaderStats } from './reader'
import type { ToolShape } from './toolShape'

const KNOWN = new Set(['session_meta', 'event_msg', 'response_item', 'turn_context'])
const WRAPPER = /^(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?$/i
const LIMIT_TEXT = /usage limit|rate limit|hit your limit/i
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function itemText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isRecord(part) ? str(part.text) : '')).join('')
}

function commandOf(item: Json): string {
  const command = item.command
  if (Array.isArray(command)) {
    const parts = command.map(String)
    const wrapped = parts.length >= 3 && WRAPPER.test(parts[0].split(/[\\/]/).pop() ?? '') && parts[1].startsWith('-')
    return wrapped ? parts[parts.length - 1] : parts.join(' ')
  }
  return str(command)
}

function changeShape(path: string, change: Json): ToolShape {
  const kind = str(change.type)
  const diff = str(change.unified_diff)
  const content = str(change.content)
  if (diff !== '') {
    const lines = diff.split('\n')
    return {
      verb: 'Edited',
      target: path,
      added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
      removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
      preview: diff
    }
  }
  const mark = kind === 'delete' ? '-' : '+'
  const body = content.replace(/\n$/, '')
  const count = lineCount(content)
  return {
    verb: kind === 'delete' ? 'Deleted' : 'Created',
    target: path,
    added: kind === 'delete' ? 0 : count,
    removed: kind === 'delete' ? count : 0,
    preview: body === '' ? '' : body.split('\n').map((line) => `${mark}${line}`).join('\n')
  }
}

/** Reads a Codex rollout: finished items arrive as event_msg item_completed records, the user and agent messages among them. */
export class CodexChatReader implements ChatLineReader {
  private readonly builder = new ChatBuilder()
  private lines = 0
  private known = 0
  private counter = 0
  private limitHit = false

  get stats(): ReaderStats {
    return { lines: this.lines, known: this.known }
  }

  get earlier(): number {
    return this.builder.earlier
  }

  items(): ChatItem[] {
    return this.builder.items()
  }

  feed(text: string): void {
    for (const line of text.split('\n')) {
      if (!line.startsWith('{')) continue
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (isRecord(record)) this.record(record)
    }
  }

  private nextId(prefix: string, id?: unknown): string {
    this.counter += 1
    return typeof id === 'string' && id !== '' ? id : `${prefix}${this.counter}`
  }

  private record(record: Json): void {
    this.lines += 1
    if (typeof record.type === 'string' && KNOWN.has(record.type)) this.known += 1
    if (record.type !== 'event_msg' || !isRecord(record.payload)) return
    const payload = record.payload
    const at = asTime(record.timestamp)
    const kind = payload.type
    if (kind === 'item_completed' && isRecord(payload.item)) this.item(payload.item, at)
    else if (kind === 'user_message') this.builder.message(this.nextId('u'), 'user', str(payload.message), at)
    else if (kind === 'agent_message') this.builder.message(this.nextId('a'), 'agent', str(payload.message), at)
    else if (kind === 'turn_aborted') this.builder.notice(this.nextId('x'), 'interrupted', CHAT_TEXT.interrupted, at)
    else if (kind === 'error') this.failure(str(payload.message), at)
    else if (kind === 'token_count') this.limits(payload, at)
  }

  private item(item: Json, at: number | undefined): void {
    const id = this.nextId('i', item.id)
    if (item.type === 'UserMessage') this.builder.message(id, 'user', itemText(item.content), at)
    else if (item.type === 'AgentMessage') this.builder.message(id, 'agent', itemText(item.content), at)
    else if (item.type === 'CommandExecution') this.command(id, item, at)
    else if (item.type === 'FileChange') this.fileChange(id, item, at)
    else if (item.type === 'McpToolCall') this.mcp(id, item, at)
  }

  private command(id: string, item: Json, at: number | undefined): void {
    const command = commandOf(item)
    const preview = command.includes('\n') ? command : ''
    this.builder.call(id, { verb: 'Ran', target: flat(command.split('\n')[0], CHAT_TARGET_MAX), preview }, at)
    const code = typeof item.exit_code === 'number' ? item.exit_code : 0
    this.builder.result(id, { output: str(item.aggregated_output), failed: item.status === 'failed' || code !== 0 })
  }

  private fileChange(id: string, item: Json, at: number | undefined): void {
    const changes = isRecord(item.changes) ? Object.entries(item.changes) : []
    changes.forEach(([path, change], index) => {
      if (!isRecord(change)) return
      const key = `${id}#${index}`
      this.builder.call(key, changeShape(path, change), at)
      this.builder.result(key, { output: '', failed: item.status === 'failed' })
    })
    if (changes.length > 0 || str(item.patch) === '') return
    for (const part of parsePatch(str(item.patch))) {
      const key = `${id}:${part.path}`
      this.builder.call(key, { verb: 'Edited', target: part.path, added: part.added, removed: part.removed, preview: '' }, at)
      this.builder.result(key, { output: '' })
    }
  }

  private mcp(id: string, item: Json, at: number | undefined): void {
    const args = isRecord(item.arguments) ? item.arguments : {}
    const title = str(args.title) || `${str(item.server)}.${str(item.tool)}`
    this.builder.call(id, { verb: 'Used', target: flat(title, CHAT_TARGET_MAX), preview: '' }, at)
    const result = isRecord(item.result) ? item.result : {}
    this.builder.result(id, { output: itemText(result.content), failed: result.isError === true || item.status === 'failed' })
  }

  private failure(message: string, at: number | undefined): void {
    if (message.trim() === '') return
    this.builder.notice(this.nextId(LIMIT_TEXT.test(message) ? 'l' : 'e'), LIMIT_TEXT.test(message) ? 'limit' : 'error', message, at)
  }

  private limits(payload: Json, at: number | undefined): void {
    const rates = isRecord(payload.rate_limits) ? payload.rate_limits : {}
    const windows = [rates.primary, rates.secondary].filter(isRecord)
    const full = windows.find((window) => typeof window.used_percent === 'number' && window.used_percent >= 100)
    if (full && !this.limitHit) {
      const resets = typeof full.resets_at === 'number' ? full.resets_at * 1000 : undefined
      this.builder.notice(this.nextId('l'), 'limit', 'Codex reached its usage limit.', at, resets)
    }
    this.limitHit = full !== undefined
  }
}
