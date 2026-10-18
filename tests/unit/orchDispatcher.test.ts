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
  const closed: string[] = []
  const merges: string[] = []
  const written: string[] = []
  const folders: string[] = []
  const cleanups: string[] = []
  let onRunFolder = () => {}
  let mergeResult: MergeOutcome = { ok: true, conflict: false, message: 'merged' }
  const dispatcher = new Dispatcher({
    service: svc,
    settings: () => settings,
    worktrees: {
      createTaskWorktree: async (_repo, runId, key) => { folders.push(key); return { path: `C:/wt/${runId}-${key.toLowerCase()}`, branch: `orch/x/${key.toLowerCase()}` } },
      runWorktree: async (_repo, runId) => { onRunFolder(); return { path: `C:/wt/${runId}`, branch: 'orch/x/run' } },
      mergeTaskIntoRun: async (_repo, _runId, key) => {
        merges.push(key)
        return mergeResult
      }
    },
    cleanUp: async () => { cleanups.push('run'); return { at: 1, removed: 2, deletedBranches: [], kept: [], failed: [] } },
    mcpUrl: () => 'http://127.0.0.1:5000/mcp',
    configDir: (id) => `C:/data/orch/${id}`,
    writeFiles: async (files) => {
      written.push(...files.map((f) => f.path))
    },
    openPane: (request) => panes.push(request),
    closePane: (agentId) => closed.push(agentId),
    newSessionId: () => `session-${(session += 1)}`,
    log: () => undefined
  })
  return { svc, dispatcher, cleanups, panes, closed, merges, written, folders, setRunFolder: (fn: () => void) => { onRunFolder = fn }, setMerge: (m: MergeOutcome) => (mergeResult = m) }
}

const agentOf = (svc: OrchService, pane: OrchPaneRequest) => {
  const agent = svc.agent(pane.agentId)
  if (!agent) throw new Error('agent missing')
  return agent
}

