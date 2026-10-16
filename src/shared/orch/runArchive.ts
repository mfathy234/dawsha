import { ORCH_ROLES, TASK_STATUSES, type OrchAgent, type OrchDecision, type OrchEvent, type OrchMessage, type OrchNote, type OrchRun, type OrchTask } from './types'

export const ARCHIVE_MAX_BYTES = 20 * 1024 * 1024
export type ArchiveAgent = Omit<OrchAgent, 'token' | 'launch'>
export interface ArchiveRecords {
  run: OrchRun
  tasks: OrchTask[]
  agents: ArchiveAgent[]
  decisions: OrchDecision[]
  notes: OrchNote[]
  events: OrchEvent[]
  messages: OrchMessage[]
}
export interface RunArchive extends ArchiveRecords {
  format: 'dawsharun'
  version: 1
  exportedAt: number
  app: { version: string }
}

type Check = (value: unknown) => boolean
type Shape = Record<string, Check>
const str: Check = (v) => typeof v === 'string' && v.length <= 100_000
const id: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER
const timestamp: Check = (v) => num(v) && (v as number) <= 8_640_000_000_000_000
const integer: Check = (v) => num(v) && Number.isInteger(v)
const bool: Check = (v) => typeof v === 'boolean'
const nullable = (check: Check): Check => (v) => v === null || check(v)
const optional = (check: Check): Check => (v) => v === undefined || check(v)
const oneOf = (values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v)
const list = (check: Check, max = 10_000): Check => (v) => Array.isArray(v) && v.length <= max && v.every(check)
const object = (shape: Shape): Check => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const raw = v as Record<string, unknown>
  return Object.keys(raw).every((key) => Object.hasOwn(shape, key)) && Object.entries(shape).every(([key, check]) => check(raw[key]))
}
const status = oneOf(TASK_STATUSES)
const role = oneOf(ORCH_ROLES)
const runCheck = object({
  id, kind: oneOf(['bug', 'feature']), projectPath: str, title: str, story: str, plan: str,
  stage: oneOf(['spec', 'plan', 'build', 'review', 'merge', 'done', 'cancelled']), createdAt: timestamp, finishedAt: nullable(timestamp),
  projectId: optional(nullable(id)), specApproval: optional(bool), fixerProfileId: optional(nullable(id)),
  imported: optional(object({ at: timestamp, from: str }))
})
const taskCheck = object({
  id, key: id, runId: id, title: str, spec: str, role, status, dependsOn: list(id), acceptance: list(str),
  reviewOf: nullable(id), reviewRound: integer, assignee: nullable(id), summary: nullable(str), files: list(str),
  branch: nullable(str), feedback: nullable(str), pausedFrom: nullable(status), createdAt: timestamp, updatedAt: timestamp,
  attempts: optional(integer), mergedAt: optional(nullable(timestamp))
})
const agentCheck = object({
  id, runId: id, role, runner: str, model: str, taskId: nullable(id), createdAt: timestamp,
  usage: nullable(object({ inputTokens: integer, outputTokens: integer, cacheReadTokens: integer, cacheWriteTokens: integer, reportedCostUsd: nullable(num) })),
  retiredAt: optional(nullable(timestamp)), lastCallAt: optional(nullable(timestamp))
})
const decisionCheck = object({
  id, runId: id, kind: oneOf(['question', 'spec-approval', 'escalation', 'stall', 'merge-conflict', 'run-complete']),
  taskId: nullable(id), agentId: nullable(id), question: str, options: list(str), recommended: nullable(integer),
  context: str, urgency: oneOf(['normal', 'high']), answer: nullable(str), createdAt: timestamp, answeredAt: nullable(timestamp)
})
const archiveCheck = object({
  format: (v) => v === 'dawsharun', version: (v) => v === 1, exportedAt: timestamp, app: object({ version: str }), run: runCheck,
  tasks: list(taskCheck), agents: list(agentCheck), decisions: list(decisionCheck),
  notes: list(object({ runId: id, key: id, text: str, author: str, updatedAt: timestamp })),
  events: list(object({ runId: id, at: timestamp, kind: str, text: str, taskId: nullable(id) })),
  messages: list(object({ id, runId: id, from: id, to: id, taskId: nullable(id), body: str, createdAt: timestamp, readAt: nullable(timestamp) }))
})

