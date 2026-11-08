import type { ScheduledRun, ScheduleRunRecord } from './types'

export interface WeeklySchedule { days: number[]; hour: number; minute: number }
export interface OnceSchedule { onceAt: number }
export type ScheduleTime = WeeklySchedule | OnceSchedule

/** Returns the next wall-clock local occurrence. Rebuilding each candidate with the local Date constructor follows DST. */
export function nextScheduleTime(schedule: ScheduleTime, after: number): number | null {
  if ('onceAt' in schedule) return schedule.onceAt > after ? schedule.onceAt : null
  if (!schedule.days.length || schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) return null
  const base = new Date(after)
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, schedule.hour, schedule.minute)
    if (!schedule.days.includes(day.getDay()) || day.getTime() <= after) continue
    return day.getTime()
  }
  return null
}

/** Returns at most one occurrence missed since the saved check time, within the startup lookback. */
export function missedScheduleRuns(schedule: ScheduleTime, now: number, checkedAt: number, lookbackMs = 12 * 60 * 60_000): number[] {
  const lower = Math.max(checkedAt, now - lookbackMs)
  let candidate: number | null
  if ('onceAt' in schedule) candidate = schedule.onceAt > lower && schedule.onceAt <= now ? schedule.onceAt : null
  else {
    const prior = nextScheduleTime(schedule, lower)
    candidate = prior !== null && prior <= now ? prior : null
  }
  return candidate === null ? [] : [candidate]
}

export const MAX_RUN_RECORDS = 20
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (value: number): string => String(value).padStart(2, '0')

const timeOf = (schedule: ScheduledRun): ScheduleTime =>
  schedule.onceAt === undefined ? { days: schedule.days, hour: schedule.hour, minute: schedule.minute } : { onceAt: schedule.onceAt }

export const scheduleNextRun = (schedule: ScheduledRun, now: number): number | null => nextScheduleTime(timeOf(schedule), now)

/** "Mon, Wed at 09:00", "Every day at 09:05" or "Once, Nov 9, 09:00". */
export function describeSchedule(schedule: ScheduledRun, locale?: string): string {
  if (schedule.onceAt !== undefined) {
    return `Once, ${new Date(schedule.onceAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  }
  const days = [...new Set(schedule.days)].sort((a, b) => a - b)
  const label = days.length === 7 ? 'Every day' : days.map((day) => DAY_NAMES[day]).join(', ')
  return `${label} at ${pad(schedule.hour)}:${pad(schedule.minute)}`
}

export interface DueRun { schedule: ScheduledRun; at: number }

/**
 * Schedules with an occurrence since their last check. A schedule with no check time never fires (it is stamped first),
 * the lookback caps catch-up after a long close, and an occurrence that already ran is not repeated.
 */
export function dueSchedules(schedules: readonly ScheduledRun[], now: number): DueRun[] {
  return schedules.flatMap((schedule): DueRun[] => {
    if (schedule.lastCheckedAt === undefined) return []
    const [at] = missedScheduleRuns(timeOf(schedule), now, schedule.lastCheckedAt)
    return at === undefined || (schedule.lastRunAt !== undefined && schedule.lastRunAt >= at) ? [] : [{ schedule, at }]
  })
}

/** A copy of the schedule with the run added at the front, keeping the newest MAX_RUN_RECORDS. */
export const recordRun = (schedule: ScheduledRun, record: ScheduleRunRecord): ScheduledRun => ({
  ...schedule,
  lastRunAt: record.at,
  runs: [record, ...schedule.runs].slice(0, MAX_RUN_RECORDS)
})
