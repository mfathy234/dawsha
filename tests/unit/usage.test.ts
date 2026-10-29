import { describe, expect, it } from 'vitest'
import {
  MAX_COST_ENTRIES,
  MAX_LIMIT_READINGS,
  buildUsageReport,
  claudeParser,
  codexParser,
  dayKey,
  emptyHistory,
  formatTokens,
  formatUsd,
  geminiParser,
  hourKey,
  parseUsageText,
  projectKeyFor,
  rangeWindow,
  recordReadings,
  sanitizeHistory,
  serializeHistory,
  type UsageFile,
  type UsageHistory,
  type UsageSource
} from '../../src/shared/usage'

const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
const iso = (day: number, hour: number, minute = 0): string => new Date(at(day, hour, minute)).toISOString()
const NOW = at(8, 18)

const lines = (...records: unknown[]): string => records.map((record) => JSON.stringify(record)).join('\n')

const claudeLine = (id: string, when: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  timestamp: when,
  cwd: 'C:\\work\\acme-web',
  sessionId: 'sess-1',
  message: { id, role: 'assistant', content: [], usage },
  ...extra
})

describe('claudeParser', () => {
  const usage = { input_tokens: 10, output_tokens: 200, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 }

  it('counts input, output and cache writes as tokens and cache reads separately, per local hour', () => {
    const file = parseUsageText(
      'claude',
      lines(
        claudeLine('m1', iso(8, 9, 5), usage),
        claudeLine('m2', iso(8, 9, 40), { input_tokens: 5, output_tokens: 5 }),
        claudeLine('m3', iso(8, 14), { input_tokens: 1, output_tokens: 2 })
      )
    )
    expect(file).toMatchObject({ agent: 'claude', sessionId: 'sess-1', cwd: 'C:\\work\\acme-web' })
    expect(file.hours[hourKey(at(8, 9))]).toEqual({ tokens: 1210 + 10, cacheRead: 5000 })
    expect(file.hours[hourKey(at(8, 14))]).toEqual({ tokens: 3, cacheRead: 0 })
  })

  it('counts a streamed message once, keeping the largest figures', () => {
    const file = parseUsageText(
      'claude',
      lines(
        claudeLine('m1', iso(8, 9), { input_tokens: 10, output_tokens: 1 }),
        claudeLine('m1', iso(8, 9, 1), { input_tokens: 10, output_tokens: 150 }),
        claudeLine('m1', iso(8, 9, 2), { input_tokens: 10, output_tokens: 150 })
      )
    )
    expect(file.hours[hourKey(at(8, 9))]).toEqual({ tokens: 160, cacheRead: 0 })
  })

  it('skips other record types, lines without a time, broken lines and blank lines', () => {
    const text = [
      JSON.stringify({ type: 'user', message: { content: 'hi', usage: { input_tokens: 99 } } }),
      JSON.stringify(claudeLine('m1', 'not a time', usage)),
      '{"type":"assistant","message":{"usage":',
      '',
      JSON.stringify({ type: 'assistant', timestamp: iso(8, 9), message: { id: 'x' } })
    ].join('\n')
    expect(parseUsageText('claude', text).hours).toEqual({})
  })

  it('treats negative or missing numbers as zero', () => {
    const parser = claudeParser()
    parser.push(JSON.stringify(claudeLine('m1', iso(8, 9), { input_tokens: -5, output_tokens: 7 })))
    expect(parser.finish().hours[hourKey(at(8, 9))]).toEqual({ tokens: 7, cacheRead: 0 })
  })
})

