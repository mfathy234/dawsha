import { diffFromText, type ChatDiff } from '../../shared/chatDiff'
import type { ChatImageRef } from '../../shared/chatImage'
import { CHAT_ITEMS_MAX, CHAT_MESSAGE_MAX, boundText, type ChatItem, type ChatNoticeKind, type ChatTool } from '../../shared/chatLog'
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
}

function noteFor(tool: ChatTool, output: string, failed: boolean | undefined): string | undefined {
  if (tool.verb !== 'Ran') return failed ? 'failed' : tool.note
  if (isTestCommand(tool.target)) {
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
    const body = boundText(cleanText(text).trim(), CHAT_MESSAGE_MAX).text
    if (body !== '' || images.length > 0) this.push({ kind: 'message', id, role, text: body, ...(images.length > 0 ? { images: [...images] } : {}), at })
  }

  /** Pictures that arrived after the user's message they belong to. True when the last item was that message. */
  attachToLastUser(images: readonly ChatImageRef[]): boolean {
    const index = this.list.length - 1
    const last = this.list[index]
    if (images.length === 0 || last?.kind !== 'message' || last.role !== 'user') return false
    this.list[index] = { ...last, images: [...(last.images ?? []), ...images] }
    return true
  }

  notice(id: string, notice: ChatNoticeKind, text: string, at?: number, resetsAt?: number): void {
    const body = boundText(cleanText(text).trim(), 600).text
    this.push({ kind: 'notice', id, notice, text: body, ...(resetsAt !== undefined ? { resetsAt } : {}), at })
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
      added: shape.added,
      removed: shape.removed,
      output,
      outputTruncated: truncated,
      done: false,
      ...(shape.ask ? { ask: shape.ask } : {}),
      ...(diff ? { diff } : {}),
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
    this.list[index] = { ...tool, ...(images.length > 0 ? { images } : {}), ...(diff ? { diff } : {}), ...(line ? { line } : {}), output: bounded.output, outputTruncated: bounded.truncated, failed, note: noteFor(tool, result.output, failed), done: true }
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
