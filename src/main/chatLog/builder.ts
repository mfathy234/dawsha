import { diffFromText, type ChatDiff } from '../../shared/chatDiff'
import type { ChatImageRef } from '../../shared/chatImage'
import { CHAT_ITEMS_MAX, CHAT_MESSAGE_MAX, boundText, type ChatItem, type ChatNoticeKind, type ChatTool } from '../../shared/chatLog'
import type { AnswerEntry } from '../../shared/chatCards'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { isTestCommand, parseTestCounts, testSummary } from '../../shared/testRun'
import { cleanText } from '../../shared/transcript'
import { boundedOutput, type ToolShape } from './toolShape'

const KEEP = CHAT_ITEMS_MAX * 2

export interface ToolResult {
  output: string
  failed?: boolean
  images?: ChatImageRef[]
  /** The numbered change the log's own record gives for an edit. */
  diff?: ChatDiff | null
  line?: number
  answers?: AnswerEntry[]
}

function noteFor(tool: ChatTool, output: string, failed: boolean | undefined): string | undefined {
  if (tool.verb !== 'Ran') return failed ? 'failed' : tool.note
  if (isTestCommand(tool.command ?? tool.target)) {
    const counts = parseTestCounts(output)
    if (counts) return testSummary(counts, failed === undefined ? undefined : !failed)
  }
  return failed ? 'failed' : undefined
}

/** Collects the items of one session log in order. Tool calls wait for their result and then fill it in. */
export class ChatBuilder {
  private list: ChatItem[] = []
  private readonly open = new Map<string, number>()
  private dropped = 0

  get earlier(): number {
    return this.dropped
  }

  items(): ChatItem[] {
    return this.list.slice(-CHAT_ITEMS_MAX)
  }

  message(id: string, role: 'user' | 'agent', text: string, at?: number, images: readonly ChatImageRef[] = []): void {
    const bounded = boundText(cleanText(text).trim(), CHAT_MESSAGE_MAX)
    const body = bounded.text
    if (body !== '' || images.length > 0) {
      this.push({ kind: 'message', id, role, text: body, ...(images.length > 0 ? { images: [...images] } : {}), ...(bounded.truncated ? { truncated: true } : {}), at })
    }
  }

  /** The agent's reasoning, as a row that stays closed until opened. Nothing is added for empty reasoning. */
  thought(id: string, text: string, at?: number): void {
    const { output, truncated } = boundedOutput(text.trim())
    if (output === '') return
    this.push({ kind: 'tool', id, activity: 'other', verb: 'Thought', target: '', output, outputTruncated: truncated, done: true, at })
  }

  /** The summary a compaction left joins the notice that marked it, or makes one. */
  compact(id: string, summary: string, at?: number): void {
    const index = this.list.length - 1
    const last = this.list[index]
    if (last?.kind === 'notice' && last.notice === 'compact' && last.detail === undefined && summary.trim() !== '') {
      this.list[index] = { ...last, detail: boundText(cleanText(summary).trim(), CHAT_MESSAGE_MAX).text }
      return
    }
    this.notice(id, 'compact', CHAT_TEXT.compacted, at, undefined, summary)
  }

  /** A slash command the user ran: a quiet row, with what it printed folded inside. */
  command(id: string, target: string, at?: number): void {
    this.push({ kind: 'tool', id: `cmd:${id}`, activity: 'other', verb: 'Ran', target, output: '', outputTruncated: false, done: true, at })
  }

  /** What the last slash command printed. Ignored when the last item is not a slash command. */
  commandOutput(text: string): void {
    const index = this.list.length - 1
    const last = this.list[index]
    if (last?.kind !== 'tool' || !last.id.startsWith('cmd:')) return
    const { output, truncated } = boundedOutput(text.trim())
    this.list[index] = { ...last, output, outputTruncated: truncated }
  }

  /** Pictures that arrived after the user's message they belong to. True when the last item was that message. */
  attachToLastUser(images: readonly ChatImageRef[]): boolean {
    const index = this.list.length - 1
    const last = this.list[index]
    if (images.length === 0 || last?.kind !== 'message' || last.role !== 'user') return false
    this.list[index] = { ...last, images: [...(last.images ?? []), ...images] }
    return true
  }

  notice(id: string, notice: ChatNoticeKind, text: string, at?: number, resetsAt?: number, detail?: string): void {
    const body = boundText(cleanText(text).trim(), 600).text
    const more = detail === undefined ? '' : boundText(cleanText(detail).trim(), CHAT_MESSAGE_MAX).text
    this.push({ kind: 'notice', id, notice, text: body, ...(resetsAt !== undefined ? { resetsAt } : {}), ...(more !== '' ? { detail: more } : {}), at })
  }

  call(id: string, shape: ToolShape, at?: number): void {
    const { output, truncated } = boundedOutput(shape.preview)
    const diff = shape.kind === 'edit' || shape.kind === 'create' ? diffFromText(shape.preview) : null
    const tool: ChatTool = {
      kind: 'tool',
      id,
      activity: shape.kind,
      verb: shape.verb,
      target: shape.target,
      ...(shape.command ? { command: shape.command } : {}),
      ...(shape.described ? { described: true } : {}),
      added: shape.added,
      removed: shape.removed,
      output,
      outputTruncated: truncated,
      done: false,
      ...(shape.ask ? { ask: shape.ask } : {}),
      ...(diff ? { diff } : {}),
      ...(shape.todos && shape.todos.length > 0 ? { todos: shape.todos } : {}),
      ...(shape.plan ? { plan: shape.plan } : {}),
      ...(shape.path ? { path: shape.path } : {}),
      ...(shape.line ? { line: shape.line } : {}),
      ...(shape.images && shape.images.length > 0 ? { images: [...shape.images] } : {}),
      at
    }
    this.open.set(id, this.list.length)
    this.push(tool)
  }

  /** A result arrived: edits keep their diff, anything else shows what the tool printed. */
  result(id: string, result: ToolResult): void {
    const index = this.open.get(id)
    const tool = index === undefined ? undefined : this.list[index]
    if (index === undefined || tool?.kind !== 'tool') return
    this.open.delete(id)
    const keepsDiff = tool.verb === 'Edited' || tool.verb === 'Created'
    const bounded = keepsDiff && tool.output !== '' ? { output: tool.output, truncated: tool.outputTruncated } : boundedOutput(result.output)
    const failed = result.failed === true ? true : undefined
    const images = [...(tool.images ?? []), ...(result.images ?? [])]
    const diff = result.diff ?? tool.diff
    const line = tool.line ?? result.line
    this.list[index] = { ...tool, ...(images.length > 0 ? { images } : {}), ...(diff ? { diff } : {}), ...(line ? { line } : {}), ...(result.answers && result.answers.length > 0 ? { answers: result.answers } : {}), output: bounded.output, outputTruncated: bounded.truncated, failed, note: noteFor(tool, result.output, failed), done: true }
  }

  private push(item: ChatItem): void {
    this.list.push(item)
    if (this.list.length <= KEEP) return
    const cut = this.list.length - CHAT_ITEMS_MAX
    this.list = this.list.slice(cut)
    this.dropped += cut
    const shifted = [...this.open.entries()].filter(([, index]) => index >= cut).map(([key, index]): [string, number] => [key, index - cut])
    this.open.clear()
    for (const [key, index] of shifted) this.open.set(key, index)
  }
}
