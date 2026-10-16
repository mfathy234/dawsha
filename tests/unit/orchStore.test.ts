import { describe, expect, it } from 'vitest'
import { OrchStore } from '../../src/main/orch/store'

describe('OrchStore', () => {
  it('round-trips runs, tasks, agents, messages, notes, decisions and events', () => {
    const s = new OrchStore(':memory:')
    s.putRun({ id: 'r1', projectPath: 'C:/p', title: 'Story', story: 's', plan: 'Default', stage: 'build', createdAt: 1, finishedAt: null })
    expect(s.getRun('r1')?.title).toBe('Story')
    expect(s.nextTaskNumber('r1')).toBe(1)
    s.putTask({ id: 'r1:T-1', key: 'T-1', runId: 'r1', title: 't', spec: '', role: 'ui', status: 'todo', dependsOn: [], acceptance: [], reviewOf: null, reviewRound: 0, assignee: null, summary: null, files: [], branch: null, feedback: null, pausedFrom: null, createdAt: 1, updatedAt: 1 })
    expect(s.nextTaskNumber('r1')).toBe(2)
    expect(s.listTasks({ runId: 'r1', status: 'todo' })).toHaveLength(1)
    s.putAgent({ id: 'a1', runId: 'r1', role: 'ui', runner: 'claude', model: 'sonnet', token: 'tok', taskId: null, createdAt: 1 })
    expect(s.agentByToken('tok')?.id).toBe('a1')
    s.putMessage({ id: 'm1', runId: 'r1', from: 'a0', to: 'a1', taskId: null, body: 'hi', createdAt: 1, readAt: null })
    expect(s.unreadFor('a1')).toHaveLength(1)
    s.putNote({ runId: 'r1', key: 'k', text: 'v', author: 'a1', updatedAt: 1 })
    expect(s.listNotes('r1')[0].text).toBe('v')
    s.addEvent({ runId: 'r1', at: 1, kind: 'task', text: 'created', taskId: 'r1:T-1' })
    expect(s.listEvents('r1')).toHaveLength(1)
  })
  it('keeps data in a file between instances', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const file = join(mkdtempSync(join(tmpdir(), 'orch-')), 'orch.db')
    const a = new OrchStore(file)
    a.putRun({ id: 'r9', projectPath: 'p', title: 'kept', story: '', plan: 'x', stage: 'spec', createdAt: 1, finishedAt: null })
    a.close()
    expect(new OrchStore(file).getRun('r9')?.title).toBe('kept')
  })
})
