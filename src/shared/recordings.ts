import type { TabAgent } from './types'

export interface RecordingMeta {
  id: string
  terminalId: string
  projectId: string | null
  projectName: string
  agent: TabAgent
  title: string
  cwd: string
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  cols: number
  rows: number
}

export interface RecordingSummary extends RecordingMeta {
  bytes: number
  live: boolean
}

export interface RecordingStats {
  count: number
  bytes: number
}

export interface RetentionEntry {
  id: string
  bytes: number
  updatedAt: number
}

export interface RetentionOptions {
  now: number
  keepDays: number
  maxBytes: number
  protectedIds?: ReadonlySet<string>
}

export interface RecordingSettings {
  enabled: boolean
  keepDays: number
  maxMegabytes: number
}

export const DAY_MS = 86_400_000
export const MEGABYTE = 1024 * 1024
export const DEFAULT_KEEP_DAYS = 14
export const DEFAULT_MAX_MEGABYTES = 1024
export const MIN_KEEP_DAYS = 1
export const MAX_KEEP_DAYS = 365
export const MIN_MAX_MEGABYTES = 50
export const MAX_MAX_MEGABYTES = 51_200

export const defaultRecordings = (): RecordingSettings => ({
  enabled: true,
  keepDays: DEFAULT_KEEP_DAYS,
  maxMegabytes: DEFAULT_MAX_MEGABYTES
})

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function sanitizeRecordings(value: unknown): RecordingSettings {
  const defaults = defaultRecordings()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults
  const raw = value as Record<string, unknown>
  return {
    enabled: raw.enabled !== false,
    keepDays: clampInt(raw.keepDays, MIN_KEEP_DAYS, MAX_KEEP_DAYS, defaults.keepDays),
    maxMegabytes: clampInt(raw.maxMegabytes, MIN_MAX_MEGABYTES, MAX_MAX_MEGABYTES, defaults.maxMegabytes)
  }
}

export function selectRetention(entries: RetentionEntry[], options: RetentionOptions): string[] {
  const protectedIds = options.protectedIds ?? new Set<string>()
  const cutoff = options.now - options.keepDays * DAY_MS
  const doomed = new Set<string>()
  for (const entry of entries) {
    if (!protectedIds.has(entry.id) && entry.updatedAt < cutoff) doomed.add(entry.id)
  }
  let total = entries.reduce((sum, entry) => (doomed.has(entry.id) ? sum : sum + entry.bytes), 0)
  const oldestFirst = [...entries].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
  for (const entry of oldestFirst) {
    if (total <= options.maxBytes) break
    if (doomed.has(entry.id) || protectedIds.has(entry.id)) continue
    doomed.add(entry.id)
    total -= entry.bytes
  }
  return oldestFirst.filter((entry) => doomed.has(entry.id)).map((entry) => entry.id)
}

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]{1,120}$/

export const isRecordingId = (value: unknown): value is string =>
  typeof value === 'string' && ID_PATTERN.test(value) && !value.includes('..')

export const safeFileName = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'terminal'

const pad = (value: number): string => String(value).padStart(2, '0')

export const dateFolder = (time: number): string => {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function recordingId(terminalId: string, startedAt: number): string {
  return `${dateFolder(startedAt)}/${safeFileName(terminalId)}-${startedAt.toString(36)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MEGABYTE) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 * MEGABYTE) return `${(bytes / MEGABYTE).toFixed(bytes < 10 * MEGABYTE ? 1 : 0)} MB`
  return `${(bytes / (1024 * MEGABYTE)).toFixed(1)} GB`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export function recordingSeconds(recording: Pick<RecordingMeta, 'startedAt' | 'endedAt'>, now: number): number {
  return Math.max(0, ((recording.endedAt ?? now) - recording.startedAt) / 1000)
}

export function deleteAllSummary(stats: RecordingStats): string {
  const noun = stats.count === 1 ? 'recording' : 'recordings'
  return `${stats.count} ${noun} (${formatBytes(stats.bytes)})`
}

export function filterRecordings(recordings: RecordingSummary[], query: string): RecordingSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const newest = [...recordings].sort((a, b) => b.startedAt - a.startedAt)
  if (words.length === 0) return newest
  return newest.filter((recording) => {
    const haystack = [recording.title, recording.projectName, recording.agent, recording.cwd, dateFolder(recording.startedAt)]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
