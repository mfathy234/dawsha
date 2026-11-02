export type BackgroundKind = 'agent' | 'shell'
export type BackgroundStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One piece of background work a session started: an agent or a shell command that runs while the conversation goes on. */
export interface BackgroundTask {
  /** The agent or command id the log gives it (its task id). */
  id: string
  /** The id of the tool call that launched it, which is also the id of its row in the thread. */
  launchId: string
  kind: BackgroundKind
  /** What it was asked to do: the call's description. */
  title: string
  agentType?: string
  /** When it was launched, in milliseconds; 0 when the log has no time for it. */
  startedAt: number
  status: BackgroundStatus
  finishedAt?: number
  summary?: string
  /** The final report of an agent, or what a command printed, shortened. */
  resultPreview?: string
}

export const BACKGROUND_MAX = 50
export const BACKGROUND_TITLE_MAX = 160
export const BACKGROUND_SUMMARY_MAX = 300
export const BACKGROUND_RESULT_MAX = 4_000
export const BACKGROUND_RESULT_LINES = 60

/** A `<task-notification>` block the harness writes into the log as a user turn when background work stops. */
export interface TaskNotification {
  taskId: string
  toolUseId?: string
  status: string
  summary: string
  result: string
}

const BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g

function tagged(body: string, name: string): string | undefined {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim()
}

/** The notifications a piece of user text carries. Text that is not one gives none. */
export function parseTaskNotifications(text: string): TaskNotification[] {
  if (!text.includes('<task-notification>')) return []
  return [...text.matchAll(BLOCK)].flatMap((match) => {
    const body = match[1]
    const taskId = tagged(body, 'task-id')
    const status = tagged(body, 'status')
    if (!taskId || !status) return []
    const result = /<result>([\s\S]*)<\/result>/.exec(body)?.[1]?.trim() ?? ''
    const toolUseId = tagged(body, 'tool-use-id')
    return [{ taskId, status, summary: tagged(body, 'summary') ?? '', result, ...(toolUseId ? { toolUseId } : {}) }]
  })
}

/** How the harness's status word reads here. Anything it does not know about counts as stopped. */
export function backgroundStatus(status: string): Exclude<BackgroundStatus, 'running'> {
  const word = status.trim().toLowerCase()
  if (word === 'completed' || word === 'complete' || word === 'done') return 'done'
  if (word === 'failed' || word === 'error') return 'failed'
  return 'stopped'
}

export type BackgroundCount = Record<BackgroundStatus, number>

export function countBackground(tasks: readonly BackgroundTask[]): BackgroundCount {
  const count: BackgroundCount = { running: 0, done: 0, failed: 0, stopped: 0 }
  for (const task of tasks) count[task.status] += 1
  return count
}

/** "2 running · 3 done", leaving out what is zero. */
export function backgroundSummary(tasks: readonly BackgroundTask[]): string {
  const count = countBackground(tasks)
  const order: BackgroundStatus[] = ['running', 'done', 'failed', 'stopped']
  return order.filter((status) => count[status] > 0).map((status) => `${count[status]} ${status}`).join(' · ')
}

/** Elapsed time as "42s", "3m 05s" or "1h 02m". */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
