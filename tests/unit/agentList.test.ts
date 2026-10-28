import { describe, expect, it } from 'vitest'
import type { BackgroundAgent } from '../../src/shared/backgroundAgents'
import { applyFilters, DEFAULT_BG_FILTERS, groupBySession } from '../../src/shared/backgroundAgents'
import { agentsMarkdown, fileTarget, retryPrompt, stateCountParts, stateSegments, summaryLine, todayTotals } from '../../src/shared/agentList'
import { layoutTimeline, niceStep } from '../../src/shared/agentTimeline'

const NOW = Date.parse('2026-10-28T12:00:00')
const min = (n: number): number => NOW - n * 60_000
const agent = (over: Partial<BackgroundAgent>): BackgroundAgent => ({
  key: `claude:${over.id ?? 'a'}`, id: 'a', kind: 'claude', parentId: 'p1', parentTitle: 'Add dark mode', projectId: 'web', projectLabel: 'acme-web', description: 'Unit tests', type: 'general-purpose',
  automatic: false, model: 'sonnet', depth: 1, parentAgentId: null, startedAt: min(30), endedAt: min(10), lastActivityAt: min(10), status: 'done', statusNote: null,
  tokens: 1000, tokensApprox: false, costUsd: null, lastStep: '', result: '', cwd: null, prompt: '', tools: [], files: [], tokensIn: 0, tokensOut: 0, ...over
})

describe('state filter', () => {
  const list = [agent({ id: 'a', status: 'running', endedAt: null }), agent({ id: 'b', status: 'failed' }), agent({ id: 'c' }), agent({ id: 'd' })]

  it('labels All, Running, Failed and Done with counts', () => {
    expect(stateSegments({ running: 1, failed: 1, done: 2 })).toEqual([
      { state: 'all', label: 'All 4', count: 4 }, { state: 'running', label: 'Running 1', count: 1 },
      { state: 'failed', label: 'Failed 1', count: 1 }, { state: 'done', label: 'Done 2', count: 2 }
    ])
  })

  it('filters by one state', () => {
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, statuses: ['done'] }).map((a) => a.id)).toEqual(['c', 'd'])
  })

  it('search also matches file names the agent touched', () => {
    const touched = [agent({ id: 'x', files: [{ path: 'src/context/theme.tsx', change: 'M', added: 1, removed: 0 }] }), agent({ id: 'y' })]
    expect(applyFilters(touched, { ...DEFAULT_BG_FILTERS, query: 'THEME.tsx' }).map((a) => a.id)).toEqual(['x'])
  })

  it('matches Windows paths with a forward-slash query', () => {
    const touched = [agent({ id: 'x', files: [{ path: 'C:\\repo\\src\\theme.tsx', change: 'M', added: 1, removed: 0 }] })]
    expect(applyFilters(touched, { ...DEFAULT_BG_FILTERS, query: 'src/theme' })).toHaveLength(1)
  })

  it('lists running and failed counts before done and skips zeros', () => {
    expect(stateCountParts({ running: 0, failed: 1, done: 3 })).toEqual([{ state: 'failed', text: '1 failed' }, { state: 'done', text: '3 done' }])
    expect(stateCountParts({ running: 2, failed: 1, done: 4 }).map((p) => p.state)).toEqual(['running', 'failed', 'done'])
  })
})

describe('summaryLine', () => {
  it('shows the latest tool call while running', () => {
    expect(summaryLine(agent({ status: 'running', endedAt: null, tools: [{ at: 1, name: 'Bash', brief: 'npm test' }], lastStep: 'Read x' }))).toBe('Bash npm test')
    expect(summaryLine(agent({ status: 'running', endedAt: null, lastStep: 'Read x' }))).toBe('Read x')
  })

  it('shows the first line of the result when done', () => {
    expect(summaryLine(agent({ result: 'Rebased the branch. All tests pass.\nSecond' }))).toBe('Rebased the branch. All tests pass.')
    expect(summaryLine(agent({ result: '' }))).toBe('')
  })

  it('shows the failure note or first error line when failed', () => {
    expect(summaryLine(agent({ status: 'failed', statusNote: 'Interrupted' }))).toBe('Interrupted')
    expect(summaryLine(agent({ status: 'failed', statusNote: null, result: 'Exit 1: 2 failed\nmore' }))).toBe('Exit 1: 2 failed')
    expect(summaryLine(agent({ status: 'failed', statusNote: null, lastStep: 'Bash npm test' }))).toBe('Bash npm test')
  })
})

describe('todayTotals', () => {
  it('sums only agents active since local midnight', () => {
    const agents = [agent({ id: 'a', tokens: 100, costUsd: 0.1, lastActivityAt: min(5) }), agent({ id: 'b', tokens: 900, costUsd: 0.9, lastActivityAt: NOW - 30 * 3_600_000 })]
    expect(todayTotals(agents, NOW)).toEqual({ tokens: 100, costUsd: 0.1, approx: false })
  })
})

