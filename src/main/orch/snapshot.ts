import type { OrchAgentRow, OrchAgentState, OrchDecisionView, OrchRunDetail, OrchSnapshot, OrchStatus } from '../../shared/orch/api'
import type { OrchAgent, OrchDecision, OrchRun, OrchTask } from '../../shared/orch/types'
import type { PriceLookup } from '../../shared/orch/usage'
import { ACTIVE } from './context'
import type { OrchService } from './service'
import { runBranch } from './worktrees'

const MAX_EVENTS = 200

function agentState(agent: OrchAgent, task: OrchTask | undefined): OrchAgentState {
  if (agent.retiredAt) return 'done'
  if (!task) return 'idle'
  if (task.status === 'stalled') return 'stalled'
  if (task.status === 'waiting_on_human' || task.status === 'blocked') return 'waiting'
  return 'working'
}

function agentRows(agents: readonly OrchAgent[], tasks: readonly OrchTask[]): OrchAgentRow[] {
  return agents.map((agent) => {
    const task = tasks.find((t) => t.assignee === agent.id && ACTIVE.includes(t.status))
    return {
      id: agent.id,
      role: agent.role,
      runner: agent.runner,
      model: agent.model,
      state: agentState(agent, task),
      taskKey: task?.key ?? null,
      retired: Boolean(agent.retiredAt)
    }
  })
}

const isDone = (task: OrchTask): boolean => task.status === 'approved' || task.status === 'cancelled'

export function runDetail(service: OrchService, run: OrchRun, open: readonly OrchDecision[], prices: PriceLookup): OrchRunDetail {
  const tasks = service.tasks(run.id)
  const events = service.events(run.id)
  return {
    imported: run.imported,
    decisions: service.decisions(run.id),
    id: run.id,
    kind: run.kind,
    title: run.title,
    stage: run.stage,
    projectId: run.projectId ?? null,
    createdAt: run.createdAt,
    taskCount: tasks.length,
    tasksDone: tasks.filter(isDone).length,
    openDecisions: open.filter((d) => d.runId === run.id).length,
    story: run.story,
    plan: run.plan,
    projectPath: run.projectPath,
    finishedAt: run.finishedAt,
    branch: runBranch(run.id),
    tasks,
    agents: agentRows(service.agents(run.id), tasks),
    usage: service.runUsage(run.id, prices),
    events: events.slice(-MAX_EVENTS)
  }
}

export function decisionView(service: OrchService, decision: OrchDecision): OrchDecisionView {
  const task = decision.taskId ? service.tasks(decision.runId).find((t) => t.id === decision.taskId) : undefined
  const agent = decision.agentId ? service.agent(decision.agentId) : undefined
  return {
    id: decision.id,
    kind: decision.kind,
    runId: decision.runId,
    runTitle: service.run(decision.runId)?.title ?? '',
    question: decision.question,
    options: decision.options,
    context: decision.context,
    createdAt: decision.createdAt,
    taskKey: task?.key ?? null,
    agentRole: agent?.role ?? null,
    agentModel: agent?.model ?? null
  }
}

export function buildSnapshot(service: OrchService | null, prices: PriceLookup, status: OrchStatus): OrchSnapshot {
  if (!service) return { status, runs: [], decisions: [] }
  const open = service.openDecisions()
  return {
    status,
    runs: service.runs().map((run) => runDetail(service, run, open, prices)),
    decisions: open.map((d) => decisionView(service, d))
  }
}
