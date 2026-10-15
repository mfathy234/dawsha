import { describe, expect, it } from 'vitest'
import {
  computeInsights,
  filterEvents,
  formatSpan,
  highlightParts,
  mergeTimeline,
  relativePath,
  renderTimelineMarkdown,
  searchEvents,
  stateSegments,
  stepMatch,
  timelineFileName,
  timelineSpan,
  type TimelineEvent
} from '../../src/shared/timeline'

const MIN = 60_000
const BASE = Date.UTC(2026, 9, 8, 9, 0, 0)
let n = 0
const ev = (minute: number, kind: TimelineEvent['kind'], extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `e${n++}`,
  at: BASE + minute * MIN,
  kind,
  text: extra.text ?? kind,
  ...extra
})

const sample = (): TimelineEvent[] =>
  mergeTimeline(
    [
      ev(0, 'prompt', { text: 'Add retry to the webhook sender' }),
      ev(1, 'read', { paths: ['src/a.ts'], text: 'Read a.ts' }),
      ev(2, 'read', { paths: ['src/b.ts'], text: 'Read b.ts' }),
      ev(5, 'edit', { path: 'src/sender.ts', text: 'src/sender.ts', added: 3, removed: 1 }),
      ev(6, 'edit', { path: 'src/sender.ts', text: 'src/sender.ts', added: 1, removed: 0 }),
      ev(7, 'edit', { path: 'src/other.ts', text: 'src/other.ts', added: 2, removed: 0 }),
      ev(8, 'test', { command: 'npm test', text: '23 passed · 1 failed', passed: 23, failed: 1, ok: false }),
      ev(9, 'command', { command: 'git status', text: 'git status' }),
      ev(12, 'test', { command: 'npm test', text: '24 passed', passed: 24, ok: true })
    ],
    [
      ev(0, 'state', { state: 'working', text: 'working' }),
      ev(4, 'state', { state: 'needs', text: 'needs' }),
      ev(5, 'approval', { allowed: true, source: 'desktop', text: 'npm test' }),
      ev(5.5, 'state', { state: 'working', text: 'working' }),
      ev(10, 'state', { state: 'needs', text: 'needs' }),
      ev(14, 'state', { state: 'done', text: 'done' })
    ]
  )

describe('mergeTimeline', () => {
  it('orders by time and folds neighbouring reads into one', () => {
    const merged = sample()
    expect(merged.map((e) => e.at)).toEqual([...merged.map((e) => e.at)].sort((a, b) => a - b))
    const reads = merged.filter((e) => e.kind === 'read')
    expect(reads).toHaveLength(1)
    expect(reads[0].paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(reads[0].text).toBe('Read 2 files')
  })
})

describe('filterEvents', () => {
  it('keeps only the chosen kinds', () => {
    const merged = sample()
    expect(filterEvents(merged, 'prompts').map((e) => e.kind)).toEqual(['prompt'])
    expect(filterEvents(merged, 'edits')).toHaveLength(3)
    expect(filterEvents(merged, 'tests')).toHaveLength(2)
    expect(filterEvents(merged, 'commands').map((e) => e.kind)).toEqual(['test', 'command', 'test'])
    expect(filterEvents(merged, 'approvals')).toHaveLength(1)
    expect(filterEvents(merged, 'all')).toHaveLength(merged.length)
  })
})

describe('search', () => {
  it('matches prompt text, paths and commands case-insensitively', () => {
    const merged = sample()
    expect(searchEvents(merged, 'WEBHOOK').map((i) => merged[i].kind)).toEqual(['prompt'])
    expect(searchEvents(merged, 'sender.ts').map((i) => merged[i].kind)).toEqual(['edit', 'edit'])
    expect(searchEvents(merged, 'git status').map((i) => merged[i].kind)).toEqual(['command'])
    expect(searchEvents(merged, 'npm test').map((i) => merged[i].kind)).toEqual(['approval', 'test', 'test'])
    expect(searchEvents(merged, '   ')).toEqual([])
    expect(searchEvents(merged, 'zzz')).toEqual([])
  })

  it('splits text around every match for highlighting', () => {
    expect(highlightParts('Retry the retry', 'retry')).toEqual([
      { text: 'Retry', match: true },
      { text: ' the ', match: false },
      { text: 'retry', match: true }
    ])
    expect(highlightParts('plain', '')).toEqual([{ text: 'plain', match: false }])
  })

  it('steps through matches and wraps around', () => {
    expect(stepMatch(3, 0, 1)).toBe(1)
    expect(stepMatch(3, 2, 1)).toBe(0)
    expect(stepMatch(3, 0, -1)).toBe(2)
    expect(stepMatch(3, -1, -1)).toBe(2)
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })
})

describe('stateSegments', () => {
  it('runs each state until the next change, the last one until now', () => {
    const merged = sample()
    const now = BASE + 20 * MIN
    const segments = stateSegments(merged, now)
    expect(segments.map((s) => s.state)).toEqual(['working', 'needs', 'working', 'needs', 'done'])
    expect(segments[4].end).toBe(now)
  })
})

describe('computeInsights', () => {
  const now = BASE + 20 * MIN
  const insights = computeInsights(sample(), now)

  it('splits time by state and totals the waits', () => {
    expect(insights.time).toEqual({ working: 4 * MIN + 4.5 * MIN, needs: 1.5 * MIN + 4 * MIN, done: 6 * MIN })
    expect(insights.waits).toEqual({ total: 5.5 * MIN, longest: 4 * MIN, count: 2 })
  })

  it('ranks files by edit count and counts commands and permissions', () => {
    expect(insights.files[0]).toEqual({ path: 'src/sender.ts', edits: 2, added: 4, removed: 1 })
    expect(insights.files.map((f) => f.path)).toEqual(['src/sender.ts', 'src/other.ts'])
    expect(insights.commands).toBe(3)
    expect(insights.permissions).toEqual({ prompts: 2, allowed: 1, denied: 0 })
  })

  it('keeps the order of test runs with their outcome', () => {
    expect(insights.tests.map((t) => t.ok)).toEqual([false, true])
  })

  it('has nothing to report for an empty timeline', () => {
    expect(computeInsights([], now)).toEqual({ time: null, waits: null, files: [], commands: 0, tests: [], permissions: null })
  })

  it('caps the files list at five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(i, 'edit', { path: `f${i}.ts`, text: `f${i}.ts` }))
    expect(computeInsights(many, now).files).toHaveLength(5)
  })
})

