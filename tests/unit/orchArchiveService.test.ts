import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import { buildSnapshot } from '../../src/main/orch/snapshot'

const stores: OrchStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function setup() {
  const store = new OrchStore(':memory:'); stores.push(store)
  const svc = new OrchService(store, () => 2000)
  const run = svc.startRun({ kind: 'bug', projectPath: 'C:/repo', title: 'Crash', story: 'Fix it', plan: 'default' })
  const agent = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'sonnet' })
  svc.assignTask(run.id, 'T-1', agent.id)
  const decision = svc.raiseDecision(run.id, 'question', { question: 'How?', options: ['Yes'], context: 'context', taskId: svc.tasks(run.id)[0].id })
  store.putNote({ runId: run.id, key: 'findings', text: 'Retain this', author: agent.id, updatedAt: 1 })
  store.putMessage({ id: 'msg-one', runId: run.id, from: agent.id, to: 'human', taskId: svc.tasks(run.id)[0].id, body: 'Update', createdAt: 1, readAt: null })
  return { store, svc, run, agent, decision }
}

describe('service run archives', () => {
  it('exports every collection, preserves usage and strips launch secrets', () => {
    const { svc, run, agent } = setup()
    svc.reportUsage(agent.id, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reportedCostUsd: 0.25 })
    const archive = svc.exportRun(run.id, '1.0')
    expect(archive).toMatchObject({ format: 'dawsharun', run: { id: run.id }, notes: [{ text: 'Retain this' }], messages: [{ body: 'Update' }], agents: [{ usage: { reportedCostUsd: 0.25 } }] })
    expect(archive.events.length).toBeGreaterThan(0)
    expect(JSON.stringify(archive)).not.toContain('token')
    expect(() => svc.exportRun('missing')).toThrow(/not found/i)
  })

  it('imports collisions with all references remapped, no source records overwritten', () => {
    const { svc, run, agent, decision } = setup()
    const archive = svc.exportRun(run.id)
    const imported = svc.importRun(archive, 'laptop.dawsharun')
    expect(imported.id).not.toBe(run.id)
    expect(imported).toMatchObject({ stage: 'cancelled', finishedAt: 2000, imported: { at: 2000, from: 'laptop.dawsharun' } })
    expect(svc.tasks(imported.id)[0]).toMatchObject({ id: `${imported.id}:T-1`, runId: imported.id })
    const importedAgent = svc.agents(imported.id)[0]
    expect(importedAgent.id).not.toBe(agent.id)
    expect(importedAgent.retiredAt).toBe(2000)
    expect(importedAgent.launch).toBeUndefined()
    expect(svc.tasks(imported.id)[0].assignee).toBe(importedAgent.id)
    expect(svc.decisions(imported.id)[0].taskId).toBe(`${imported.id}:T-1`)
    expect(svc.openDecisions().map((d) => d.id)).toEqual([decision.id])
    expect(svc.agentForToken(agent.token)?.id).toBe(agent.id)
    expect(svc.run(run.id)?.stage).toBe('build')
    const exported = svc.exportRun(imported.id)
    expect(exported.notes[0].author).toBe(importedAgent.id)
    expect(exported.messages[0]).toMatchObject({ from: importedAgent.id, taskId: `${imported.id}:T-1` })
    expect(exported.events.every((e) => e.runId === imported.id)).toBe(true)
    expect(buildSnapshot(svc, () => null, { enabled: true, running: true, error: null }).runs.find((r) => r.id === imported.id)?.imported).toEqual(imported.imported)
  })

  it('rejects archived messages targeting a live agent outside the archive', () => {
    const { svc, store, run, agent } = setup()
    const archive = svc.exportRun(run.id)
    const foreign = svc.startRun({ kind: 'bug', projectPath: 'C:/repo', title: 'Live', story: 's', plan: 'default' })
    const live = svc.registerAgent({ runId: foreign.id, role: 'fixer', runner: 'claude', model: 'x' })
    const hostile = { ...archive, messages: [{ ...archive.messages[0], from: agent.id, to: live.id, readAt: null }] }
    expect(() => svc.importRun(hostile)).toThrow(/references/i)
    expect(store.unreadFor(live.id)).toEqual([])
    expect(svc.runs()).toHaveLength(2)
  })

  it('remaps decision note keys with their decision IDs', () => {
    const { svc, store, run, decision } = setup()
    svc.answerDecision(decision.id, 'Yes')
    const imported = svc.importRun(svc.exportRun(run.id))
    const newDecision = svc.decisions(imported.id)[0]
    expect(store.listNotes(imported.id).some((n) => n.key === `decision:${newDecision.id}` && n.text.includes('Yes'))).toBe(true)
  })

  it('cannot overwrite another run through a crafted task namespace collision', () => {
    const { svc, store, run } = setup()
    const task = svc.tasks(run.id)[0]
    store.putRun({ ...run, id: 'archive:suffix' })
    store.putTask({ ...task, id: 'archive:suffix:T-1', runId: 'archive:suffix', summary: 'Keep this' })
    const archive = svc.exportRun(run.id)
    const imported = svc.importRun({ ...archive, run: { ...archive.run, id: 'archive' },
      tasks: [{ ...task, id: 'archive:suffix:T-1', key: 'suffix:T-1', runId: 'archive', assignee: null }],
      agents: [], decisions: [], notes: [], messages: [], events: [] })
    expect(imported.id).not.toBe('archive')
    expect(svc.task('T-1', 'archive:suffix').summary).toBe('Keep this')
  })

  it('preserves completed stage and id in an empty store; imports agents retired', () => {
    const { svc, run } = setup()
    svc.finishRun(run.id)
    const store = new OrchStore(':memory:'); stores.push(store)
    const other = new OrchService(store)
    const imported = other.importRun(svc.exportRun(run.id))
    expect(imported.id).toBe(run.id)
    expect(imported.stage).toBe('done')
    expect(other.agents(run.id).every((a) => Boolean(a.retiredAt))).toBe(true)
    expect(other.agentForToken(other.agents(run.id)[0].token)).toBeUndefined()
  })

  it('rolls back every record if any insert fails, without notifying listeners', () => {
    const { svc, store, run } = setup()
    const archive = svc.exportRun(run.id)
    const notify = vi.fn(); svc.onChange(notify)
    vi.spyOn(store, 'putMessage').mockImplementationOnce(() => { throw new Error('disk full') })
    expect(() => svc.importRun(archive)).toThrow('disk full')
    expect(svc.runs()).toHaveLength(1)
    expect(svc.agents(run.id)).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects mutations to imported history and validates direct import callers', () => {
    const { svc, run, decision } = setup()
    const imported = svc.importRun(svc.exportRun(run.id))
    const before = svc.exportRun(imported.id)
    expect(() => svc.setStage(imported.id, 'build')).toThrow(/read.only/i)
    expect(() => svc.finishRun(imported.id)).toThrow(/read.only/i)
    expect(() => svc.answerDecision(svc.decisions(imported.id)[0].id, 'Yes')).toThrow(/read.only/i)
    expect(() => svc.handoffTask(imported.id, 'T-1', { runner: 'codex', model: 'x' })).toThrow(/read.only/i)
    expect(() => svc.registerAgent({ runId: imported.id, role: 'fixer', runner: 'claude', model: 'x' })).toThrow(/read.only/i)
    const agentId = svc.agents(imported.id)[0].id
    expect(() => svc.setLaunch(agentId, { agent: 'claude', args: [], env: {}, files: [] })).toThrow(/read.only/i)
    expect(() => svc.reportUsage(agentId, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: 0 })).toThrow(/read.only/i)
    expect(() => svc.raiseDecision(imported.id, 'question', { question: 'New?', options: [], context: '', taskId: null })).toThrow(/read.only/i)
    expect(svc.exportRun(imported.id)).toEqual(before)
    expect(svc.decisions(run.id)[0].id).toBe(decision.id)
    expect(() => svc.importRun({ ...before, version: 5 } as never)).toThrow(/version/i)
  })
})
