import { describe, expect, it } from 'vitest'
import type { OrchAgentRow, OrchRunDetail } from '../../src/shared/orch/api'
import { boardCards, DEFAULT_BOARD_FILTER, groupByColumn, projectTabs, timelineEvents, usageRows } from '../../src/shared/orch/board'
import type { OrchTask } from '../../src/shared/orch/types'
import type { RunUsage } from '../../src/shared/orch/usage'

const task = (over: Partial<OrchTask>): OrchTask => ({
  id: 'r1:T-1', key: 'T-1', runId: 'r1', title: 'CSV writer', spec: '', role: 'implementer', status: 'todo', dependsOn: [], acceptance: [],
  reviewOf: null, reviewRound: 0, assignee: null, summary: null, files: [], branch: null, feedback: null, pausedFrom: null, createdAt: 0, updatedAt: 0, ...over
})

const agent = (over: Partial<OrchAgentRow>): OrchAgentRow => ({ id: 'a1', role: 'implementer', runner: 'codex', model: 'gpt-codex', state: 'working', taskKey: 'T-1', retired: false, ...over })

const run = (over: Partial<OrchRunDetail>): OrchRunDetail => ({
  id: 'r1', kind: 'feature', title: 'Export usage as CSV', stage: 'build', projectId: 'p1', createdAt: 0, taskCount: 0, tasksDone: 0, openDecisions: 0,
  story: '', plan: 'Default', projectPath: '', finishedAt: null, branch: 'orch/x', tasks: [], agents: [],
  usage: { agents: [], byRole: [], total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, complete: true } },
  events: [], ...over
})

const projects = [{ id: 'p1', name: 'dawsha' }, { id: 'p2', name: 'billing-api' }]

const runs = [
  run({
    tasks: [
      task({ key: 'T-1', id: 'r1:T-1', status: 'in_progress', assignee: 'a1', reviewRound: 2 }),
      task({ key: 'T-2', id: 'r1:T-2', title: 'Dialog', status: 'waiting_on_human', spec: 'Needs pricing answer' }),
      task({ key: 'T-3', id: 'r1:T-3', title: 'Done thing', status: 'approved' })
    ],
    agents: [agent({})]
  }),
  run({ id: 'r2', title: 'Invoice PDF footer', projectId: 'p2', stage: 'done', tasks: [task({ id: 'r2:P-1', key: 'P-1', runId: 'r2', title: 'Footer', status: 'todo' })] }),
  run({ id: 'r3', title: 'Orphan', projectId: null, tasks: [task({ id: 'r3:X-1', key: 'X-1', runId: 'r3', status: 'todo' })] })
]

describe('projectTabs', () => {
  it('lists all projects first, then each project that has runs with its task count', () => {
    expect(projectTabs(runs, projects)).toEqual([
      { id: '', label: 'All projects', count: 5 },
      { id: 'p1', label: 'dawsha', count: 3 },
      { id: 'p2', label: 'billing-api', count: 1 }
    ])
  })
})

