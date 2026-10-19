import { randomBytes } from 'node:crypto'
import { buildArchive, parseArchive, type RunArchive } from '../../shared/orch/runArchive'
import type { OrchRun } from '../../shared/orch/types'
import { randomId, RESERVED_NOTE_PREFIX } from './context'
import type { OrchStore } from './store'

export function exportStoredRun(store: OrchStore, runId: string, version: string, at: number): RunArchive {
  const run = store.getRun(runId)
  if (!run) throw new Error(`Run ${runId} not found.`)
  // Clean-up results name folders on this machine, so they stay out of the archive.
  const { cleanup: _local, ...portable } = run
  return buildArchive({ run: portable, tasks: store.listTasks({ runId }), agents: store.listAgents(runId), decisions: store.listDecisions(runId),
    notes: store.listNotes(runId), events: store.listEvents(runId), messages: store.listMessages(runId) }, version, at)
}

/** Called inside the service transaction; remap global IDs even when only a child ID collides. */
export function importStoredRun(store: OrchStore, input: RunArchive, at: number, from: string): OrchRun {
  const parsed = parseArchive(JSON.stringify(input))
  if (!parsed.ok) throw new Error(parsed.error)
  const a = parsed.archive
  let runId = a.run.id
  while (store.getRun(runId) || a.tasks.some((task) => store.getTask(`${runId}:${task.key}`))) runId = randomId('run')
  const taskIds = new Map(a.tasks.map((t) => [t.id, `${runId}:${t.key}`]))
  const agentIds = new Map(a.agents.map((agent) => [agent.id, randomId('archived-agent')]))
  const decisionIds = new Map(a.decisions.map((d) => [d.id, randomId('dec')]))
  const taskRef = (id: string | null): string | null => id === null ? null : taskIds.get(id)!
  const agentRef = (id: string): string => agentIds.get(id) ?? id
  const finished = a.run.stage === 'done' || a.run.stage === 'cancelled'
  const run: OrchRun = { ...a.run, id: runId, stage: finished ? a.run.stage : 'cancelled',
    finishedAt: finished ? a.run.finishedAt : at, imported: { at, from } }
  store.putRun(run)
  for (const t of a.tasks) store.putTask({ ...t, id: taskIds.get(t.id)!, runId, assignee: t.assignee === null ? null : agentRef(t.assignee) })
  for (const agent of a.agents) store.putAgent({ ...agent, id: agentRef(agent.id), runId, taskId: taskRef(agent.taskId),
    retiredAt: at || 1, token: randomBytes(32).toString('hex') })
  for (const d of a.decisions) store.putDecision({ ...d, id: decisionIds.get(d.id)!, runId, taskId: taskRef(d.taskId), agentId: d.agentId === null ? null : agentRef(d.agentId) })
  for (const n of a.notes) {
    const decisionId = n.key.startsWith(RESERVED_NOTE_PREFIX) ? decisionIds.get(n.key.slice(RESERVED_NOTE_PREFIX.length)) : undefined
    const key = decisionId ? `${RESERVED_NOTE_PREFIX}${decisionId}` : n.key
    store.putNote({ ...n, key, runId, author: agentRef(n.author) })
  }
  for (const e of a.events) store.addEvent({ ...e, runId, taskId: taskRef(e.taskId) })
  for (const m of a.messages) store.putMessage({ ...m, id: randomId('msg'), runId, from: agentRef(m.from), to: agentRef(m.to), taskId: taskRef(m.taskId) })
  return run
}
