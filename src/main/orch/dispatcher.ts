import type { OrchPaneRequest } from '../../shared/orch/api'
import { agentRunnerName, buildLaunch } from '../../shared/orch/launch'
import { DEFAULT_PLAN_ID, fixerProfileOf, profileFor, type OrchPlan, type OrchProfile, type OrchSettings } from '../../shared/orch/profiles'
import { firstMessage } from '../../shared/orch/rolePrompts'
import type { OrchAgent, OrchDecision, OrchRole, OrchRun, OrchTask } from '../../shared/orch/types'
import { ACTIVE } from './context'
import type { OrchService } from './service'
import { runBranch, type MergeOutcome, type OrchWorktree } from './worktrees'

export type { OrchPaneRequest } from '../../shared/orch/api'

export interface DispatcherDeps {
  service: OrchService
  settings: () => OrchSettings
  worktrees: {
    createTaskWorktree(repo: string, runId: string, taskKey: string): Promise<OrchWorktree>
    runWorktree(repo: string, runId: string): Promise<OrchWorktree>
    mergeTaskIntoRun(repo: string, runId: string, taskKey: string): Promise<MergeOutcome>
  }
  mcpUrl: () => string | null
  configDir: (agentId: string) => string
  writeFiles: (files: { path: string; content: string }[]) => Promise<void>
  openPane: (request: OrchPaneRequest) => void
  /** Closes the pane of an agent that was replaced. */
  closePane: (agentId: string) => void
  newSessionId: () => string
  log: (message: string) => void
}

const FINISHED_STAGES = new Set(['done', 'cancelled'])
/** Roles whose work lands on their own task branch and is merged into the run branch. */
const MERGED_ROLES: readonly OrchRole[] = ['implementer', 'ui', 'tester', 'fixer']
/** Roles that work on the run branch itself. */
const RUN_BRANCH_ROLES: readonly OrchRole[] = ['spec-writer', 'lead']
/** Answers to a stall card that hand the task to another profile look like "Continue with <profile name>". */
const CONTINUE_WITH = /^continue with\s+(.+)$/i

const ROLE_LABEL: Record<OrchRole, string> = {
  lead: 'Lead', 'spec-writer': 'Spec writer', implementer: 'Implementer', ui: 'UI', 'code-reviewer': 'Code reviewer',
  'ux-reviewer': 'UX reviewer', tester: 'Tester', fixer: 'Fixer'
}

/**
 * Turns the orchestrator's state into running agents: opens a pane for each task that is ready (within the
 * plan's worker limit), merges approved work into the run branch and moves runs through their stages.
 * It only reacts to service changes; agents themselves never start processes.
 */
export class Dispatcher {
  private running = false
  private again = false
  /** Tasks Dawsha already asked the human about (spawn failure, merge conflict), so it asks once. */
  private readonly flagged = new Set<string>()

  constructor(private readonly deps: DispatcherDeps) {}

