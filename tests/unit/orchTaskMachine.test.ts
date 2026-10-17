import { describe, expect, it } from 'vitest'
import { canMove, isFinal, moveTask, pauseTask, resumeTask } from '../../src/shared/orch/taskMachine'
import type { OrchTask } from '../../src/shared/orch/types'

const task = (over: Partial<OrchTask> = {}): OrchTask => ({
  id: 'r1:T-1', key: 'T-1', runId: 'r1', title: 'x', spec: '', role: 'implementer', status: 'todo',
  dependsOn: [], acceptance: [], reviewOf: null, reviewRound: 0, assignee: null, summary: null,
  files: [], branch: null, feedback: null, pausedFrom: null, createdAt: 1, updatedAt: 1, ...over
})

describe('task state machine', () => {
  it('allows the normal path to approval', () => {
    expect(canMove('todo', 'in_progress')).toBe(true)
    expect(canMove('in_progress', 'done_pending_review')).toBe(true)
    expect(canMove('done_pending_review', 'in_review')).toBe(true)
    expect(canMove('in_review', 'approved')).toBe(true)
  })
  it('rejects moves out of final states', () => {
    expect(isFinal('approved')).toBe(true)
    expect(canMove('approved', 'in_progress')).toBe(false)
    expect(() => moveTask(task({ status: 'cancelled' }), 'todo', 2)).toThrow(/cannot move/i)
  })
  it('returns a new object and stamps updatedAt', () => {
    const before = task()
    const after = moveTask(before, 'in_progress', 5)
    expect(after).not.toBe(before)
    expect(before.status).toBe('todo')
    expect(after).toMatchObject({ status: 'in_progress', updatedAt: 5 })
  })
  it('pauses from any open state and resumes where it was', () => {
    const paused = pauseTask(task({ status: 'in_review' }), 'waiting_on_human', 3)
    expect(paused).toMatchObject({ status: 'waiting_on_human', pausedFrom: 'in_review' })
    expect(resumeTask(paused, 4)).toMatchObject({ status: 'in_review', pausedFrom: null })
    expect(() => pauseTask(task({ status: 'approved' }), 'blocked', 3)).toThrow()
    expect(() => resumeTask(task({ status: 'in_progress' }), 3)).toThrow(/not paused/i)
  })
})