describe('codexParser', () => {
  const meta = { type: 'session_meta', timestamp: iso(8, 9), payload: { id: 'rollout-1', cwd: 'C:\\work\\billing-api' } }
  const count = (when: string, input: number, cached: number, output: number) => ({
    type: 'event_msg',
    timestamp: when,
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } }
    }
  })

  it('turns the running totals into per-hour amounts', () => {
    const file = parseUsageText(
      'codex',
      lines(meta, count(iso(8, 9, 10), 1000, 200, 100), count(iso(8, 9, 50), 3000, 1200, 400), count(iso(8, 16), 4000, 1500, 450))
    )
    expect(file).toMatchObject({ agent: 'codex', sessionId: 'rollout-1', cwd: 'C:\\work\\billing-api' })
    expect(file.hours[hourKey(at(8, 9))]).toEqual({ tokens: 2200, cacheRead: 1200 })
    expect(file.hours[hourKey(at(8, 16))]).toEqual({ tokens: 750, cacheRead: 300 })
  })

  it('starts again from zero when the totals drop and ignores readings without usage', () => {
    const file = parseUsageText(
      'codex',
      lines(
        count(iso(8, 9), 1000, 0, 100),
        { type: 'event_msg', timestamp: iso(8, 10), payload: { type: 'token_count', info: null } },
        count(iso(8, 11), 200, 0, 50)
      )
    )
    expect(file.hours[hourKey(at(8, 9))]).toEqual({ tokens: 1100, cacheRead: 0 })
    expect(file.hours[hourKey(at(8, 10))]).toBeUndefined()
    expect(file.hours[hourKey(at(8, 11))]).toEqual({ tokens: 250, cacheRead: 0 })
  })

  it('ignores unrelated events', () => {
    const parser = codexParser()
    parser.push(JSON.stringify({ type: 'event_msg', timestamp: iso(8, 9), payload: { type: 'user_message' } }))
    expect(parser.finish().hours).toEqual({})
  })
})

describe('geminiParser', () => {
  const message = (id: string, when: string, tokens: Record<string, number>) => ({ id, type: 'gemini', timestamp: when, content: 'x', tokens })

  it('adds output, thoughts and tool tokens to the uncached input and keeps cached tokens apart', () => {
    const file = parseUsageText(
      'gemini',
      lines(
        { sessionId: 'chat-1', startTime: iso(8, 9) },
        { id: 'u1', type: 'user', timestamp: iso(8, 9), content: 'hello' },
        message('g1', iso(8, 9, 5), { input: 1000, output: 200, cached: 400, thoughts: 50, tool: 10, total: 1260 })
      )
    )
    expect(file.sessionId).toBe('chat-1')
    expect(file.hours[hourKey(at(8, 9))]).toEqual({ tokens: 600 + 200 + 50 + 10, cacheRead: 400 })
  })

  it('counts a rewritten message once and reads messages inside a single document', () => {
    const rewritten = parseUsageText(
      'gemini',
      lines(message('g1', iso(8, 9), { input: 10, output: 1 }), message('g1', iso(8, 9), { input: 10, output: 90 }))
    )
    expect(rewritten.hours[hourKey(at(8, 9))]).toEqual({ tokens: 100, cacheRead: 0 })
    const document = parseUsageText(
      'gemini',
      JSON.stringify({ sessionId: 'chat-2', messages: [message('a', iso(8, 10), { input: 5, output: 5 }), { type: 'user' }] })
    )
    expect(document.hours[hourKey(at(8, 10))]).toEqual({ tokens: 10, cacheRead: 0 })
  })

  it('ignores replies without token figures', () => {
    const parser = geminiParser()
    parser.push(JSON.stringify({ id: 'g1', type: 'gemini', timestamp: iso(8, 9), content: 'x' }))
    expect(parser.finish().hours).toEqual({})
  })
})

describe('projectKeyFor', () => {
  const projects = [
    { id: 'acme', folder: 'C:\\work\\acme-web' },
    { id: 'acme-docs', folder: 'C:\\work\\acme-web\\docs' }
  ]

  it('picks the deepest project folder that contains the working folder', () => {
    expect(projectKeyFor('c:/work/ACME-web/', projects)).toBe('acme')
    expect(projectKeyFor('C:\\work\\acme-web\\docs\\guide', projects)).toBe('acme-docs')
    expect(projectKeyFor('C:\\work\\acme-web-compare-x7k2p9-a', projects)).toBeNull()
    expect(projectKeyFor('D:\\elsewhere', projects)).toBeNull()
    expect(projectKeyFor(null, projects)).toBeNull()
  })
})

