import { describe, expect, it } from 'vitest'
import { buildUsageCsv, csvCell, exportFileName, exportWindow, type ExportSession } from '../../src/shared/usageCsv'
import { detailParserFor } from '../../src/shared/usageDetail'

const NOW = new Date(2026, 10, 11, 12).getTime() // Wednesday 2026-11-11
const projects = [{ id: 'web', name: 'web-app', folder: 'C:/work/web-app' }]

const session = (over: Partial<ExportSession> = {}): ExportSession => ({
  key: 's1',
  agent: 'claude',
  sessionId: 's1',
  cwd: 'C:/work/web-app',
  rows: [{ day: '2026-11-10', model: 'opus', input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }],
  ...over
})

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('plain')).toBe('plain')
  })

  it('prefixes formula starters with a quote', () => {
    for (const start of ['=1+1', '+1', '-1', '@SUM(A1)']) expect(csvCell(start)).toBe(`'${start}`)
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`)
  })

  it('leaves numbers and empty values alone', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(null)).toBe('')
    expect(csvCell(Number.NaN)).toBe('')
  })
})

describe('exportWindow', () => {
  it('covers each range in local days', () => {
    expect(exportWindow('today', NOW)).toEqual({ from: '2026-11-11', to: '2026-11-11' })
    expect(exportWindow('week', NOW)).toEqual({ from: '2026-11-09', to: '2026-11-11' })
    expect(exportWindow('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-11' })
    expect(exportWindow('lastMonth', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(exportWindow('all', NOW)).toEqual({ from: null, to: null })
  })

  it('starts a Sunday week on the Monday before', () => {
    expect(exportWindow('week', new Date(2026, 10, 15, 9).getTime()).from).toBe('2026-11-09')
  })
})

describe('buildUsageCsv', () => {
  const base = { now: NOW, range: 'month' as const, projects, costs: [] }

  it('writes the header and one row per day, project and agent', () => {
    const csv = buildUsageCsv({
      ...base,
      grouping: 'dayProjectAgent',
      sessions: [
        session(),
        session({ key: 's2', sessionId: 's2', rows: [{ day: '2026-11-10', model: 'sonnet', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }] })
      ]
    })
    expect(csv).toBe('date,project,agent,model,input,output,cache read,cache write,cost\r\n2026-11-10,web-app,Claude,opus; sonnet,11,22,33,44,\r\n')
  })

  it('leaves out days outside the range', () => {
    const rows = [{ day: '2026-10-30', model: 'opus', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }]
    const csv = buildUsageCsv({ ...base, grouping: 'day', sessions: [session({ rows })] })
    expect(csv.trim().split('\r\n')).toHaveLength(1)
    expect(buildUsageCsv({ ...base, range: 'lastMonth', grouping: 'day', sessions: [session({ rows })] })).toContain('2026-10-30,,,opus,1,1,0,0,')
  })

  it('groups by day alone, by project alone and by session', () => {
    const sessions = [session(), session({ key: 's2', sessionId: 's2', agent: 'codex', cwd: null, rows: [{ day: '2026-11-09', model: '', input: 5, output: 5, cacheRead: 0, cacheWrite: 0 }] })]
    expect(buildUsageCsv({ ...base, grouping: 'day', sessions }).split('\r\n').slice(1, 3)).toEqual(['2026-11-09,,,,5,5,0,0,', '2026-11-10,,,opus,10,20,30,40,'])
    expect(buildUsageCsv({ ...base, grouping: 'project', sessions }).split('\r\n').slice(1, 3)).toEqual([',Other,,,5,5,0,0,', ',web-app,,opus,10,20,30,40,'])
    expect(buildUsageCsv({ ...base, grouping: 'session', sessions }).split('\r\n').slice(1, 3)).toEqual(['2026-11-09,Other,Codex,,5,5,0,0,', '2026-11-10,web-app,Claude,opus,10,20,30,40,'])
  })

  it('adds reported cost to its day, project and agent', () => {
    const costs = [{ day: '2026-11-10', sessionKey: 's1', cwd: 'C:/work/web-app', usd: 1.23456 }]
    const csv = buildUsageCsv({ ...base, grouping: 'dayProjectAgent', sessions: [session()], costs })
    expect(csv).toContain('2026-11-10,web-app,Claude,opus,10,20,30,40,1.2346')
  })

  it('keeps cost that has no token rows', () => {
    const costs = [{ day: '2026-11-10', sessionKey: 'gone', cwd: null, usd: 2 }]
    const csv = buildUsageCsv({ ...base, grouping: 'day', sessions: [], costs })
    expect(csv).toContain('2026-11-10,,,,0,0,0,0,2')
  })

  it('guards project names that start like a formula', () => {
    const csv = buildUsageCsv({ ...base, grouping: 'project', projects: [{ id: 'web', name: '=cmd', folder: 'C:/work/web-app' }], sessions: [session()] })
    expect(csv).toContain(",'=cmd,")
  })
})

describe('exportFileName', () => {
  it('names the range and the day', () => {
    expect(exportFileName('lastMonth', NOW)).toBe('dawsha-usage-last-month-2026-11-11.csv')
  })
})

describe('detail parsers', () => {
  const lines = (...records: unknown[]): string[] => records.map((record) => JSON.stringify(record))
  const run = (agent: 'claude' | 'codex' | 'gemini', input: string[]) => {
    const parser = detailParserFor(agent)
    for (const line of input) parser.push(line)
    return parser.finish()
  }
  const when = new Date(2026, 10, 10, 9).toISOString()

  it('splits Claude usage and counts a repeated message once', () => {
    const usage = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }
    const record = { type: 'assistant', timestamp: when, cwd: 'C:/x', sessionId: 'c1', message: { id: 'm1', model: 'claude-opus', usage } }
    const done = run('claude', lines(record, record))
    expect(done.sessionId).toBe('c1')
    expect(done.rows).toEqual([{ day: '2026-11-10', model: 'claude-opus', input: 10, output: 20, cacheRead: 40, cacheWrite: 30 }])
  })

  it('turns Codex running totals into amounts, with the model from the turn', () => {
    const total = (input: number, cached: number, output: number) => ({ type: 'event_msg', timestamp: when, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } })
    const done = run('codex', lines({ type: 'session_meta', timestamp: when, payload: { id: 'x1', cwd: 'C:/x' } }, { type: 'turn_context', payload: { model: 'gpt-5' } }, total(100, 40, 10), total(150, 60, 25)))
    expect(done.rows).toEqual([{ day: '2026-11-10', model: 'gpt-5', input: 90, output: 25, cacheRead: 60, cacheWrite: 0 }])
  })

  it('reads Gemini tokens', () => {
    const done = run('gemini', lines({ id: 'g1', type: 'gemini', timestamp: when, model: 'gemini-pro', tokens: { input: 800, output: 100, cached: 300, thoughts: 5, tool: 5 } }))
    expect(done.rows).toEqual([{ day: '2026-11-10', model: 'gemini-pro', input: 500, output: 110, cacheRead: 300, cacheWrite: 0 }])
  })
})