/** Project the agent explicitly: newly added launch/credential fields cannot silently leak into files. */
export function buildArchive(records: ArchiveRecords, appVersion: string, exportedAt = Date.now()): RunArchive {
  const agents = records.agents.map((a): ArchiveAgent => ({
    id: a.id, runId: a.runId, role: a.role, runner: a.runner, model: a.model, taskId: a.taskId,
    createdAt: a.createdAt, usage: a.usage, ...(a.retiredAt !== undefined ? { retiredAt: a.retiredAt } : {}),
    ...(a.lastCallAt !== undefined ? { lastCallAt: a.lastCallAt } : {})
  }))
  return { ...records, agents, format: 'dawsharun', version: 1, exportedAt, app: { version: appVersion } }
}

function consistent(a: RunArchive): boolean {
  const unique = (values: string[]): boolean => new Set(values).size === values.length
  const tasks = new Set(a.tasks.map((t) => t.id))
  const keys = new Set(a.tasks.map((t) => t.key))
  const agents = new Set(a.agents.map((agent) => agent.id))
  const taskRef = (value: string | null): boolean => value === null || tasks.has(value)
  const agentRef = (value: string | null): boolean => value === null || agents.has(value)
  const identity = (value: string): boolean => value === 'human' || value === 'dawsha' || agents.has(value)
  return [a.tasks, a.agents, a.decisions, a.notes, a.events, a.messages].every((rows) => rows.every((row) => row.runId === a.run.id)) &&
    [a.tasks, a.agents, a.decisions, a.messages].every((rows) => unique(rows.map((r) => r.id))) &&
    unique(a.tasks.map((t) => t.key)) && unique(a.notes.map((n) => n.key)) &&
    a.tasks.every((t) => t.id === `${a.run.id}:${t.key}` && agentRef(t.assignee) && t.dependsOn.every((k) => keys.has(k)) && (t.reviewOf === null || keys.has(t.reviewOf))) &&
    a.agents.every((agent) => taskRef(agent.taskId)) &&
    a.decisions.every((d) => taskRef(d.taskId) && agentRef(d.agentId) && (d.recommended === null || d.recommended < d.options.length)) &&
    a.events.every((e) => taskRef(e.taskId)) && a.messages.every((m) => taskRef(m.taskId) && identity(m.from) && identity(m.to)) && a.notes.every((n) => identity(n.author))
}

export function parseArchive(text: string): { ok: true; archive: RunArchive } | { ok: false; error: string } {
  try {
    if (text.length > ARCHIVE_MAX_BYTES || new TextEncoder().encode(text).byteLength > ARCHIVE_MAX_BYTES) throw new Error('Archive exceeds the 20 MB limit.')
    const raw: unknown = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'dawsharun') throw new Error('Unknown archive format; expected dawsharun.')
    if ((raw as { version?: unknown }).version !== 1) throw new Error('Unsupported dawsharun version; expected version 1.')
    if (!archiveCheck(raw)) throw new Error('Invalid archive fields or limits exceeded.')
    const archive = raw as RunArchive
    if (!consistent(archive)) throw new Error('Invalid archive record references or duplicate identifiers.')
    return { ok: true, archive }
  } catch (error) {
    return { ok: false, error: error instanceof SyntaxError ? 'The archive is not valid JSON.' : (error as Error).message }
  }
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
export function archiveToMarkdown(a: RunArchive): string {
  const lines = [
    `# ${a.run.title}`, '', '## Story', a.run.story, '', '## Outcome',
    `${a.run.stage} · Plan: ${a.run.plan} · Project: ${a.run.projectPath}`, '', '## Tasks'
  ]
  for (const task of a.tasks) lines.push(`### ${task.key}: ${task.title} (${task.status})`, task.summary ?? 'No summary.', '')
  lines.push('## Decisions')
  for (const d of a.decisions) lines.push(`- ${d.question}`, `  Options: ${d.options.join(' / ')}`, `  Answer: ${d.answer ?? 'Unanswered'}`)
  lines.push('', '## Usage', '| Role | Runner | Model | Input | Output | Cache read | Cache write | Reported USD |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |')
  for (const agent of a.agents) {
    const u = agent.usage
    lines.push(`| ${agent.role} | ${cell(agent.runner)} | ${cell(agent.model)} | ${u?.inputTokens ?? 0} | ${u?.outputTokens ?? 0} | ${u?.cacheReadTokens ?? 0} | ${u?.cacheWriteTokens ?? 0} | ${u?.reportedCostUsd ?? 'unpriced'} |`)
  }
  lines.push('', '## Timeline')
  for (const event of a.events) lines.push(`- ${new Date(event.at).toISOString()} · ${event.text}`)
  return lines.join('\n') + '\n'
}