describe('boardCards', () => {
  it('hides finished runs and done tasks by default (status Open)', () => {
    const cards = boardCards(runs, projects, DEFAULT_BOARD_FILTER)
    expect(cards.map((c) => c.key)).toEqual(['T-1', 'T-2', 'X-1'])
  })

  it('includes finished runs and all statuses when asked', () => {
    const cards = boardCards(runs, projects, { ...DEFAULT_BOARD_FILTER, status: 'all', includeFinished: true })
    expect(cards).toHaveLength(5)
  })

  it('status Done shows only done tasks', () => {
    const cards = boardCards(runs, projects, { ...DEFAULT_BOARD_FILTER, status: 'done' })
    expect(cards.map((c) => c.key)).toEqual(['T-3'])
  })

  it('fills the card from the run, the project and the assignee', () => {
    const [card] = boardCards(runs, projects, DEFAULT_BOARD_FILTER)
    expect(card).toMatchObject({ key: 'T-1', runId: 'r1', projectName: 'dawsha', column: 'progress', reviewRound: 2, agent: { runner: 'codex', model: 'gpt-codex', role: 'implementer' } })
    expect(card.runTag.length).toBeLessThanOrEqual(12)
  })

  it('falls back to the task role when nobody is assigned', () => {
    const cards = boardCards(runs, projects, DEFAULT_BOARD_FILTER)
    expect(cards[1].agent).toBeNull()
    expect(cards[1].role).toBe('implementer')
  })

  it('searches title, spec, summary and feedback', () => {
    expect(boardCards(runs, projects, { ...DEFAULT_BOARD_FILTER, query: 'pricing' }).map((c) => c.key)).toEqual(['T-2'])
    expect(boardCards(runs, projects, { ...DEFAULT_BOARD_FILTER, query: 'DIALOG' }).map((c) => c.key)).toEqual(['T-2'])
  })

  it('filters by project, run, role, model and needs-you', () => {
    const base = { ...DEFAULT_BOARD_FILTER, status: 'all' as const, includeFinished: true }
    expect(boardCards(runs, projects, { ...base, projectId: 'p2' }).map((c) => c.key)).toEqual(['P-1'])
    expect(boardCards(runs, projects, { ...base, runId: 'r3' }).map((c) => c.key)).toEqual(['X-1'])
    expect(boardCards(runs, projects, { ...base, model: 'gpt-codex' }).map((c) => c.key)).toEqual(['T-1'])
    expect(boardCards(runs, projects, { ...base, role: 'implementer' }).length).toBe(5)
    expect(boardCards(runs, projects, { ...base, needsOnly: true }).map((c) => c.key)).toEqual(['T-2'])
  })
})

describe('groupByColumn', () => {
  it('returns every column, in order, even when empty', () => {
    const groups = groupByColumn(boardCards(runs, projects, DEFAULT_BOARD_FILTER))
    expect(groups.map((g) => g.id)).toEqual(['todo', 'progress', 'review', 'needs', 'done'])
    expect(groups.map((g) => g.cards.length)).toEqual([1, 1, 0, 1, 0])
  })
})

describe('usageRows', () => {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const usage: RunUsage = {
    agents: [
      { agentId: 'a1', role: 'lead', runner: 'claude', model: 'opus', inputTokens: 62000, outputTokens: 14000, cacheReadTokens: 400000, cacheWriteTokens: 10000, totalTokens: 486000, costUsd: 0.61, costSource: 'reported' },
      { agentId: 'a2', role: 'implementer', runner: 'codex', model: 'gpt', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1500, costUsd: 0.29, costSource: 'estimated' },
      { agentId: 'a3', role: 'ux-reviewer', runner: 'codex-local', model: 'qwen', inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10, costUsd: 0, costSource: 'free' },
      { agentId: 'a4', role: 'tester', runner: 'gemini', model: 'flash', inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10, costUsd: null, costSource: 'unpriced' },
      { agentId: 'a5', role: 'ui', runner: 'claude', model: 'sonnet', ...zero, totalTokens: 0, costUsd: 0, costSource: 'none' }
    ],
    byRole: [],
    total: { inputTokens: 63010, outputTokens: 14510, cacheReadTokens: 400000, cacheWriteTokens: 10000, totalTokens: 487520, costUsd: 0.9, complete: false }
  }

  it('formats tokens, merges cache read and write, and marks the cost source', () => {
    const { rows, total } = usageRows(usage)
    expect(rows[0]).toMatchObject({ agentId: 'a1', input: '62K', output: '14K', cache: '410K', cost: '$0.61', marker: 'R' })
    expect(rows.map((r) => r.marker)).toEqual(['R', 'E', 'L', '–', '–'])
    expect(rows[3].cost).toBe('no price')
    expect(rows[4].cost).toBe('–')
    expect(total).toMatchObject({ input: '63K', cost: '$0.90', incomplete: true })
  })
})

describe('timelineEvents', () => {
  const events = [
    { runId: 'r1', at: 1, kind: 'a', text: 'first', taskId: 'r1:T-1' },
    { runId: 'r1', at: 2, kind: 'a', text: 'second', taskId: 'r1:T-2' },
    { runId: 'r1', at: 3, kind: 'a', text: 'third', taskId: null }
  ]
  it('lists newest first and filters by task key', () => {
    expect(timelineEvents(events, 'r1', null).map((e) => e.text)).toEqual(['third', 'second', 'first'])
    expect(timelineEvents(events, 'r1', 'T-2').map((e) => e.text)).toEqual(['second'])
  })
})