describe('orchestrator dispatcher', () => {
  it('uses the run lead override and tells a solo lead to work alone', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/repo', title: 'Solo', story: 's', plan: 'default', leadProfileId: 'p-implementer-codex', solo: true })
    await dispatcher.tick()
    expect(panes[0]).toMatchObject({ runner: 'codex', folder: `C:/wt/${run.id}` })
    expect(agentOf(svc, panes[0]).role).toBe('lead')
    expect(panes[0].prompt).toMatch(/work alone.*self: true/i)
  })

  it.each([false, true])('restarts a lead with an unfinished task: %s', async (withTask) => {
    const { svc, dispatcher, panes, closed } = setup()
    const run = svc.startRun({ projectPath: 'C:/repo', title: 'Restart', story: 's', plan: 'default', leadProfileId: 'p-lead-budget' })
    await dispatcher.tick()
    const first = agentOf(svc, panes[0])
    if (withTask) svc.call(first, 'create_task', { title: 'Own work', spec: 's', role: 'implementer', self: true })
    await dispatcher.restart(run.id, first.id)
    await dispatcher.tick()
    expect(panes).toHaveLength(2)
    expect(closed).toEqual([first.id])
    expect(svc.agent(first.id)?.retiredAt).toBeTruthy()
    expect(panes[1]).toMatchObject({ runner: panes[0].runner, folder: panes[0].folder, title: withTask ? 'Lead · sonnet · T-1' : 'Lead · sonnet' })
    expect(panes[1].prompt).toMatch(/continuing after a restart/i)
    expect(agentOf(svc, panes[1]).model).toBe('sonnet')
    if (withTask) expect(svc.task('T-1', run.id).assignee).toBe(panes[1].agentId)
    await expect(dispatcher.restart(run.id, first.id)).rejects.toThrow(/active/i)
  })

  it('restarts a task agent on its handoff profile in the same worktree', async () => {
    const { svc, dispatcher, panes, closed } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/repo', title: 'Restart', story: 's', plan: 'default' })
    await dispatcher.tick()
    await dispatcher.handoff(run.id, 'T-1', defaultOrchSettings().profiles.find((p) => p.id === 'p-implementer-codex')!, 'Switch')
    const first = agentOf(svc, panes[1])
    await dispatcher.restart(run.id, first.id)
    expect(panes).toHaveLength(3)
    expect(closed).toContain(first.id)
    expect(panes[2]).toMatchObject({ runner: 'codex', folder: panes[1].folder })
    expect(panes[2].prompt).toMatch(/continuing after a restart/i)
    expect(svc.task('T-1', run.id).assignee).toBe(panes[2].agentId)
    svc.finishRun(run.id)
    await expect(dispatcher.restart(run.id, panes[2].agentId)).rejects.toThrow(/read.only/i)
    const imported = svc.importRun(svc.exportRun(run.id))
    await expect(dispatcher.restart(imported.id, panes[2].agentId)).rejects.toThrow(/read.only/i)
  })

  it('coalesces competing restarts of a task agent and rejects agents from another run', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/repo', title: 'Restart', story: 's', plan: 'default' })
    const other = svc.startRun({ projectPath: 'C:/other', title: 'Other', story: 's', plan: 'default' })
    await dispatcher.tick()
    const first = panes.find((p) => p.runId === run.id)!
    await expect(dispatcher.restart(other.id, first.agentId)).rejects.toThrow(/active/i)
    const results = await Promise.allSettled([dispatcher.restart(run.id, first.agentId), dispatcher.restart(run.id, first.agentId)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(svc.agents(run.id).filter((a) => !a.retiredAt)).toHaveLength(1)
    expect(panes.filter((p) => p.runId === run.id)).toHaveLength(2)
  })

  it('keeps a planning lead question and unread inbox through restart', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/repo', title: 'Question', story: 's', plan: 'default' })
    await dispatcher.tick()
    const first = agentOf(svc, panes[0])
    svc.call(first, 'ask_human', { question: 'Which API?' })
    svc.notifyRole(run.id, 'lead', 'Keep the current API')
    const question = svc.openDecisions()[0]
    await dispatcher.restart(run.id, first.id)
    const next = agentOf(svc, panes[1])
    expect(svc.openDecisions()[0].agentId).toBe(next.id)
    svc.answerDecision(question.id, 'Use v2')
    expect(svc.call(next, 'fetch_inbox', {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Keep the current API' }), expect.objectContaining({ body: expect.stringContaining('Use v2') })
    ]))
  })

  it.each([true, false])('restarts an author waiting for review without losing review feedback (lead: %s)', async (self) => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/repo', title: 'Review', story: 's', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'create_task', { title: 'Work', spec: 's', role: 'implementer', self, review: true })
    await dispatcher.tick()
    const first = self ? lead : agentOf(svc, panes[1])
    svc.call(first, 'get_my_task', {})
    svc.call(first, 'complete_task', { summary: 'Ready' })
    await dispatcher.tick()
    const reviewer = svc.agents(run.id).find((a) => a.role === 'code-reviewer')!
    svc.call(reviewer, 'get_my_task', {})
    await dispatcher.restart(run.id, first.id)
    const next = svc.agents(run.id).find((a) => a.role === first.role && !a.retiredAt)!
    expect(svc.task('T-1', run.id)).toMatchObject({ assignee: next.id, status: 'done_pending_review' })
    expect(panes.at(-1)?.folder).toBe(panes.find((p) => p.agentId === first.id)?.folder)
    svc.call(reviewer, 'submit_review', { verdict: 'reject', comments: 'Fix validation' })
    expect(svc.call(next, 'get_my_task', {})).toMatchObject({ key: 'T-1', status: 'in_progress' })
    expect(svc.call(next, 'fetch_inbox', {})).toEqual(expect.arrayContaining([expect.objectContaining({ body: expect.stringContaining('Fix validation') })]))
  })

  it('preserves self work acquired while a lead restart prepares its worktree', async () => {
    const { svc, dispatcher, panes, setRunFolder } = setup()
    const run = svc.startRun({ projectPath: 'C:/repo', title: 'Race', story: 's', plan: 'default', solo: true, leadProfileId: 'p-lead-budget' })
    await dispatcher.tick()
    const first = agentOf(svc, panes[0])
    setRunFolder(() => {
      setRunFolder(() => {})
      svc.call(first, 'create_task', { title: 'Just acquired', spec: 's', role: 'implementer', self: true })
    })
    await dispatcher.restart(run.id, first.id)
    await dispatcher.tick()
    expect(panes).toHaveLength(2)
    expect(svc.task('T-1', run.id)).toMatchObject({ assignee: panes[1].agentId, status: 'assigned' })
    expect(svc.task('T-1', run.id).attempts ?? 0).toBe(0)
    expect(agentOf(svc, panes[1]).model).toBe('sonnet')
  })

  it('ignores imported runs even with an active stage and refuses handoff before filesystem work', async () => {
    const { svc, dispatcher, panes, merges, written, folders } = setup()
    const source = svc.startRun({ kind: 'bug', projectPath: 'C:/repo', title: 'Archive', story: 's', plan: 'default' })
    const imported = svc.importRun(svc.exportRun(source.id))
    svc.finishRun(source.id)
    // Simulate legacy persisted history with an active stage: the explicit imported guard is required.
    const originalRuns = svc.runs.bind(svc)
    svc.runs = () => originalRuns().map((r) => r.id === imported.id ? { ...r, stage: 'build' } : r)
    await dispatcher.tick()
    expect(panes).toEqual([])
    expect(merges).toEqual([])
    expect(written).toEqual([])
    expect(folders).toEqual([])
    await expect(dispatcher.handoff(imported.id, 'T-1', defaultOrchSettings().profiles[0], '')).rejects.toThrow(/read.only/i)
    expect(folders).toEqual([])
  })

  it('starts one fixer for a bug run, on the profile the user picked, in its own worktree', async () => {
    const { svc, dispatcher, panes, written } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', projectId: 'p1', title: 'Export crash', story: 'It throws.', plan: 'default', fixerProfileId: 'p-implementer-codex' })
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

  it('a larger change: the lead hands a task to an implementer and asks for its review', async () => {
    const { svc, dispatcher, panes, merges, closed, cleanups } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Hide server field', story: 'Hide one field.', plan: 'default' })
    expect(svc.tasks(run.id)).toEqual([])
    await dispatcher.tick()
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('plan')
    expect(panes.map((p) => p.title)).toEqual(['Lead · opus'])
    expect(panes[0].folder).toBe(`C:/wt/${run.id}`)
    expect(panes[0].prompt).toMatch(/set_estimate/)
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'create_task', { title: 'Hide the field', spec: 's', role: 'implementer', review: true })

    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('build')
    expect(panes.slice(1).map((p) => p.title)).toEqual(['Implementer · sonnet · T-1'])
    const impl = agentOf(svc, panes[1])
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'complete_task', { summary: 'done' })

    await dispatcher.tick()
    expect(panes[2].title).toBe('Code reviewer · sonnet · T-2')
    expect(panes[2].folder).toBe(`C:/wt/${run.id}-t-1`)
    const reviewer = agentOf(svc, panes[2])
    svc.call(reviewer, 'get_my_task', {})
    svc.call(reviewer, 'submit_review', { verdict: 'approve', comments: 'ok' })

    await dispatcher.tick()
    expect(merges).toEqual(['T-1'])
    expect(svc.run(run.id)?.stage).toBe('merge')
    expect(svc.agents(run.id)).toHaveLength(3)
    const complete = svc.openDecisions().find((d) => d.kind === 'run-complete')
    expect(complete?.question).toContain('orch/')
    svc.answerDecision(complete!.id, 'Mark as done')
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('done')
    expect(svc.agents(run.id).every((a) => a.retiredAt)).toBe(true)
    // The finished agents' panes close with the run.
    expect([...closed].sort()).toEqual(panes.map((p) => p.agentId).sort())
    // Worktrees are cleared once, after the panes closed, and the result is kept on the run.
    expect(cleanups).toEqual(['run'])
    expect(svc.run(run.id)?.cleanup?.removed).toBe(2)
    expect(svc.events(run.id).some((e) => e.kind === 'cleanup' && e.text === 'Cleaned up 2 worktrees')).toBe(true)
  })

  it('a small change: the lead does it itself, one agent and no review', async () => {
    const { svc, dispatcher, panes, merges } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Hide server field', story: 'Hide one field.', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    expect(svc.call(lead, 'create_task', { title: 'Hide the field', spec: 's', role: 'implementer', self: true })).toMatchObject({ key: 'T-1', role: 'lead', status: 'in_progress', assignee: lead.id })
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('build')
    expect(panes).toHaveLength(1)
    expect(svc.call(lead, 'get_my_task', {})).toMatchObject({ key: 'T-1' })
    expect(svc.call(lead, 'complete_task', { summary: 'hidden' })).toEqual({ status: 'approved' })
    await dispatcher.tick()
    // The lead worked on the run branch itself: nothing to merge, no reviewer, straight to the human.
    expect(merges).toEqual([])
    expect(svc.run(run.id)?.stage).toBe('merge')
    expect(svc.agents(run.id)).toHaveLength(1)
  })

  it('new work in the merge stage withdraws run-complete, goes back to build and starts the task', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'More work', story: 's', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'create_task', { title: 'Hide the field', spec: 's', role: 'implementer', self: true })
    await dispatcher.tick()
    svc.call(lead, 'complete_task', { summary: 'hidden' })
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('merge')
    const asked = svc.decisions(run.id).find((d) => d.kind === 'run-complete')
    expect(asked?.answer).toBeNull()

    svc.call(lead, 'create_task', { title: 'Another part', spec: 's', role: 'implementer' })
    expect(svc.run(run.id)?.stage).toBe('build')
    expect(svc.decisions(run.id).find((d) => d.id === asked?.id)?.answer).toMatch(/^Withdrawn: new work was added/)
    expect(svc.openDecisions()).toHaveLength(0)
    await dispatcher.tick()
    expect(svc.tasks(run.id).find((t) => t.key === 'T-2')).toMatchObject({ status: 'assigned' })
    expect(panes).toHaveLength(2)
  })

  it('reviews nothing unless the lead asks, never lets the lead add review tasks, and closes finished agents', async () => {
    const { svc, dispatcher, panes, closed } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Two parts', story: 's', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    expect(() => svc.call(lead, 'create_task', { title: 'Review it all', spec: 's', role: 'code-reviewer' })).toThrow(/review/i)
    svc.call(lead, 'create_task', { title: 'Backend', spec: 's', role: 'implementer' })
    await dispatcher.tick()
    const impl = agentOf(svc, panes[1])
    svc.call(impl, 'get_my_task', {})
    expect(svc.call(impl, 'complete_task', { summary: 'done' })).toEqual({ status: 'approved' })
    await dispatcher.tick()
    expect(svc.tasks(run.id).map((t) => t.role)).toEqual(['implementer'])
    // Its work is merged and it has nothing left: its pane closes, the lead's stays.
    expect(closed).toEqual([impl.id])
    expect(svc.agent(impl.id)?.retiredAt).not.toBeNull()
    expect(svc.agent(lead.id)?.retiredAt).toBeNull()
  })

  it('turns anything but "Mark as done" at the end into more work for the lead, then asks again', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Small', story: 's', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'create_task', { title: 'Do it', spec: 's', role: 'implementer', self: true })
    svc.call(lead, 'complete_task', { summary: 'done' })
    await dispatcher.tick()
    await dispatcher.tick()
    const ask = () => svc.openDecisions().find((d) => d.kind === 'run-complete')
    expect(ask()?.options).toEqual(['Mark as done', 'Push and open a PR'])
    svc.answerDecision(ask()!.id, 'Push and open a PR. Target develop and add the EF migration first.')
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('build')
    const follow = svc.tasks(run.id).find((t) => t.key === 'T-2')
    expect(follow).toMatchObject({ role: 'lead', status: 'in_progress', assignee: lead.id })
    expect(follow?.spec).toMatch(/pull request/i)
    expect(follow?.spec).toContain('add the EF migration first')
    expect(svc.unreadCount(lead.id)).toBe(1)
    expect(panes).toHaveLength(1)
    svc.call(lead, 'get_my_task', {})
    svc.call(lead, 'complete_task', { summary: 'PR 12 opened' })
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('merge')
    svc.answerDecision(ask()!.id, 'Mark as done')
    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('done')
  })

  it('lets the lead cancel the run when the human says so', async () => {
    const { svc, dispatcher, panes } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Wrong project', story: 's', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'cancel_run', { reason: 'The human said this run is on the wrong project.' })
    expect(svc.run(run.id)?.stage).toBe('cancelled')
  })

  it('writes a spec only when the lead asks for one, holds other work until it is approved, then tells the lead', async () => {
    const { svc, dispatcher, panes, merges } = setup()
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'CSV export', story: 'Export usage.', plan: 'default' })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    svc.call(lead, 'create_task', { title: 'Spec', spec: 's', role: 'spec-writer' })
    svc.call(lead, 'create_task', { title: 'Too early', spec: 's', role: 'implementer' })

    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('spec')
    expect(panes.slice(1).map((p) => p.title)).toEqual(['Spec writer · sonnet · T-1'])
    const writer = agentOf(svc, panes[1])
    svc.call(writer, 'get_my_task', {})
    svc.call(writer, 'complete_task', { summary: 'spec v1' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Approve')

    await dispatcher.tick()
    expect(svc.run(run.id)?.stage).toBe('build')
    // The lead is still running: it gets a message instead of a second pane.
    expect(panes.filter((p) => p.title.startsWith('Lead'))).toHaveLength(1)
    expect(svc.unreadCount(lead.id)).toBe(1)
    expect(svc.call(lead, 'fetch_inbox', {})).toEqual([expect.objectContaining({ from: 'dawsha', body: expect.stringContaining('approved') })])
    expect(panes.slice(2).map((p) => p.title)).toEqual(['Implementer · sonnet · T-2'])
    expect(merges).toEqual([])
  })

  it('keeps within the plan worker limit', async () => {
    const settings = defaultOrchSettings()
    settings.plans[0] = { ...settings.plans[0], maxWorkers: 2 }
    const { svc, dispatcher, panes } = setup(settings)
    const run = svc.startRun({ projectPath: 'C:/work/app', title: 'Big', story: 's', plan: 'default', specApproval: false })
    await dispatcher.tick()
    const lead = agentOf(svc, panes[0])
    for (const title of ['A', 'B', 'C', 'D']) svc.call(lead, 'create_task', { title, spec: 's', role: 'implementer' })
    await dispatcher.tick()
    expect(panes.slice(1).map((p) => p.title)).toEqual(['Implementer · sonnet · T-1', 'Implementer · sonnet · T-2'])
    expect(svc.tasks(run.id).filter((t) => t.status === 'todo')).toHaveLength(2)
  })

  it('continues a stalled task on the profile the human picked, in the same worktree', async () => {
    const { svc, dispatcher, panes, closed } = setup()
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/work/app', title: 'Crash', story: 's', plan: 'default' })
    await dispatcher.tick()
    const first = agentOf(svc, panes[0])
    svc.call(first, 'get_my_task', {})
    const decision = svc.reportStall(first.id, 'Claude usage limit reached', ['Continue with Implementer (Codex)', 'Wait'])
    svc.answerDecision(decision.id, 'Continue with Implementer (Codex)')
    await dispatcher.tick()
    await dispatcher.tick()
    expect(closed).toEqual([first.id])
    expect(panes).toHaveLength(2)
    expect(panes[1]).toMatchObject({ runner: 'codex', folder: panes[0].folder })
    const second = agentOf(svc, panes[1])
    expect(second.role).toBe('fixer')
    expect(svc.task('T-1', run.id).assignee).toBe(second.id)
    const inbox = svc.call(second, 'fetch_inbox', {}) as { body: string }[]
    expect(inbox[0].body).toContain('# Continue task T-1')
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
