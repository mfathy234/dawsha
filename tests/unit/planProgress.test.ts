import { describe, expect, it } from 'vitest'
import { latestTodos, planProgress } from '../../src/shared/planProgress'
import type { TodoEntry } from '../../src/shared/chatCards'

const todo = (text: string, status: TodoEntry['status']): TodoEntry => ({ text, status })
const call = (todos?: TodoEntry[]) => ({ kind: 'tool', activity: 'todo', verb: 'Todos', ...(todos ? { todos } : {}) })

describe('planProgress', () => {
  it('counts finished tasks and names the one in progress', () => {
    const plan = planProgress([todo('a', 'completed'), todo('b', 'completed'), todo('c', 'in_progress'), todo('d', 'pending')])
    expect(plan).toEqual({ done: 2, total: 4, label: '2 of 4', percent: 50, current: 'c' })
  })

  it('falls back to the first task not yet done', () => {
    expect(planProgress([todo('a', 'completed'), todo('b', 'pending')])?.current).toBe('b')
  })

  it('is null for an empty list or when everything is done', () => {
    expect(planProgress([])).toBeNull()
    expect(planProgress([todo('a', 'completed')])).toBeNull()
  })
})

describe('latestTodos', () => {
  it('takes the last TodoWrite call', () => {
    const items = [call([todo('old', 'pending')]), { kind: 'message' }, call([todo('new', 'in_progress')])]
    expect(latestTodos(items).map((entry) => entry.text)).toEqual(['new'])
  })

  it('a call with no tasks clears the list', () => {
    expect(latestTodos([call([todo('old', 'pending')]), call()])).toEqual([])
  })

  it('ignores plan-mode tool rows and other tools', () => {
    const items = [call([todo('keep', 'pending')]), { kind: 'tool', activity: 'todo', verb: 'Plan' }, { kind: 'tool', activity: 'edit', verb: 'Edited' }]
    expect(latestTodos(items).map((entry) => entry.text)).toEqual(['keep'])
  })

  it('is empty with no TodoWrite at all', () => {
    expect(latestTodos([{ kind: 'message' }])).toEqual([])
  })
})
