import { describe, expect, it } from 'vitest'
import type { OrchDecisionView, OrchRunDetail } from '../../src/shared/orch/api'
import {
  activitySummary,
  composeAnswer,
  decisionKindLabel,
  filterDecisions,
  liveTimeline,
  oldestDecisionByRun,
  pickSelection,
  runCounts,
  runFilterChips,
  runTag,
  sortDecisions
} from '../../src/shared/orch/review'

const decision = (id: string, runId: string, createdAt: number): OrchDecisionView => ({
  id,
  kind: 'question',
  runId,
  runTitle: `Run ${runId}`,
  question: 'q',
  options: [],
  context: '',
  createdAt,
  taskKey: null,
  agentRole: null,
  agentModel: null
})

const run = (id: string, stage: OrchRunDetail['stage'], agents: Partial<OrchRunDetail['agents'][number]>[] = [], events: OrchRunDetail['events'] = []): OrchRunDetail =>
  ({
    id,
    title: `Run ${id}`,
    stage,
    agents: agents.map((a, i) => ({ id: `a${i}`, role: 'implementer', runner: 'claude', model: 'm', state: 'working', taskKey: null, retired: false, ...a })),
    events
  }) as unknown as OrchRunDetail

describe('decisions', () => {
  const list = [decision('c', 'r2', 30), decision('a', 'r1', 10), decision('b', 'r1', 20)]

  it('sorts oldest first without mutating', () => {
    expect(sortDecisions(list).map((d) => d.id)).toEqual(['a', 'b', 'c'])
    expect(list[0].id).toBe('c')
  })

  it('picks the oldest per run', () => {
    const map = oldestDecisionByRun(list)
    expect(map.get('r1')?.id).toBe('a')
    expect(map.get('r2')?.id).toBe('c')
  })

  it('builds filter chips with counts and filters', () => {
    expect(runFilterChips(list)).toEqual([
      { runId: 'r1', title: 'Run r1', count: 2 },
      { runId: 'r2', title: 'Run r2', count: 1 }
    ])
    expect(filterDecisions(list, 'r1').map((d) => d.id)).toEqual(['a', 'b'])
    expect(filterDecisions(list, null)).toHaveLength(3)
  })

  it('labels kinds', () => {
    expect(decisionKindLabel('spec-approval')).toBe('Spec approval')
    expect(decisionKindLabel('stall')).toBe('Stalled')
  })
})

describe('pickSelection', () => {
  it('keeps a listed selection', () => expect(pickSelection(['a', 'b'], 'b', ['a', 'b'])).toBe('b'))
  it('selects the next when the selection vanished', () => expect(pickSelection(['a', 'c'], 'b', ['a', 'b', 'c'])).toBe('c'))
  it('falls back to the last when the last vanished', () => expect(pickSelection(['a'], 'b', ['a', 'b'])).toBe('a'))
  it('selects the first without a selection', () => expect(pickSelection(['a', 'b'], null)).toBe('a'))
  it('returns null when empty', () => expect(pickSelection([], 'a', ['a'])).toBeNull())
})

describe('composeAnswer', () => {
  it('uses the option alone', () => expect(composeAnswer('Yes', '')).toBe('Yes'))
  it('joins option and note', () => expect(composeAnswer('Yes', ' go ahead ')).toBe('Yes. go ahead'))
  it('uses the note for Other or no option', () => {
    expect(composeAnswer('Other', 'custom')).toBe('custom')
    expect(composeAnswer(null, 'custom')).toBe('custom')
  })
  it('is empty when nothing is given', () => expect(composeAnswer('Other', '  ')).toBe(''))
})

describe('liveTimeline', () => {
  it('merges runs newest first and limits', () => {
    const runs = [
      run('r1', 'build', [], [{ runId: 'r1', at: 1, kind: 'k', text: 'one', taskId: null }, { runId: 'r1', at: 5, kind: 'k', text: 'five', taskId: null }]),
      run('r2', 'build', [], [{ runId: 'r2', at: 3, kind: 'k', text: 'three', taskId: null }])
    ]
    expect(liveTimeline(runs).map((e) => e.text)).toEqual(['five', 'three', 'one'])
    expect(liveTimeline(runs, 2)).toHaveLength(2)
    expect(liveTimeline(runs)[0].runTitle).toBe('Run r1')
  })
})

describe('runs', () => {
  it('counts active runs, decisions and working agents', () => {
    const runs = [run('r1', 'build', [{ state: 'working' }, { state: 'waiting' }, { state: 'working', retired: true }]), run('r2', 'done', [{ state: 'working' }])]
    expect(runCounts(runs, [decision('a', 'r1', 1)])).toEqual({ running: 1, waiting: 1, agents: 1 })
  })

  it('summarises activity by priority', () => {
    const label = (r: string): string => r
    expect(activitySummary(run('r', 'build', [{ state: 'working', taskKey: 'T-1' }]), label)).toEqual({ text: 'implementer T-1 is working', tone: 'working' })
    expect(activitySummary(run('r', 'build', [{ state: 'working' }, { state: 'stalled' }]), label).tone).toBe('stalled')
    expect(activitySummary(run('r', 'build', []), label).tone).toBe('idle')
  })

  it('shortens titles to a tag', () => {
    expect(runTag('Add dark mode toggle to settings')).toBe('Add dark')
    expect(runTag('Internationalisation overhaul')).toBe('International…')
    expect(runTag('  ')).toBe('run')
  })
})
