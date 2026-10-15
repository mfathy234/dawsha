import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  MEGABYTE,
  dateFolder,
  defaultRecordings,
  deleteAllSummary,
  filterRecordings,
  formatBytes,
  formatDuration,
  isRecordingId,
  recordingId,
  safeFileName,
  sanitizeRecordings,
  selectRetention,
  type RecordingSummary,
  type RetentionEntry
} from '../../src/shared/recordings'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'

const NOW = 100 * DAY_MS
const entry = (id: string, daysOld: number, megabytes: number): RetentionEntry => ({
  id,
  bytes: megabytes * MEGABYTE,
  updatedAt: NOW - daysOld * DAY_MS
})

describe('retention selection', () => {
  it('keeps everything that is recent and small', () => {
    expect(selectRetention([entry('a', 1, 5), entry('b', 2, 5)], { now: NOW, keepDays: 14, maxBytes: 100 * MEGABYTE })).toEqual([])
  })

  it('deletes recordings older than the keep window, oldest first', () => {
    const entries = [entry('new', 1, 1), entry('old', 20, 1), entry('older', 40, 1)]
    expect(selectRetention(entries, { now: NOW, keepDays: 14, maxBytes: 100 * MEGABYTE })).toEqual(['older', 'old'])
  })

  it('deletes the oldest remaining recordings until the total fits the size cap', () => {
    const entries = [entry('a', 5, 40), entry('b', 4, 40), entry('c', 3, 40), entry('d', 2, 40)]
    expect(selectRetention(entries, { now: NOW, keepDays: 14, maxBytes: 100 * MEGABYTE })).toEqual(['a', 'b'])
  })

  it('does not count recordings already deleted by age toward the size cap', () => {
    const entries = [entry('stale', 30, 90), entry('a', 2, 60), entry('b', 1, 30)]
    expect(selectRetention(entries, { now: NOW, keepDays: 14, maxBytes: 100 * MEGABYTE })).toEqual(['stale'])
  })

  it('never selects protected (live) recordings even when over the cap or old', () => {
    const entries = [entry('live', 40, 80), entry('a', 5, 60), entry('b', 1, 60)]
    const doomed = selectRetention(entries, { now: NOW, keepDays: 14, maxBytes: 100 * MEGABYTE, protectedIds: new Set(['live']) })
    expect(doomed).toEqual(['a', 'b'])
  })

  it('breaks ties by id so the result is stable', () => {
    const entries = [entry('b', 3, 60), entry('a', 3, 60)]
    expect(selectRetention(entries, { now: NOW, keepDays: 14, maxBytes: 70 * MEGABYTE })).toEqual(['a'])
  })

  it('handles an empty list', () => {
    expect(selectRetention([], { now: NOW, keepDays: 1, maxBytes: 0 })).toEqual([])
  })
})

describe('recording settings', () => {
  it('defaults to off, 14 days and 1 GB', () => {
    expect(defaultRecordings()).toEqual({ enabled: false, keepDays: 14, maxMegabytes: 1024 })
    expect(defaultSettings().recordings).toEqual(defaultRecordings())
  })

  it('clamps and repairs stored values', () => {
    expect(sanitizeRecordings({ enabled: true, keepDays: 9999, maxMegabytes: 1 })).toEqual({ enabled: true, keepDays: 365, maxMegabytes: 50 })
    expect(sanitizeRecordings({ keepDays: 'many' })).toEqual(defaultRecordings())
    expect(sanitizeRecordings(null)).toEqual(defaultRecordings())
  })

  it('is kept by the settings migration', () => {
    expect(migrateSettings({ recordings: { enabled: true } }).recordings.enabled).toBe(true)
    expect(migrateSettings({ recordings: { enabled: 'yes' } }).recordings.enabled).toBe(false)
    expect(migrateSettings({}).recordings).toEqual(defaultRecordings())
  })
})

describe('recording ids and labels', () => {
  it('builds a dated, file-safe id', () => {
    const when = new Date(2026, 9, 15, 14, 2, 3).getTime()
    const id = recordingId('term/1:x', when)
    expect(id.startsWith(`${dateFolder(when)}/term_1_x-`)).toBe(true)
    expect(isRecordingId(id)).toBe(true)
    expect(dateFolder(when)).toBe('2026-10-15')
  })

  it('rejects ids that could escape the recordings folder', () => {
    for (const bad of ['../x', '2026-10-15/../../x', '2026-10-15/a/b', '/etc/passwd', '2026-10-15\\a', '', 5]) {
      expect(isRecordingId(bad)).toBe(false)
    }
    expect(safeFileName('')).toBe('terminal')
  })

  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * MEGABYTE)).toBe('5.0 MB')
    expect(formatBytes(30 * MEGABYTE)).toBe('30 MB')
    expect(formatBytes(3 * 1024 * MEGABYTE)).toBe('3.0 GB')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(75.9)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('names the count and size for the delete-all dialog', () => {
    expect(deleteAllSummary({ count: 1, bytes: 2048 })).toBe('1 recording (2.0 KB)')
    expect(deleteAllSummary({ count: 12, bytes: 30 * MEGABYTE })).toBe('12 recordings (30 MB)')
  })
})

describe('recording search', () => {
  const make = (id: string, startedAt: number, title: string, projectName: string, agent: RecordingSummary['agent']): RecordingSummary => ({
    id,
    terminalId: id,
    projectId: null,
    projectName,
    agent,
    title,
    cwd: `C:/work/${projectName}`,
    startedAt,
    endedAt: null,
    exitCode: null,
    endReason: null,
    cols: 80,
    rows: 24,
    bytes: 1,
    live: false
  })
  const list = [make('1', 1000, 'Add retry', 'billing', 'codex'), make('2', 3000, 'Fix login', 'web', 'claude'), make('3', 2000, 'Docs', 'web', 'gemini')]

  it('lists newest first with no query', () => {
    expect(filterRecordings(list, '').map((r) => r.id)).toEqual(['2', '3', '1'])
  })

  it('matches every word across title, project and agent', () => {
    expect(filterRecordings(list, 'web').map((r) => r.id)).toEqual(['2', '3'])
    expect(filterRecordings(list, 'web claude').map((r) => r.id)).toEqual(['2'])
    expect(filterRecordings(list, 'RETRY').map((r) => r.id)).toEqual(['1'])
    expect(filterRecordings(list, 'nothing')).toEqual([])
  })
})
