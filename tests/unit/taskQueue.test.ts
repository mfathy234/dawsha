import { describe, expect, it } from 'vitest'
import { availableQueueTasks, transitionQueueTask, type QueueTask } from '../../src/shared/taskQueue'

const tasks: QueueTask[] = [
  { id: 'a', state: 'queued' }, { id: 'b', state: 'running' }, { id: 'c', state: 'queued' }, { id: 'd', state: 'done' }
]

describe('task queue scheduling', () => {
  it('selects queued work up to free concurrency slots', () => {
    expect(availableQueueTasks(tasks, 2).map((task) => task.id)).toEqual(['a'])
    expect(availableQueueTasks(tasks, 3).map((task) => task.id)).toEqual(['a', 'c'])
  })
  it('returns a new task for state transitions', () => {
    const next = transitionQueueTask(tasks, 'a', 'running')
    expect(next[0].state).toBe('running')
    expect(tasks[0].state).toBe('queued')
  })
})

import { moveQueueTask, nextTrackedState, startTracker, type QueueTracker } from '../../src/shared/taskQueue'

describe('queue order', () => {
  it('moves a task up or down without changing the input', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(moveQueueTask(list, 'c', -1).map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(moveQueueTask(list, 'a', -1)).toEqual(list)
    expect(moveQueueTask(list, 'c', 1)).toEqual(list)
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('running task tracking', () => {
  const step = (t: QueueTracker, status: 'busy' | 'idle' | 'exited' | 'gone', exitCode?: number) => nextTrackedState(t, status, exitCode)
  it('is done once the agent was busy and stayed idle for two checks', () => {
    let t = startTracker()
    t = step(t, 'idle').tracker
    expect(step(t, 'idle').outcome).toBe('running')
    t = step(t, 'busy').tracker
    t = step(t, 'idle').tracker
    expect(step(t, 'busy').tracker.idleChecks).toBe(0)
    t = step(t, 'idle').tracker
    expect(step(t, 'idle').outcome).toBe('done')
  })
  it('maps exits and vanished panes', () => {
    expect(step(startTracker(), 'exited', 0).outcome).toBe('done')
    expect(step(startTracker(), 'exited', 1).outcome).toBe('failed')
    expect(step(startTracker(), 'gone').outcome).toBe('failed')
  })
})