describe('helpers', () => {
  it('makes paths relative to the folder', () => {
    expect(relativePath('C:\\Work\\app\\src\\a.ts', 'c:/work/app')).toBe('src/a.ts')
    expect(relativePath('/home/me/app/src/a.ts', '/home/me/app/')).toBe('src/a.ts')
    expect(relativePath('/elsewhere/a.ts', '/home/me/app')).toBe('/elsewhere/a.ts')
  })

  it('formats spans', () => {
    expect(formatSpan(0)).toBe('0m')
    expect(formatSpan(30_000)).toBe('30s')
    expect(formatSpan(41 * MIN)).toBe('41m')
    expect(formatSpan(135 * MIN)).toBe('2h 15m')
  })

  it('ends a finished session at its last event and a live one at now', () => {
    const merged = sample()
    const last = Math.max(...merged.map((e) => e.at))
    expect(timelineSpan(merged, BASE + 99 * MIN, false)?.endedAt).toBe(last)
    expect(timelineSpan(merged, BASE + 99 * MIN, true)?.endedAt).toBe(BASE + 99 * MIN)
    expect(timelineSpan([], BASE, true)).toBeNull()
  })

  it('names the export file after the project and date', () => {
    expect(timelineFileName('My App', new Date(2026, 9, 8))).toBe('My-App-timeline-2026-10-08.md')
  })
})

describe('renderTimelineMarkdown', () => {
  it('lists insights and events', () => {
    const events = sample()
    const now = BASE + 20 * MIN
    const text = renderTimelineMarkdown({
      title: 'Add retry',
      events,
      insights: computeInsights(events, now),
      span: timelineSpan(events, now, false),
      prompts: 1,
      costUsd: 3.1
    })
    expect(text).toContain('# Timeline: Add retry')
    expect(text).toContain('1 prompt')
    expect(text).toContain('## Insights')
    expect(text).toContain('Files touched most: `src/sender.ts` (2)')
    expect(text).toContain('Cost: $3.10')
    expect(text).toContain('**You:** Add retry to the webhook sender')
    expect(text).toContain('Edited `src/sender.ts` (+3 -1)')
    expect(text).toContain('Tests `npm test`: 23 passed · 1 failed')
    expect(text).toContain('Allowed: npm test')
  })

  it('says so when there are no events', () => {
    const text = renderTimelineMarkdown({
      title: '',
      events: [],
      insights: computeInsights([], BASE),
      span: null,
      prompts: 0
    })
    expect(text).toContain('_No events yet._')
    expect(text).not.toContain('## Insights')
  })
})
