import type { OrchRun, RunKind } from '../../shared/orch/types'
import { randomId, type OrchContext } from './context'
import type { CreateRunInput } from './service'

/** `leadFirst`: a feature starts with its lead, who decides whether it needs a spec and which roles to use. */
export function createStoredRun(ctx: OrchContext, input: CreateRunInput, leadFirst: boolean): OrchRun {
  const kind: RunKind = input.kind ?? 'feature'
  const run: OrchRun = {
    id: randomId('run'),
    kind,
    projectPath: input.projectPath,
    title: input.title,
    story: input.story,
    plan: input.plan,
    // A bug skips the spec and planning stages: one fixer works straight from the report.
    stage: kind === 'bug' ? 'build' : leadFirst ? 'plan' : 'spec',
    createdAt: ctx.now(),
    finishedAt: null,
    projectId: input.projectId ?? null,
    specApproval: input.specApproval !== false,
    leadProfileId: input.leadProfileId ?? null,
    solo: input.solo === true,
    fixerProfileId: input.fixerProfileId ?? null
  }
  ctx.store.putRun(run)
  ctx.log(run.id, 'run', `${kind === 'bug' ? 'Bug fix' : 'Run'} started: ${run.title}`, null)
  if (kind === 'bug') {
    const task = ctx.newTask(run.id, { title: run.title, spec: run.story, role: 'fixer', dependsOn: [], acceptance: [] })
    ctx.log(run.id, 'task', `${task.key} created for fixer: ${task.title}`, task.id)
  }
  return run
}