  /** Coalesces bursts of changes into one pass at a time. */
  async tick(): Promise<void> {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      do {
        this.again = false
        for (const run of this.deps.service.runs()) {
          if (!run.imported && !FINISHED_STAGES.has(run.stage)) await this.advance(run)
        }
      } while (this.again)
    } finally {
      this.running = false
    }
  }

  private planOf(run: OrchRun): OrchPlan {
    const { plans } = this.deps.settings()
    return plans.find((p) => p.id === run.plan) ?? plans.find((p) => p.id === DEFAULT_PLAN_ID) ?? plans[0]
  }

  private async advance(run: OrchRun): Promise<void> {
    this.forgetAnswered(run)
    await this.continueElsewhere(run)
    await this.mergeApproved(run)
    if (this.finishIfAnswered(run)) return
    const tasks = this.deps.service.tasks(run.id)
    const plan = this.planOf(run)
    if (run.stage === 'spec' && tasks.some((t) => t.role === 'spec-writer' && t.status === 'approved')) {
      this.deps.service.setStage(run.id, 'plan')
      await this.startLead(run, plan)
      return
    }
    if (run.stage === 'plan' && tasks.some((t) => !RUN_BRANCH_ROLES.includes(t.role))) this.deps.service.setStage(run.id, 'build')
    if (this.allDone(run, tasks)) {
      this.deps.service.setStage(run.id, 'merge')
      this.deps.service.raiseDecision(run.id, 'run-complete', {
        question: `"${run.title}" is finished on branch ${runBranch(run.id)}. Review it and merge it into your main branch when ready.`,
        options: ['Mark as done'],
        context: tasks.map((t) => `${t.key} ${t.status}: ${t.title}`).join('\n'),
        taskId: null
      })
      return
    }
    await this.startReadyTasks(run, plan, tasks)
  }

  private allDone(run: OrchRun, tasks: OrchTask[]): boolean {
    if (run.stage !== 'build' || tasks.length === 0) return false
    return tasks.every((t) => (t.status === 'approved' || t.status === 'cancelled') && (!this.needsMerge(t) || t.mergedAt))
  }

  /** In the merge stage, answering the run-complete question ends the run. */
  private finishIfAnswered(run: OrchRun): boolean {
    if (run.stage !== 'merge') return false
    const answered = this.deps.service.decisions(run.id).some((d) => d.kind === 'run-complete' && d.answer !== null)
    if (answered) this.deps.service.finishRun(run.id)
    return true
  }

  private needsMerge(task: OrchTask): boolean {
    return task.status === 'approved' && !task.reviewOf && MERGED_ROLES.includes(task.role)
  }

  private async mergeApproved(run: OrchRun): Promise<void> {
    for (const task of this.deps.service.tasks(run.id).filter((t) => this.needsMerge(t) && !t.mergedAt)) {
      const outcome = await this.deps.worktrees.mergeTaskIntoRun(run.projectPath, run.id, task.key)
      if (outcome.ok) {
        this.deps.service.markMerged(run.id, task.key)
        continue
      }
      if (this.flagged.has(task.id)) continue
      this.flagged.add(task.id)
      this.deps.service.raiseDecision(run.id, 'merge-conflict', {
        question: `${task.key} "${task.title}" could not be merged into the run branch: ${outcome.message}`,
        options: ['I resolved it'],
        context: outcome.message,
        taskId: task.id
      })
    }
  }

  private workersBusy(run: OrchRun): number {
    const tasks = this.deps.service.tasks(run.id)
    return tasks.filter((t) => t.assignee && ACTIVE.includes(t.status) && t.role !== 'lead').length
  }

  private async startReadyTasks(run: OrchRun, plan: OrchPlan, tasks: OrchTask[]): Promise<void> {
    const approved = new Set(tasks.filter((t) => t.status === 'approved').map((t) => t.key))
    const ready = tasks.filter((t) => t.status === 'todo' && !t.assignee && t.dependsOn.every((key) => approved.has(key)))
    let free = (run.kind === 'bug' ? 1 : plan.maxWorkers) - this.workersBusy(run)
    for (const task of ready) {
      if (free <= 0) return
      const profile = run.kind === 'bug' ? this.fixerProfile(run, plan) : profileFor(this.deps.settings(), plan, task.role)
      if (!profile) {
        this.flagOnce(run, task, `The plan "${plan.name}" has no profile for the ${task.role} role.`)
        continue
      }
      if (await this.startAgent(run, profile, task)) free -= 1
    }
  }

  private fixerProfile(run: OrchRun, plan: OrchPlan): OrchProfile | undefined {
    const settings = this.deps.settings()
    return settings.profiles.find((p) => p.id === run.fixerProfileId) ?? fixerProfileOf(settings, plan)
  }

  private async startLead(run: OrchRun, plan: OrchPlan): Promise<void> {
    const live = this.deps.service.agents(run.id).some((a) => a.role === 'lead' && !a.retiredAt)
    const profile = profileFor(this.deps.settings(), plan, 'lead')
    if (live || !profile) return
    await this.startAgent(run, profile, null)
  }

  private async folderFor(run: OrchRun, role: OrchRole, task: OrchTask | null): Promise<OrchWorktree> {
    const { worktrees } = this.deps
    if (!task || RUN_BRANCH_ROLES.includes(role)) return worktrees.runWorktree(run.projectPath, run.id)
    // Reviewers look at the work in the worktree of the task they review.
    return worktrees.createTaskWorktree(run.projectPath, run.id, task.reviewOf ?? task.key)
  }

  /** Registers an agent for the task (or the lead with none), prepares its launch and asks for a pane. */
  private async startAgent(run: OrchRun, profile: OrchProfile, task: OrchTask | null): Promise<boolean> {
    const { service } = this.deps
    if (!this.deps.mcpUrl()) return false
    const role = task?.role ?? 'lead'
    try {
      const worktree = await this.folderFor(run, role, task)
      const agent = service.registerAgent({ runId: run.id, role, runner: agentRunnerName(profile), model: profile.model || 'default' })
      if (task) service.assignTask(run.id, task.key, agent.id)
      await this.openAgentPane(run, profile, agent, task, worktree)
      return true
    } catch (error) {
      this.deps.log(`orchestrator could not start ${role} for ${run.title}: ${(error as Error).message}`)
      if (task) this.flagOnce(run, task, `Dawsha could not start an agent: ${(error as Error).message}`)
      return false
    }
  }

  private async openAgentPane(run: OrchRun, profile: OrchProfile, agent: OrchAgent, task: OrchTask | null, worktree: OrchWorktree): Promise<void> {
    const mcpUrl = this.deps.mcpUrl()
    if (!mcpUrl) throw new Error('The orchestrator server is not running.')
    const sessionId = profile.runner === 'codex' ? null : this.deps.newSessionId()
    const prompt = firstMessage({ role: agent.role, runId: run.id, runTitle: run.title, branch: worktree.branch, extra: profile.prompt })
    const launch = { ...buildLaunch({ profile, mcpUrl, configDir: this.deps.configDir(agent.id), sessionId: sessionId ?? undefined }), firstMessage: prompt }
    await this.deps.writeFiles(launch.files)
    this.deps.service.setLaunch(agent.id, launch)
    this.deps.openPane({
      agentId: agent.id,
      runId: run.id,
      projectId: run.projectId ?? null,
      folder: worktree.path,
      runner: profile.runner,
      title: `${ROLE_LABEL[agent.role]} · ${profile.model || profile.runner}${task ? ` · ${task.key}` : ''}`,
      prompt,
      sessionId
    })
  }

  /** "Continue with <profile>" on a stall card: hand the task over and open the new agent's pane. */
  private async continueElsewhere(run: OrchRun): Promise<void> {
    const settings = this.deps.settings()
    for (const decision of this.deps.service.decisions(run.id)) {
      const target = this.handoffTarget(decision)
      if (!target) continue
      const task = this.deps.service.tasks(run.id).find((t) => t.id === decision.taskId)
      // Already handed over when the task's agent is no longer the one that stalled.
      if (!task || !ACTIVE.includes(task.status) || task.assignee !== decision.agentId) continue
      const profile = settings.profiles.find((p) => p.name === target && p.role === task.role) ?? settings.profiles.find((p) => p.name === target)
      if (!profile) continue
      try {
        await this.handoff(run.id, task.key, profile, `The previous agent stopped: ${decision.question}`)
      } catch (error) {
        this.deps.log(`orchestrator could not hand ${task.key} to ${target}: ${(error as Error).message}`)
      }
    }
  }

  /** Gives an unfinished task to a new agent on `profile`, in the same worktree, and opens its pane. */
  async handoff(runId: string, taskKey: string, profile: OrchProfile, note: string): Promise<void> {
    const run = this.deps.service.run(runId)
    if (!run) throw new Error('That run no longer exists.')
    if (run.imported || FINISHED_STAGES.has(run.stage)) throw new Error('This run is read-only.')
    const task = this.deps.service.task(taskKey, runId)
    const previous = task.assignee
    const worktree = await this.folderFor(run, task.role, task)
    const { agent } = this.deps.service.handoffTask(runId, taskKey, { runner: agentRunnerName(profile), model: profile.model || 'default', note })
    if (previous) this.deps.closePane(previous)
    await this.openAgentPane(run, profile, agent, task, worktree)
  }

  private handoffTarget(decision: OrchDecision): string | null {
    if (decision.kind !== 'stall' || !decision.answer || !decision.taskId) return null
    return CONTINUE_WITH.exec(decision.answer.trim())?.[1].trim() ?? null
  }

  /** Once the human answers "Retry" or "I resolved it", the task may be tried again. */
  private forgetAnswered(run: OrchRun): void {
    for (const decision of this.deps.service.decisions(run.id)) {
      if (decision.answer !== null && decision.taskId && decision.agentId === null) this.flagged.delete(decision.taskId)
    }
  }

  private flagOnce(run: OrchRun, task: OrchTask, message: string): void {
    if (this.flagged.has(task.id)) return
    this.flagged.add(task.id)
    this.deps.service.raiseDecision(run.id, 'stall', { question: `${task.key} "${task.title}": ${message}`, options: ['Retry'], context: message, taskId: task.id })
  }
}
