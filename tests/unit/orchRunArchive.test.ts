import { describe, expect, it } from 'vitest'
import { buildArchive, parseArchive, archiveToMarkdown, ARCHIVE_MAX_BYTES } from '../../src/shared/orch/runArchive'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function fixture() {
  const store = new OrchStore(':memory:')
  const svc = new OrchService(store, () => 1234)
  const run = svc.startRun({ kind: 'bug', title: 'Fix CSV', story: 'Empty ranges crash', projectPath: 'C:/repo', plan: 'default' })
  const agent = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'sonnet' })
  svc.reportUsage(agent.id, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 2, cacheWriteTokens: 3, reportedCostUsd: 0.5 })
  svc.assignTask(run.id, 'T-1', agent.id)
  svc.call(agent, 'get_my_task', {})
  svc.call(agent, 'complete_task', { summary: 'Fixed empty ranges' })
  const decision = svc.raiseDecision(run.id, 'run-complete', { question: 'Ready?', options: ['Done'], context: 'Checked', taskId: null })
  svc.answerDecision(decision.id, 'Done')
  const archive = buildArchive({ run: svc.run(run.id)!, tasks: svc.tasks(run.id), agents: svc.agents(run.id), decisions: svc.decisions(run.id), notes: store.listNotes(run.id), events: svc.events(run.id), messages: store.listMessages(run.id) }, '1.0', 1234)
  store.close()
  return archive
}

describe('run archives', () => {
  it('round trips all records with usage, stripping token and launch', () => {
    const archive = fixture()
    expect(archive.agents[0].usage?.reportedCostUsd).toBe(0.5)
    expect(archive.agents[0]).not.toHaveProperty('token')
    expect(archive.agents[0]).not.toHaveProperty('launch')
    expect(parseArchive(JSON.stringify(archive))).toEqual({ ok: true, archive })
  })

  it.each([
    ['format', 'zip'], ['version', 2], ['exportedAt', -1], ['tasks', {}],
    ['agents', Array(10001).fill({})], ['run', { id: 'bad' }]
  ])('rejects invalid %s', (key, value) => {
    expect(parseArchive(JSON.stringify({ ...fixture(), [key]: value })).ok).toBe(false)
  })

  it('bounds input and strings, rejects malformed and unknown nested fields', () => {
    expect(parseArchive('{').ok).toBe(false)
    expect(parseArchive(' '.repeat(ARCHIVE_MAX_BYTES + 1)).ok).toBe(false)
    const archive = fixture()
    expect(parseArchive(JSON.stringify({ ...archive, run: { ...archive.run, title: 'x'.repeat(100001) } })).ok).toBe(false)
    expect(parseArchive(JSON.stringify({ ...archive, agents: [{ ...archive.agents[0], token: 'secret' }] })).ok).toBe(false)
    expect(parseArchive(JSON.stringify({ ...archive, tasks: [{ ...archive.tasks[0], runId: 'other' }] })).ok).toBe(false)
    expect(parseArchive(JSON.stringify({ ...archive, tasks: [archive.tasks[0], archive.tasks[0]] })).ok).toBe(false)
    expect(parseArchive(JSON.stringify({ ...archive, events: [{ ...archive.events[0], at: Number.MAX_SAFE_INTEGER }] })).ok).toBe(false)
    expect(parseArchive(JSON.stringify({ ...archive, agents: [{ ...archive.agents[0], usage: { inputTokens: '10' } }] })).ok).toBe(false)
  })

  it('reports story, outcome, task summaries, answers, usage and timeline in Markdown', () => {
    const report = archiveToMarkdown(fixture())
    for (const text of ['Fix CSV', 'Empty ranges crash', 'Outcome', 'Fixed empty ranges', 'Ready?', 'Done', 'Usage', 'sonnet', '0.5', 'Timeline']) expect(report).toContain(text)
  })
})
