import type { ChatItem, ChatTool } from './chatLog'

export interface TurnFileSummary {
  path: string
  status: 'M' | 'A' | 'D'
  added: number
  removed: number
}

export interface TurnSummary {
  messageId: string
  /** The user message this turn answers; its checkpoint is looked up by this id. */
  userMessageId?: string
  checkpointRef?: string
  files: TurnFileSummary[]
  added: number
  removed: number
}

function summarize(messageId: string | null, tools: readonly ChatTool[]): TurnSummary | null {
  if (!messageId || tools.length === 0) return null
  const files = new Map<string, TurnFileSummary>()
  for (const tool of tools) {
    if (!tool.done || !tool.path || tool.failed) continue
    const prior = files.get(tool.path)
    const status = tool.verb === 'Deleted' ? 'D' : tool.activity === 'create' ? 'A' : prior?.status === 'A' ? 'A' : 'M'
    files.set(tool.path, { path: tool.path, status, added: (prior?.added ?? 0) + (tool.added ?? 0), removed: (prior?.removed ?? 0) + (tool.removed ?? 0) })
  }
  const rows = [...files.values()]
  return rows.length ? { messageId, files: rows, added: rows.reduce((n, f) => n + f.added, 0), removed: rows.reduce((n, f) => n + f.removed, 0) } : null
}

/** Groups parsed edit tool calls by user turn and attaches the result to that turn's agent reply. */
export function turnSummaries(items: readonly ChatItem[], refs: Readonly<Record<string, string>> = {}): TurnSummary[] {
  const out: TurnSummary[] = []
  let edits: ChatTool[] = []
  let reply: string | null = null
  let userId: string | null = null
  const finish = (): void => {
    const result = summarize(reply, edits)
    if (result) out.push(userId ? { ...result, userMessageId: userId, ...(refs[userId] ? { checkpointRef: refs[userId] } : {}) } : result)
    edits = []
    reply = null
  }
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') {
      finish()
      edits = []
      userId = item.id
    }
    else if (item.kind === 'tool' && (item.activity === 'edit' || item.activity === 'create')) edits = [...edits, item]
    else if (item.kind === 'message' && item.role === 'agent') reply = item.id
  }
  finish()
  return out
}
