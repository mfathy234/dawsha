import { describe, expect, it } from 'vitest'
import { keepRuns, MAX_CREW_RUNS, type CrewRun } from '../../src/shared/crew'

const run = (id: string, extra: Partial<CrewRun> = {}): CrewRun => ({
  id,
  memberId: 'omar',
  memberName: 'Omar',
  projectId: 'p1',
  projectName: 'Platforms',
  title: id,
  runner: 'claude',
  model: 'sonnet',
  startedAt: 0,
  endedAt: 1,
  outcome: 'done',
  costUsd: 0.1,
  paneId: '',
  termId: '',
  ...extra
})

const newestFirst = (count: number): CrewRun[] => Array.from({ length: count }, (_, index) => run(`r${index}`))

describe('keepRuns', () => {
  it('keeps the newest runs up to the limit, in their order', () => {
    const kept = keepRuns(newestFirst(MAX_CREW_RUNS + 5))
    expect(kept).toHaveLength(MAX_CREW_RUNS)
    expect(kept[0].id).toBe('r0')
    expect(kept[kept.length - 1].id).toBe(`r${MAX_CREW_RUNS - 1}`)
  })

  it('never drops a run of a goal whose Lead is still working, however old it is', () => {
    const runs = [run('lead', { goalId: 'g1', lead: true, outcome: 'running' }), ...newestFirst(MAX_CREW_RUNS + 10), run('goal-old', { goalId: 'g1' })]
    const kept = keepRuns(runs).map((entry) => entry.id)
    expect(kept).toContain('lead')
    expect(kept).toContain('goal-old')
    expect(kept).toHaveLength(MAX_CREW_RUNS)
    expect(kept).not.toContain(`r${MAX_CREW_RUNS - 2}`)
  })

  it('treats a goal whose Lead has ended as ordinary history', () => {
    const runs = [run('lead', { goalId: 'g1', lead: true, outcome: 'closed' }), ...newestFirst(MAX_CREW_RUNS), run('goal-old', { goalId: 'g1' })]
    expect(keepRuns(runs).map((entry) => entry.id)).not.toContain('goal-old')
  })

  it('keeps every run of several active goals even when they alone exceed the limit', () => {
    const many = Array.from({ length: MAX_CREW_RUNS + 3 }, (_, index) => run(`g${index}`, { goalId: 'g1' }))
    const runs = [run('lead', { goalId: 'g1', lead: true, outcome: 'running' }), ...many]
    expect(keepRuns(runs)).toHaveLength(MAX_CREW_RUNS + 4)
  })

  it('leaves a short history alone', () => {
    const runs = newestFirst(3)
    expect(keepRuns(runs)).toEqual(runs)
  })
})
