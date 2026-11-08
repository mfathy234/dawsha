import { describe, expect, it } from 'vitest'
import { missedScheduleRuns, nextScheduleTime } from '../../src/shared/schedules'

describe('schedule time selection', () => {
  it('finds the next matching local weekday and time', () => {
    const after = new Date(2026, 10, 8, 10, 30).getTime() // Sunday
    expect(new Date(nextScheduleTime({ days: [1], hour: 9, minute: 15 }, after)!).toString()).toContain('Mon Nov 09 2026 09:15')
  })
  it('returns a one-time run only while it is still upcoming', () => {
    const at = new Date(2026, 10, 9, 9).getTime()
    expect(nextScheduleTime({ onceAt: at }, at - 1)).toBe(at)
    expect(nextScheduleTime({ onceAt: at }, at)).toBeNull()
  })
  it('finds a missed recurring run only inside the allowed window', () => {
    const now = new Date(2026, 10, 9, 10).getTime()
    expect(missedScheduleRuns({ days: [1], hour: 9, minute: 0 }, now, now - 12 * 60 * 60_000)).toHaveLength(1)
    const late = new Date(2026, 10, 9, 22).getTime()
    expect(missedScheduleRuns({ days: [1], hour: 9, minute: 0 }, late, late - 13 * 60 * 60_000)).toHaveLength(0)
  })
})

import { describeSchedule, dueSchedules, recordRun, scheduleNextRun, MAX_RUN_RECORDS } from '../../src/shared/schedules'
import type { ScheduledRun } from '../../src/shared/types'

const base = (over: Partial<ScheduledRun> = {}): ScheduledRun => ({
  id: 's1', name: 'Nightly', projectId: 'p', agent: 'claude', prompt: 'go', days: [1], hour: 9, minute: 0, worktree: true, runs: [], ...over
})

describe('schedule runs', () => {
  it('does not run the same occurrence twice across consecutive checks', () => {
    const at = new Date(2026, 10, 9, 9).getTime()
    const first = dueSchedules([base({ lastCheckedAt: at - 60_000 })], at)
    expect(first.map((d) => d.schedule.id)).toEqual(['s1'])
    expect(dueSchedules([base({ lastCheckedAt: at })], at + 60_000)).toHaveLength(0)
  })
  it('never runs a schedule without a check time and skips occurrences already run', () => {
    const at = new Date(2026, 10, 9, 9, 1).getTime()
    expect(dueSchedules([base()], at)).toHaveLength(0)
    expect(dueSchedules([base({ lastCheckedAt: at - 3600_000, lastRunAt: at - 60_000 })], at)).toHaveLength(0)
  })
  it('runs a missed occurrence once on startup, within 12 hours', () => {
    const now = new Date(2026, 10, 9, 15).getTime()
    expect(dueSchedules([base({ days: [0, 1, 2, 3, 4, 5, 6], lastCheckedAt: now - 5 * 86_400_000 })], now)).toHaveLength(1)
  })
  it('describes and computes the next run', () => {
    expect(describeSchedule(base({ days: [1, 3] }))).toBe('Mon, Wed at 09:00')
    expect(describeSchedule(base({ days: [0, 1, 2, 3, 4, 5, 6], minute: 5 }))).toBe('Every day at 09:05')
    const now = new Date(2026, 10, 8, 10).getTime()
    expect(new Date(scheduleNextRun(base(), now)!).getDay()).toBe(1)
    expect(scheduleNextRun(base({ days: [], onceAt: now - 1 }), now)).toBeNull()
  })
  it('keeps the newest 20 run records', () => {
    let schedule = base()
    for (let i = 0; i < 25; i += 1) schedule = recordRun(schedule, { at: i, status: 'started' })
    expect(schedule.runs).toHaveLength(MAX_RUN_RECORDS)
    expect(schedule.runs[0].at).toBe(24)
    expect(base().runs).toHaveLength(0)
  })
})
