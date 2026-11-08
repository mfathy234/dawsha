import { describe, expect, it } from 'vitest'
import { buildSchedule, formatLocalInput, type ScheduleForm } from '../../src/shared/scheduleForm'

const now = new Date(2026, 10, 8, 10, 0).getTime()
const form = (over: Partial<ScheduleForm> = {}): ScheduleForm => ({
  name: '', projectId: 'p', agent: 'claude', prompt: 'Run the tests\nand report', kind: 'weekly', days: [1, 3], time: '09:30', onceLocal: '', worktree: true, ...over
})

describe('schedule form', () => {
  it('builds a weekly schedule, naming it after the prompt and starting its check clock now', () => {
    const result = buildSchedule(form(), 'id1', undefined, now)
    expect(result).toMatchObject({ ok: true, schedule: { id: 'id1', name: 'Run the tests', hour: 9, minute: 30, days: [1, 3], lastCheckedAt: now, runs: [] } })
  })
  it('keeps the history of an edited schedule', () => {
    const first = buildSchedule(form(), 'id1', undefined, now)
    if (!first.ok) throw new Error('expected a schedule')
    const edited = buildSchedule(form({ name: 'Nightly' }), 'id1', { ...first.schedule, lastRunAt: 5, runs: [{ at: 5, status: 'started' }] }, now)
    expect(edited).toMatchObject({ ok: true, schedule: { name: 'Nightly', lastRunAt: 5, runs: [{ at: 5, status: 'started' }] } })
  })
  it('builds a one-time schedule only for a future time', () => {
    const future = formatLocalInput(now + 60_000)
    expect(buildSchedule(form({ kind: 'once', onceLocal: future }), 'id', undefined, now)).toMatchObject({ ok: true, schedule: { onceAt: now + 60_000, days: [] } })
    expect(buildSchedule(form({ kind: 'once', onceLocal: formatLocalInput(now - 120_000) }), 'id', undefined, now)).toMatchObject({ ok: false })
    expect(buildSchedule(form({ kind: 'once', onceLocal: '' }), 'id', undefined, now)).toMatchObject({ ok: false })
  })
  it('rejects an empty prompt, no days and a bad time', () => {
    expect(buildSchedule(form({ prompt: '  ' }), 'id', undefined, now)).toMatchObject({ ok: false })
    expect(buildSchedule(form({ days: [] }), 'id', undefined, now)).toMatchObject({ ok: false })
    expect(buildSchedule(form({ time: '' }), 'id', undefined, now)).toMatchObject({ ok: false })
  })
})