describe('rangeWindow', () => {
  it('lists 24 hours for today and the last N local days otherwise', () => {
    const today = rangeWindow('today', NOW)
    expect(today.hourly).toBe(true)
    expect(today.keys).toHaveLength(24)
    expect(today.keys[0]).toBe(hourKey(at(8, 0)))
    expect(today.start).toBe(at(8, 0))
    const week = rangeWindow('7d', NOW)
    expect(week.keys).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
    expect(week.start).toBe(at(2, 0))
    expect(rangeWindow('30d', NOW).keys).toHaveLength(30)
    expect(rangeWindow('30d', NOW).keys[29]).toBe(dayKey(NOW))
  })
})

const file = (agent: UsageFile['agent'], cwd: string | null, hours: UsageFile['hours'], sessionId = 's'): UsageFile => ({
  agent,
  sessionId,
  cwd,
  hours
})

const PROJECTS = [
  { id: 'acme', name: 'acme-web', folder: 'C:\\work\\acme-web' },
  { id: 'billing', name: 'billing-api', folder: 'C:\\work\\billing-api' }
]

const SOURCES: UsageSource[] = [
  { agent: 'claude', found: true, files: 1 },
  { agent: 'codex', found: true, files: 1 },
  { agent: 'gemini', found: false, files: 0 }
]

