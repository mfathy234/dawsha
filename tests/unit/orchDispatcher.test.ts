import { describe, expect, it } from 'vitest'
import { Dispatcher, type OrchPaneRequest } from '../../src/main/orch/dispatcher'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import type { MergeOutcome } from '../../src/main/orch/worktrees'
import { defaultOrchSettings, type OrchSettings } from '../../src/shared/orch/profiles'

function setup(settings: OrchSettings = defaultOrchSettings()) {
  let t = 0
  let session = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const panes: OrchPaneRequest[] = []
  const merges: string[] = []
  const written: string[] = []
  let mergeResult: MergeOutcome = { ok: true, conflict: false, message: 'merged' }
  const dispatcher = new Dispatcher({
    service: svc,
    settings: () => settings,
    worktrees: {
      createTaskWorktree: async (_repo, runId, key) => ({ path: `C:/wt/${runId}-${key.toLowerCase()}`, branch: `orch/x/${key.toLowerCase()}` }),
      runWorktree: async (_repo, runId) => ({ path: `C:/wt/${runId}`, branch: 'orch/x/run' }),
      mergeTaskIntoRun: async (_repo, _runId, key) => {
        merges.push(key)
        return mergeResult
      }
    },
    mcpUrl: () => 'http://127.0.0.1:5000/mcp',
    configDir: (id) => `C:/data/orch/${id}`,
    writeFiles: async (files) => {
      written.push(...files.map((f) => f.path))
    },
    openPane: (request) => panes.push(request),
    newSessionId: () => `session-${(session += 1)}`,
    log: () => undefined
  })
  return { svc, dispatcher, panes, merges, written, setMerge: (m: MergeOutcome) => (mergeResult = m) }
}

const agentOf = (svc: OrchService, pane: OrchPaneRequest) => {
  const agent = svc.agent(pane.agentId)
  if (!agent) throw new Error('agent missing')
  return agent
}

describe('orchestrator dispatcher', () => {
  it('starts one fixer for a bug run, on the profile the user picked, in its own worktree', async () => {
    const { svc, dispatcher, panes, written } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', projectId: 'p1', title: 'Export crash', story: 'It throws.', plan: 'default', fixerProfileId: 'p-implementer' })
    await dispatcher.tick()
    await dispatcher.tick()
    expect(panes).toHaveLength(1)
    expect(panes[0]).toMatchObject({ runner: 'codex', folder: `C:/wt/${run.id}-t-1`, projectId: 'p1', sessionId: null })
    expect(panes[0].prompt).toContain('with no other agents')
    expect(svc.task('T-1', run.id)).toMatchObject({ status: 'assigned', assignee: panes[0].agentId })
    expect(agentOf(svc, panes[0]).launch?.agent).toBe('codex')
    expect(written).toEqual([])
  })

  it('uses the plan lead model for a bug fix when the user picked nothing', async () => {
    const { svc, dispatcher, panes, written } = setup()
    svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', title: 'Crash', story: 's', plan: 'default' })
    await dispatcher.tick()
    expect(panes[0]).toMatchObject({ runner: 'claude', sessionId: 'session-1' })
    expect(panes[0].title).toContain('opus')
    expect(written[0]).toMatch(/claude-mcp\.json$/)
  })

  it('runs a feature from spec to finished: spec writer, lead, workers, reviewers, merges, completion', async () => {
    const { svc, dispatcher, panes, merges } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'CSV export', story: 'Export usage.', plan: 'default' })
    await dispatcher.tick()
    expect(panes.map((p) => p.title)).toEqual(['Spec writer · sonnet · T-1'])
    expect(panes[0].folder).toBe(`C:/wt/${run.id}`)
    const writer = agentOf(svc, panes[0])
    svc.call(writer, 'get_my_task', {})
    svc.call(writer, 'complete_task', { summary: 'spec v1' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Approve')

    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('plan')
    expect(panes[1].title).toBe('Lead · opus')
    const lead = agentOf(svc, panes[1])
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer' })
    svc.call(lead, 'create_task', { title: 'Check', spec: 's', role: 'tester', depends_on: ['T-2'] })

    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('build')
    expect(panes.slice(2).map((p) => p.title)).toEqual(['Implementer · codex · T-2'])
    const impl = agentOf(svc, panes[2])
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'complete_task', { summary: 'done' })

    await dispatcher.tick()
    const reviewPane = panes[3]
    expect(reviewPane.title).toBe('Code reviewer · sonnet · T-4')
    expect(reviewPane.folder).toBe(`C:/wt/${run.id}-t-2`)
    const reviewer = agentOf(svc, reviewPane)
    svc.call(reviewer, 'get_my_task', {})
    svc.call(reviewer, 'submit_review', { verdict: 'approve', comments: 'ok' })

    await dispatcher.tick()
    expect(merges).toEqual(['T-2'])
    expect(svc.task('T-2', run.id).mergedAt).not.toBeNull()
    expect(panes[4].title).toBe('Tester · haiku · T-3')
    const tester = agentOf(svc, panes[4])
    svc.call(tester, 'get_my_task', {})
    svc.call(tester, 'complete_task', { summary: 'all pass' })

    await dispatcher.tick()
    expect(merges).toEqual(['T-2', 'T-3'])
    expect(svc.run(run.id)?.stage).toBe('merge')
    const complete = svc.openDecisions().find((d) => d.kind === 'run-complete')
    expect(complete?.question).toContain('orch/')
    svc.answerDecision(complete!.id, 'Mark as done')
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('done')
    expect(svc.agents(run.id).every((a) => a.retiredAt)).toBe(true)
  })

  it('keeps within the plan worker limit', async () => {
    const settings = defaultOrchSettings()
    settings.plans[0] = { ...settings.plans[0], maxWorkers: 2 }
    const { svc, dispatcher, panes } = setup(settings)
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Big', story: 's', plan: 'default', specApproval: false })
    await dispatcher.tick()
    const writer = agentOf(svc, panes[0])
    svc.call(writer, 'get_my_task', {})
    svc.call(writer, 'complete_task', { summary: 'spec' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[1])
    for (const title of ['A', 'B', 'C', 'D']) svc.call(lead, 'create_task', { title, spec: 's', role: 'implementer' })
    await dispatcher.tick()
    expect(panes.slice(2).map((p) => p.title)).toEqual(['Implementer · codex · T-2', 'Implementer · codex · T-3'])
    expect(svc.tasks(run.id).filter((t) => t.status === 'todo')).toHaveLength(2)
  })

  it('asks the human once about a merge conflict and retries after the answer', async () => {
    const { svc, dispatcher, panes, merges, setMerge } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', title: 'Crash', story: 's', plan: 'default' })
    await dispatcher.tick()
    const fixer = agentOf(svc, panes[0])
    svc.call(fixer, 'get_my_task', {})
    svc.call(fixer, 'complete_task', { summary: 'fixed' })
    setMerge({ ok: false, conflict: true, message: 'conflict in csv.ts' })
    await dispatcher.tick()
    await dispatcher.tick()
    const conflicts = svc.openDecisions().filter((d) => d.kind === 'merge-conflict')
    expect(conflicts).toHaveLength(1)
    setMerge({ ok: true, conflict: false, message: 'merged' })
    svc.answerDecision(conflicts[0].id, 'I resolved it')
    await dispatcher.tick()
    expect(merges).toEqual(['T-1', 'T-1', 'T-1'])
    expect(svc.task('T-1', run.id).mergedAt).not.toBeNull()
    expect(svc.run(run.id)?.stage).toBe('merge')
  })
})
