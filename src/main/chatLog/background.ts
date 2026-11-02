import { BACKGROUND_MAX, BACKGROUND_RESULT_LINES, BACKGROUND_RESULT_MAX, BACKGROUND_SUMMARY_MAX, BACKGROUND_TITLE_MAX, backgroundStatus, type BackgroundKind, type BackgroundTask, type TaskNotification } from '../../shared/chatBackground'
import { boundText } from '../../shared/chatLog'
import { cleanText, isRecord, type Json } from '../../shared/transcript'

const KEEP_USES = 200
const KEEP_NOTES = 200
const AGENT_TOOLS = new Set(['Agent', 'Task'])

interface Use {
  name: string
  input: Json
}

interface Launch {
  id: string
  launchId: string
  kind: BackgroundKind
  title: string
  agentType?: string
  startedAt: number
}

interface Note {
  note: TaskNotification
  at: number | undefined
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function oldestOut<T>(map: Map<string, T>, limit: number): void {
  while (map.size > limit) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

function titleOf(use: Use | undefined, result: Json, kind: BackgroundKind): string {
  const input = use?.input ?? {}
  const command = kind === 'shell' ? str(input.command).split('\n')[0] : ''
  const text = str(input.description) || str(result.description) || command || (kind === 'agent' ? 'Background agent' : 'Background command')
  return boundText(cleanText(text).trim(), BACKGROUND_TITLE_MAX).text
}

/**
 * Pairs the background work a session launched with the notifications that say it stopped.
 * A launch with no notification yet is running. Records may arrive in any order, so the pairing is done when asked for.
 */
export class BackgroundTracker {
  private readonly uses = new Map<string, Use>()
  private readonly launches = new Map<string, Launch>()
  private readonly byToolUse = new Map<string, Note>()
  private readonly byTask = new Map<string, Note>()

  /** A tool call; kept until its result says whether it started background work. */
  use(id: string, name: unknown, input: unknown): void {
    const shape = isRecord(input) ? input : {}
    if (typeof name !== 'string' || (!AGENT_TOOLS.has(name) && shape.run_in_background !== true)) return
    this.uses.set(id, { name, input: shape })
    oldestOut(this.uses, KEEP_USES)
  }

  /** A tool result: an agent that was launched async, or a command that was sent to the background, starts a task. */
  launched(toolUseId: string, result: unknown, at: number | undefined): void {
    const use = this.uses.get(toolUseId)
    this.uses.delete(toolUseId)
    if (!isRecord(result)) return
    const agentId = result.isAsync === true && result.status === 'async_launched' ? str(result.agentId) : ''
    const shellId = agentId === '' ? str(result.backgroundTaskId) : ''
    const id = agentId || shellId
    if (id === '') return
    const kind: BackgroundKind = agentId !== '' ? 'agent' : 'shell'
    const agentType = kind === 'agent' ? str(use?.input.subagent_type) : ''
    this.launches.set(toolUseId, { id, launchId: toolUseId, kind, title: titleOf(use, result, kind), ...(agentType !== '' ? { agentType } : {}), startedAt: at ?? 0 })
    oldestOut(this.launches, BACKGROUND_MAX * 2)
  }

  /** A task-notification. The latest one for a task wins, as an agent that is resumed notifies again. */
  notified(note: TaskNotification, at: number | undefined): void {
    const entry: Note = { note, at }
    this.byTask.set(note.taskId, entry)
    if (note.toolUseId) this.byToolUse.set(note.toolUseId, entry)
    oldestOut(this.byTask, KEEP_NOTES)
    oldestOut(this.byToolUse, KEEP_NOTES)
  }

  list(): BackgroundTask[] {
    return [...this.launches.values()].map((launch) => this.join(launch)).slice(-BACKGROUND_MAX)
  }

  private join(launch: Launch): BackgroundTask {
    const base = { id: launch.id, launchId: launch.launchId, kind: launch.kind, title: launch.title, startedAt: launch.startedAt, ...(launch.agentType ? { agentType: launch.agentType } : {}) }
    const entry = this.byToolUse.get(launch.launchId) ?? this.byTask.get(launch.id)
    if (!entry) return { ...base, status: 'running' }
    const summary = boundText(cleanText(entry.note.summary).trim(), BACKGROUND_SUMMARY_MAX).text
    const result = boundText(cleanText(entry.note.result).trim(), BACKGROUND_RESULT_MAX, BACKGROUND_RESULT_LINES).text
    return {
      ...base,
      status: backgroundStatus(entry.note.status),
      ...(entry.at !== undefined ? { finishedAt: entry.at } : {}),
      ...(summary !== '' ? { summary } : {}),
      ...(result !== '' ? { resultPreview: result } : {})
    }
  }
}
