import { describe, expect, it } from 'vitest'
import { aggregateWork, type WorkItem } from '../../src/shared/workDashboard'
import { buildTodayRecap, formatRecapText, parseNumstat } from '../../src/shared/workRecap'

const now = new Date(2026, 10, 14, 15).getTime()
const dayStart = new Date(2026, 10, 14).getTime()
const minutes = (n: number): number => n * 60_000
const item = (id: string, start: number, length: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  id, title: 'Fixed the restore bug', projectId: 'p', project: 'Platforms', type: 'bug', agent: 'claude', branch: 'fix/1', ticket: null,
  startedAt: dayStart + minutes(start), endedAt: dayStart + minutes(start + length), ...extra
})
const report = (items: WorkItem[]) => aggregateWork(items, 'today', now)
const noCost = (): null => null

describe('parseNumstat', () => {
  it('counts each file once and sums the lines, treating binary files as zero lines', () => {
    const text = '3\t1\tsrc/a.ts\n2\t0\tsrc/b.ts\n\n4\t4\tsrc/a.ts\n-\t-\tlogo.png\n'
    expect(parseNumstat(text)).toEqual({ files: 3, added: 9, removed: 5 })
  })

  it('reads nothing from empty or unrelated output', () => {
    expect(parseNumstat('')).toEqual({ files: 0, added: 0, removed: 0 })
    expect(parseNumstat('commit message only\n')).toEqual({ files: 0, added: 0, removed: 0 })
  })
})

describe('buildTodayRecap', () => {
  it('lists the sessions that worked today, longest first, with totals', () => {
    const data = {
      report: report([item('a', 540, 40), item('b', 600, 12, { title: 'Wrote the docs', project: 'Dawsha', agent: 'codex' })]),
      changes: { a: { files: 3, added: 20, removed: 4 }, b: { files: 1, added: 5, removed: 0 } }
    }
    const recap = buildTodayRecap(data, now, (entry) => (entry.id === 'a' ? 1.5 : null))
    expect(recap.rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(recap.rows[0]).toMatchObject({ project: 'Platforms', files: 3, added: 20, removed: 4, costUsd: 1.5 })
    expect(recap.totalMs).toBe(minutes(52))
    expect(recap.totalFiles).toBe(4)
    expect(recap.totalAdded).toBe(25)
    expect(recap.totalCostUsd).toBe(1.5)
  })

  it('leaves out a session with no active time today and clips active time to now', () => {
    const late = item('late', 14 * 60 + 30, 29, { spans: [[dayStart + minutes(14 * 60 + 30), dayStart + minutes(15 * 60 + 30)]] })
    const idle = item('idle', 100, 0)
    const recap = buildTodayRecap({ report: report([late, idle]), changes: {} }, now, noCost)
    expect(recap.rows.map((row) => row.id)).toEqual(['late'])
    expect(recap.rows[0].activeMs).toBe(minutes(30))
    expect(recap.rows[0].files).toBe(0)
    expect(recap.totalCostUsd).toBeNull()
  })

  it('is empty without data', () => {
    expect(buildTodayRecap(null, now, noCost).rows).toEqual([])
  })
})

describe('formatRecapText', () => {
  it('writes a plain standup line with time, files and a total', () => {
    const data = {
      report: report([item('a', 540, 40), item('b', 600, 12, { title: 'Wrote the docs', project: 'Dawsha' })]),
      changes: { a: { files: 3, added: 20, removed: 4 }, b: { files: 0, added: 0, removed: 0 } }
    }
    const text = formatRecapText(buildTodayRecap(data, now, (entry) => (entry.id === 'a' ? 1.2 : null)))
    expect(text).toBe('Today: Fixed the restore bug in Platforms (40m, 3 files), Wrote the docs in Dawsha (12m). Total 52m, 3 files, $1.20.')
  })

  it('uses the singular for one file and says so when there is nothing', () => {
    const one = buildTodayRecap({ report: report([item('a', 540, 5)]), changes: { a: { files: 1, added: 1, removed: 0 } } }, now, noCost)
    expect(formatRecapText(one)).toBe('Today: Fixed the restore bug in Platforms (5m, 1 file). Total 5m, 1 file.')
    expect(formatRecapText(buildTodayRecap(null, now, noCost))).toBe('Today: nothing yet.')
  })
})
