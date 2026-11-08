import { parseAnswers, type AnswerEntry } from '../../shared/chatCards'
import { diffFromStructuredPatch, firstChangedLine, type ChatDiff } from '../../shared/chatDiff'
import { stripImageMarkers, type ChatImageRef } from '../../shared/chatImage'
import type { ChatItem } from '../../shared/chatLog'
import { asTime, blockText, isRecord, type Json } from '../../shared/transcript'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { parseTaskNotifications } from '../../shared/chatBackground'
import type { BackgroundTask } from '../../shared/chatBackground'
import { BackgroundTracker } from './background'
import { ChatBuilder } from './builder'
import { ImageCollector, type ImageEntry } from './imageTable'
import { toolShape } from './toolShape'
import type { ChatLineReader, ReaderStats } from './reader'

const KNOWN = new Set(['user', 'assistant', 'system', 'summary'])
const SYSTEM_TAG = /^<(?:command-[a-z]+|local-command-[a-z]+|system-reminder|ide_[a-z_]+|user-prompt-submit-hook|bash-(?:input|stdout|stderr)|task-notification|persisted-output)[\s>]/
const isUserText = (text: string): boolean => text.trim() !== '' && !SYSTEM_TAG.test(text.trim())
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const COMMAND_OUTPUT = /^\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>\s*$/
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]\s*/

/** The text parts of a user record, one string each, so a marker such as an interrupt can be told from what the user wrote. */
function promptParts(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')).filter((text) => text.trim() !== '')
}

/** The numbered change Claude records beside an edit's result. */
function patchOf(record: Json): { diff: ChatDiff | null; line?: number; answers: AnswerEntry[] } {
  const result = isRecord(record.toolUseResult) ? record.toolUseResult : {}
  const line = firstChangedLine(result.structuredPatch)
  return { diff: diffFromStructuredPatch(result.structuredPatch), answers: parseAnswers(result), ...(line ? { line } : {}) }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? blockText(content, ['text']) : ''
}

/** Reads Claude Code's session log: one record per content block, whole text blocks, tool results as user records. */
export class ClaudeChatReader implements ChatLineReader {
  constructor(private readonly folder?: string) {}

  private readonly builder = new ChatBuilder()
  private readonly collector = new ImageCollector()
  private readonly tracker = new BackgroundTracker()
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

  image(id: string): ImageEntry | undefined {
    return this.collector.get(id)
  }

  background(): BackgroundTask[] {
    return this.tracker.list()
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
    if (record.type === 'system' && record.subtype === 'compact_boundary') this.builder.notice(this.nextId(record), 'compact', CHAT_TEXT.compacted, at)
    else if (record.type === 'user' && record.isCompactSummary === true) this.builder.compact(this.nextId(record), promptParts(message.content).join('\n'), at)
    else if (record.type === 'user' && record.isMeta !== true) this.user(record, message, at)
    else if (record.type === 'assistant') this.assistant(record, message, at)
  }

  private user(record: Json, message: Json, at: number | undefined): void {
    const content = message.content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isRecord(part) && part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          this.tracker.launched(part.tool_use_id, record.toolUseResult, at)
          this.builder.result(part.tool_use_id, { output: resultText(part.content), failed: part.is_error === true, images: this.imagesIn(part.content), ...patchOf(record) })
        }
      }
    }
    for (const raw of promptParts(content)) for (const note of parseTaskNotifications(raw)) this.tracker.notified(note, at)
    const markers: string[] = []
    const written: string[] = []
    let held = this.userImages(content)
    for (const raw of promptParts(content)) {
      const stripped = stripImageMarkers(raw)
      markers.push(...stripped.paths)
      const part = stripped.text
      const marker = INTERRUPTED.exec(part.trim())
      if (marker) {
        held = this.flushWritten(record, written, at, held)
        this.builder.notice(this.nextId(record), 'interrupted', CHAT_TEXT.interrupted, at)
      }
      const rest = marker ? part.trim().slice(marker[0].length) : part
      if (this.slashCommand(record, rest)) continue
      if (isUserText(rest)) written.push(rest)
    }
    if (held.length === 0) held = markers.flatMap((path) => this.collector.fromFile(path) ?? [])
    const left = this.flushWritten(record, written, at, held)
    if (left.length > 0) this.builder.message(this.nextId(record), 'user', '', at, left)
  }

  /** A slash command and what it printed arrive as tagged text; both become one quiet row. True when the text was one of them. */
  private slashCommand(record: Json, text: string): boolean {
    const name = COMMAND_NAME.exec(text)
    if (name) {
      const args = COMMAND_ARGS.exec(text)?.[1]?.trim() ?? ''
      this.builder.command(this.nextId(record), `${name[1].trim()} ${args}`.trim(), asTime(record.timestamp))
      return true
    }
    const printed = COMMAND_OUTPUT.exec(text)
    if (!printed) return false
    this.builder.commandOutput(printed[1])
    return true
  }

  /** What the user wrote around an interrupt marker is still their message. Pictures ride on the first message; what is left over is returned. */
  private flushWritten(record: Json, written: string[], at: number | undefined, images: ChatImageRef[]): ChatImageRef[] {
    if (written.length === 0) return images
    this.builder.message(this.nextId(record), 'user', written.join('\n'), at, images)
    written.length = 0
    return []
  }

  /** The pictures of a user record, from its image blocks. A url source is never fetched. */
  private userImages(content: unknown): ChatImageRef[] {
    return Array.isArray(content) ? this.imagesIn(content) : []
  }

  private imagesIn(content: unknown): ChatImageRef[] {
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      if (!isRecord(part) || part.type !== 'image' || !isRecord(part.source) || part.source.type !== 'base64' || typeof part.source.data !== 'string') return []
      const ref = this.collector.fromBase64(part.source.data)
      return ref ? [ref] : []
    })
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
      } else if (part.type === 'thinking' && typeof part.thinking === 'string') {
        this.builder.thought(this.nextId(record), part.thinking, at)
      } else if (part.type === 'tool_use' && typeof part.id === 'string') {
        this.tracker.use(part.id, part.name, part.input)
        this.builder.call(part.id, toolShape(part.name, part.input, this.folder), at)
      }
    }
  }
}

function resetsAt(record: Json): number | undefined {
  const params = isRecord(record.apiErrorParams) ? record.apiErrorParams : {}
  const info = isRecord(params.rate_limit_info) ? params.rate_limit_info : {}
  return typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined
}
