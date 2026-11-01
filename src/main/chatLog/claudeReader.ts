import type { ChatItem } from '../../shared/chatLog'
import { asTime, blockText, isRecord, type Json } from '../../shared/transcript'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { ChatBuilder } from './builder'
import { toolShape } from './toolShape'
import type { ChatLineReader, ReaderStats } from './reader'

const KNOWN = new Set(['user', 'assistant', 'system', 'summary'])
const SYSTEM_TAG = /^<(?:command-[a-z]+|local-command-[a-z]+|system-reminder|ide_[a-z_]+|user-prompt-submit-hook|bash-(?:input|stdout|stderr)|task-notification|persisted-output)[\s>]/
const isUserText = (text: string): boolean => text.trim() !== '' && !SYSTEM_TAG.test(text.trim())
const INTERRUPTED = /^\[Request interrupted by user/

function promptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = content.map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
  return parts.filter(isUserText).join('\n')
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? blockText(content, ['text']) : ''
}

/** Reads Claude Code's session log: one record per content block, whole text blocks, tool results as user records. */
export class ClaudeChatReader implements ChatLineReader {
  private readonly builder = new ChatBuilder()
  private lines = 0
  private known = 0
  private counter = 0

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

  private nextId(record: Json): string {
    this.counter += 1
    return typeof record.uuid === 'string' ? record.uuid : `c${this.counter}`
  }

  private record(record: Json): void {
    this.lines += 1
    if (typeof record.type === 'string' && KNOWN.has(record.type)) this.known += 1
    if (record.isSidechain === true) return
    const message = isRecord(record.message) ? record.message : {}
    const at = asTime(record.timestamp)
    if (record.type === 'user' && record.isMeta !== true) this.user(record, message, at)
    else if (record.type === 'assistant') this.assistant(record, message, at)
  }

  private user(record: Json, message: Json, at: number | undefined): void {
    const content = message.content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isRecord(part) && part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          this.builder.result(part.tool_use_id, { output: resultText(part.content), failed: part.is_error === true })
        }
      }
    }
    const prompt = promptText(content)
    if (INTERRUPTED.test(prompt.trim())) this.builder.notice(this.nextId(record), 'interrupted', CHAT_TEXT.interrupted, at)
    else if (isUserText(prompt)) this.builder.message(this.nextId(record), 'user', prompt, at)
  }

  private assistant(record: Json, message: Json, at: number | undefined): void {
    const content = Array.isArray(message.content) ? message.content : []
    const apiError = typeof record.apiError === 'string' ? record.apiError : ''
    const limit = apiError === 'usage_limit_reached' || record.error === 'rate_limit'
    for (const part of content) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && typeof part.text === 'string') {
        if (limit) this.builder.notice(this.nextId(record), 'limit', part.text, at, resetsAt(record))
        else if (apiError !== '' || record.isApiErrorMessage === true) this.builder.notice(this.nextId(record), 'error', part.text, at)
        else this.builder.message(this.nextId(record), 'agent', part.text, at)
      } else if (part.type === 'tool_use' && typeof part.id === 'string') {
        this.builder.call(part.id, toolShape(part.name, part.input), at)
      }
    }
  }
}

function resetsAt(record: Json): number | undefined {
  const params = isRecord(record.apiErrorParams) ? record.apiErrorParams : {}
  const info = isRecord(params.rate_limit_info) ? params.rate_limit_info : {}
  return typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined
}