describe('fileTarget', () => {
  const projects = [{ id: 'web', folder: 'C:\\code\\web' }]
  it('is relative to the agent checkout when the file is inside it', () => {
    expect(fileTarget(agent({ cwd: 'C:\\code\\web-wt' }), 'C:\\code\\web-wt\\src\\a.ts', projects)).toEqual({ projectId: 'web', folder: 'C:\\code\\web-wt', path: 'src/a.ts' })
  })
  it('falls back to the project folder, then to a relative path as given', () => {
    expect(fileTarget(agent({ cwd: null }), 'C:/code/web/src/a.ts', projects)).toEqual({ projectId: 'web', folder: 'C:\\code\\web', path: 'src/a.ts' })
    expect(fileTarget(agent({ cwd: 'C:\\code\\web' }), 'src/a.ts', projects)).toEqual({ projectId: 'web', folder: 'C:\\code\\web', path: 'src/a.ts' })
  })
  it('is null outside any known folder or without a project', () => {
    expect(fileTarget(agent({ cwd: 'C:\\code\\web' }), 'D:\\other\\a.ts', projects)).toBeNull()
    expect(fileTarget(agent({ projectId: null }), 'src/a.ts', projects)).toBeNull()
  })
})

describe('timeline layout', () => {
  const groups = groupBySession([
    agent({ id: 'a', status: 'running', endedAt: null, startedAt: min(60) }),
    agent({ id: 'b', startedAt: min(50), endedAt: min(30), lastActivityAt: min(30) }),
    agent({ id: 'c', parentId: 'p2', parentTitle: 'Other', startedAt: min(20), endedAt: min(20), lastActivityAt: min(20), status: 'failed' })
  ], NOW)

  it('shares one axis from the earliest start to now', () => {
    const t = layoutTimeline(groups, NOW)
    expect(t.start).toBe(min(60))
    expect(t.end).toBe(NOW)
    expect(t.lanes.map((lane) => [lane.kind, lane.key])).toEqual([['session', 'claude:p1'], ['agent', 'claude:a'], ['agent', 'claude:b'], ['session', 'claude:p2'], ['agent', 'claude:c']])
  })

  it('places bars as percentages and keeps tiny ones visible', () => {
    const t = layoutTimeline(groups, NOW)
    const bar = (key: string) => t.lanes.find((lane) => lane.key === key)!
    expect(bar('claude:a').left).toBe(0)
    expect(bar('claude:a').width).toBeCloseTo(100, 5)
    expect(bar('claude:b').left).toBeCloseTo((10 / 60) * 100, 5)
    expect(bar('claude:b').width).toBeCloseTo((20 / 60) * 100, 5)
    expect(bar('claude:c').width).toBeGreaterThanOrEqual(0.8)
    expect(bar('claude:c').left + bar('claude:c').width).toBeLessThanOrEqual(100)
  })

  it('covers a session lane from its first start to its last end', () => {
    const lane = layoutTimeline(groups, NOW).lanes[0]
    expect(lane.left).toBe(0)
    expect(lane.width).toBeCloseTo(100, 5)
  })

  it('picks ticks inside the range with a readable step', () => {
    const t = layoutTimeline(groups, NOW)
    expect(t.ticks.length).toBeGreaterThanOrEqual(2)
    expect(t.ticks.length).toBeLessThanOrEqual(7)
    for (const tick of t.ticks) {
      expect(tick.left).toBeGreaterThanOrEqual(0)
      expect(tick.left).toBeLessThanOrEqual(100)
    }
    expect(niceStep(60 * 60_000)).toBe(10 * 60_000)
    expect(niceStep(10 * 60_000)).toBe(2 * 60_000)
  })

  it('handles no agents and a single instant', () => {
    expect(layoutTimeline([], NOW).lanes).toEqual([])
    const one = layoutTimeline(groupBySession([agent({ id: 'z', startedAt: min(1), endedAt: min(1), lastActivityAt: min(1) })], NOW), NOW)
    expect(one.end).toBeGreaterThan(one.start)
  })
})

describe('retryPrompt', () => {
  it('names the agent and quotes the failure', () => {
    const text = retryPrompt(agent({ description: 'Run export tests', status: 'failed', statusNote: 'Interrupted' }))
    expect(text).toContain('"Run export tests"')
    expect(text).toContain('Interrupted')
  })
})

describe('agentsMarkdown', () => {
  it('writes a heading per session with one line per agent', () => {
    const groups = groupBySession([
      agent({ id: 'a', status: 'running', endedAt: null, tools: [{ at: 1, name: 'Bash', brief: 'npm test' }] }),
      agent({ id: 'b', description: 'Map columns', result: 'Done: 12 columns.', files: [{ path: 'src/a.ts', change: 'M', added: 2, removed: 1 }] })
    ], NOW)
    const text = agentsMarkdown(groups, NOW)
    expect(text).toContain('# Agents')
    expect(text).toContain('## Add dark mode')
    expect(text).toContain('acme-web · 2 agents')
    expect(text).toMatch(/- \*\*Unit tests\*\* · running · \d+m\n {2}- Bash npm test/)
    expect(text).toContain('- **Map columns** · done · 20m')
    expect(text).toContain('  - Done: 12 columns.')
    expect(text).toContain('  - Files: M src/a.ts (+2 −1)')
  })

  it('says when nothing is shown', () => {
    expect(agentsMarkdown([], NOW)).toContain('No agents')
  })
})