describe('buildUsageReport', () => {
  const files = [
    file('claude', 'C:\\work\\acme-web', { [hourKey(at(8, 9))]: { tokens: 1000, cacheRead: 9000 }, [hourKey(at(7, 10))]: { tokens: 500, cacheRead: 0 } }),
    file('codex', 'C:\\work\\acme-web', { [hourKey(at(8, 11))]: { tokens: 300, cacheRead: 50 } }, 'c1'),
    file('codex', 'C:\\work\\billing-api', { [hourKey(at(5, 11))]: { tokens: 700, cacheRead: 0 } }, 'c2'),
    file('claude', 'D:\\unlisted', { [hourKey(at(8, 12))]: { tokens: 40, cacheRead: 0 } }, 'c3'),
    file('claude', 'C:\\work\\acme-web', { [hourKey(at(1, 12))]: { tokens: 9999, cacheRead: 0 } }, 'old')
  ]
  const history: UsageHistory = {
    limits: [
      { at: at(8, 8), windows: { five_hour: 20, seven_day: 10, seven_day_fable: 5 } },
      { at: at(8, 17), windows: { five_hour: 62, seven_day: 18 } },
      { at: at(1, 8), windows: { five_hour: 99 } }
    ],
    costs: {
      s1: { at: at(8, 17), usd: 4.25, cwd: 'C:\\work\\acme-web' },
      s2: { at: at(7, 12), usd: 1.5, cwd: 'D:\\unlisted' },
      old: { at: at(1, 12), usd: 50, cwd: 'C:\\work\\acme-web' }
    }
  }
  const report = (range: 'today' | '7d' | '30d') =>
    buildUsageReport({ range, now: NOW, files, projects: PROJECTS, history, sources: SOURCES })

  it('sums tokens per day and agent and leaves cost empty for agents without cost data', () => {
    const week = report('7d')
    const today = week.buckets.find((bucket) => bucket.key === '2026-10-08')
    expect(today?.perAgent.claude).toEqual({ tokens: 1040, costUsd: 4.25 })
    expect(today?.perAgent.codex).toEqual({ tokens: 300, costUsd: null })
    expect(today?.perAgent.gemini).toEqual({ tokens: 0, costUsd: null })
    expect(week.buckets.find((b) => b.key === '2026-10-07')?.perAgent.claude).toEqual({ tokens: 500, costUsd: 1.5 })
    expect(week.buckets.find((b) => b.key === '2026-10-05')?.perAgent.codex.tokens).toBe(700)
    expect(week.hasCost).toBe(true)
    expect(week.hasTokens).toBe(true)
  })

  it('uses hourly buckets for today and leaves out other days', () => {
    const today = report('today')
    expect(today.hourly).toBe(true)
    expect(today.buckets).toHaveLength(24)
    expect(today.buckets[9].perAgent.claude.tokens).toBe(1000)
    expect(today.buckets[11].perAgent.codex.tokens).toBe(300)
    expect(today.buckets.reduce((sum, b) => sum + b.perAgent.claude.tokens, 0)).toBe(1040)
    expect(today.byAgent.find((a) => a.agent === 'codex')?.tokens).toBe(300)
  })

  it('groups by project with sessions, tokens, cost and the busiest agent', () => {
    const rows = report('7d').byProject
    expect(rows.map((row) => row.project)).toEqual(['acme-web', 'billing-api', 'Other'])
    expect(rows[0]).toMatchObject({ projectId: 'acme', sessions: 2, tokens: 1800, costUsd: 4.25, topAgent: 'claude' })
    expect(rows[1]).toMatchObject({ projectId: 'billing', sessions: 1, tokens: 700, costUsd: null, topAgent: 'codex' })
    expect(rows[2]).toMatchObject({ projectId: null, tokens: 40, costUsd: 1.5, topAgent: 'claude' })
  })

  it('totals each agent including cache reads and counts the files that had any use', () => {
    const rows = report('7d').byAgent
    expect(rows.map((row) => row.agent)).toEqual(['claude', 'codex', 'gemini'])
    expect(rows[0]).toMatchObject({ tokens: 1540, cacheRead: 9000, sessions: 2, costUsd: 5.75 })
    expect(rows[1]).toMatchObject({ tokens: 1000, cacheRead: 50, sessions: 2, costUsd: null })
    expect(rows[2]).toMatchObject({ tokens: 0, sessions: 0, costUsd: null })
  })

  it('widens with the range', () => {
    expect(report('30d').byAgent[0].tokens).toBe(1540 + 9999)
    expect(report('30d').byAgent[0].costUsd).toBe(55.75)
  })

  it('keeps the 5 hour and weekly limit readings of the range, oldest first', () => {
    const limits = report('7d').limits
    expect(limits.map((series) => series.key)).toEqual(['five_hour', 'seven_day'])
    expect(limits[0].points).toEqual([
      { at: at(8, 8), percent: 20 },
      { at: at(8, 17), percent: 62 }
    ])
    expect(limits[1].label).toBe('Weekly limit')
    expect(report('30d').limits[0].points).toHaveLength(3)
  })

  it('reports no data and no cost for an empty history', () => {
    const empty = buildUsageReport({ range: '7d', now: NOW, files: [], projects: PROJECTS, history: emptyHistory(), sources: SOURCES })
    expect(empty.hasTokens).toBe(false)
    expect(empty.hasCost).toBe(false)
    expect(empty.byProject).toEqual([])
    expect(empty.limits).toEqual([])
    expect(empty.sources).toEqual(SOURCES)
  })
})

describe('formatting', () => {
  it('shortens token counts and prints dollars with cents', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1500)).toBe('1.5K')
    expect(formatTokens(412_000)).toBe('412K')
    expect(formatTokens(999_400)).toBe('999K')
    expect(formatTokens(999_600)).toBe('1.00M')
    expect(formatTokens(1_900_000)).toBe('1.90M')
    expect(formatTokens(36_000_000)).toBe('36.0M')
    expect(formatUsd(61.4)).toBe('$61.40')
  })
})

describe('usage history', () => {
  const reading = (receivedAt: number, five: number, cost: number | null = null, id = 's1') => ({
    sessionId: id,
    cwd: 'C:\\work\\acme-web',
    costUsd: cost,
    receivedAt,
    windows: [{ key: 'five_hour', percent: five }]
  })

  it('records a cost per session and a limit reading only when something changed or time passed', () => {
    let history = recordReadings(emptyHistory(), [reading(at(8, 9), 20, 1.25)])
    expect(history.limits).toEqual([{ at: at(8, 9), windows: { five_hour: 20 } }])
    expect(history.costs.s1).toEqual({ at: at(8, 9), usd: 1.25, cwd: 'C:\\work\\acme-web' })
    const same = recordReadings(history, [reading(at(8, 9, 5), 20, 1.25)])
    expect(same).toBe(history)
    history = recordReadings(history, [reading(at(8, 9, 6), 21, 1.5)])
    expect(history.limits).toHaveLength(2)
    expect(history.costs.s1.usd).toBe(1.5)
    history = recordReadings(history, [reading(at(8, 9, 30), 21, 1.5)])
    expect(history.limits).toHaveLength(3)
  })

  it('ignores older readings and sessions without a cost', () => {
    const history = recordReadings(emptyHistory(), [reading(at(8, 9), 20, null)])
    expect(history.costs).toEqual({})
    expect(recordReadings(history, [reading(at(8, 8), 99)])).toBe(history)
  })

  it('keeps only the newest readings and costs', () => {
    const many = Array.from({ length: MAX_LIMIT_READINGS + 5 }, (_, i) => reading(1_000_000 + i * 20 * 60_000, i % 100, null, `s${i}`))
    expect(recordReadings(emptyHistory(), many).limits).toHaveLength(MAX_LIMIT_READINGS)
    const costs = Array.from({ length: MAX_COST_ENTRIES + 5 }, (_, i) => reading(1_000_000 + i, 10, i + 1, `c${i}`))
    const kept = recordReadings(emptyHistory(), costs).costs
    expect(Object.keys(kept)).toHaveLength(MAX_COST_ENTRIES)
    expect(kept.c0).toBeUndefined()
    expect(kept[`c${MAX_COST_ENTRIES + 4}`]).toBeDefined()
  })

  it('round-trips through the file format and drops malformed entries', () => {
    const history = recordReadings(emptyHistory(), [reading(at(8, 9), 20, 1.25)])
    expect(sanitizeHistory(JSON.parse(JSON.stringify(serializeHistory(history))))).toEqual(history)
    const dirty = sanitizeHistory({
      limits: [{ at: 1, w: { five_hour: 250, bad: 'x' } }, { at: 'x', w: {} }, 'junk', { at: 2, w: {} }],
      costs: { a: { at: 1, usd: -3 }, b: { at: 2, usd: 4, cwd: 7 }, c: 'junk' }
    })
    expect(dirty.limits).toEqual([{ at: 1, windows: { five_hour: 100 } }])
    expect(dirty.costs).toEqual({ b: { at: 2, usd: 4, cwd: null } })
    expect(sanitizeHistory('nope')).toEqual(emptyHistory())
  })
})

describe('lastClaudeLimits', () => {
  it('returns the newest saved windows with their reset times and survives a round trip', async () => {
    const { lastClaudeLimits, sanitizeHistory, serializeHistory } = await import('../../src/shared/usage')
    expect(lastClaudeLimits(emptyHistory())).toBeNull()
    const history = recordReadings(emptyHistory(), [
      { sessionId: 's', cwd: null, costUsd: null, receivedAt: 5000, windows: [{ key: 'seven_day', percent: 18, resetsAt: 9_000_000 }, { key: 'five_hour', percent: 62, resetsAt: 8_000_000 }] }
    ])
    const loaded = sanitizeHistory(JSON.parse(JSON.stringify(serializeHistory(history))))
    expect(lastClaudeLimits(loaded)).toEqual({
      at: 5000,
      windows: [
        { key: 'five_hour', label: '5h', family: undefined, percent: 62, resetsAt: 8_000_000 },
        { key: 'seven_day', label: 'week', family: undefined, percent: 18, resetsAt: 9_000_000 }
      ]
    })
  })
})
