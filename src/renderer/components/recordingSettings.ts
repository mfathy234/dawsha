import {
  MAX_KEEP_DAYS,
  MAX_MAX_MEGABYTES,
  MIN_KEEP_DAYS,
  MIN_MAX_MEGABYTES,
  deleteAllSummary,
  formatBytes,
  type RecordingSettings,
  type RecordingStats
} from '../../shared/recordings'
import { setRecordings } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import type { AppState } from '../state'
import { confirmDialog } from './dialogs'
import { toast } from './toast'

const STATS_TTL_MS = 4000

let stats: RecordingStats | null = null
let statsAt = 0

function row(title: string, control: HTMLElement, ...notes: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, title), ...notes), h('div', { class: 'set-control' }, control))
}

function numberField(id: string, label: string, value: number, min: number, max: number, onCommit: (value: number) => void): HTMLElement {
  const input = h('input', { class: 'text-input replay-number', type: 'number', id, min, max, step: 1, value, 'aria-label': label })
  input.addEventListener('change', () => {
    const parsed = Number(input.value)
    if (!Number.isFinite(parsed)) {
      input.value = String(value)
      return
    }
    onCommit(Math.min(max, Math.max(min, Math.round(parsed))))
  })
  return input
}

async function deleteAll(refresh: () => void): Promise<void> {
  try {
    const current = await api.recordingStats()
    if (current.count === 0) {
      toast('There are no recordings to delete.', 'info')
      return
    }
    const summary = deleteAllSummary(current)
    const confirmed = await confirmDialog({
      title: 'Delete all recordings?',
      body: `This permanently deletes ${summary}. Recordings of sessions that are running right now are kept. This cannot be undone.`,
      confirmLabel: `Delete ${summary}`
    })
    if (!confirmed) return
    const removed = await api.deleteAllRecordings()
    stats = null
    toast(`Deleted ${removed} ${removed === 1 ? 'recording' : 'recordings'}.`, 'info')
    refresh()
  } catch (error) {
    toast((error as Error).message || 'Recordings could not be deleted.')
  }
}

export function invalidateRecordingStats(): void {
  stats = null
  statsAt = 0
}

export function recordingRows(state: AppState, refresh: () => void): HTMLElement[] {
  const settings: RecordingSettings = state.settings.recordings
  if (stats === null || Date.now() - statsAt > STATS_TTL_MS) {
    statsAt = Date.now()
    void api.recordingStats().then(
      (next) => {
        const changed = stats === null || stats.count !== next.count || stats.bytes !== next.bytes
        stats = next
        if (changed) refresh()
      },
      () => undefined
    )
  }
  const input = h('input', { type: 'checkbox', id: 'recordings-enabled' })
  input.checked = settings.enabled
  input.addEventListener('change', () => setRecordings({ enabled: input.checked }))
  const usage = stats ? `${stats.count} ${stats.count === 1 ? 'recording' : 'recordings'} using ${formatBytes(stats.bytes)}.` : 'Checking saved recordings…'
  return [
    row(
      'Record sessions',
      h('label', { class: 'check', for: 'recordings-enabled' }, input, 'Record every terminal so it can be replayed'),
      h('p', { class: 'hint' }, 'Off by default. Recordings keep everything a terminal prints, including secrets you display, in plain text on this PC. Pause one terminal from its pane menu.')
    ),
    row(
      'Keep recordings for',
      h('div', { class: 'set-inline' }, numberField('recordings-days', 'Days to keep recordings', settings.keepDays, MIN_KEEP_DAYS, MAX_KEEP_DAYS, (keepDays) => setRecordings({ keepDays })), h('span', {}, 'days')),
      h('p', { class: 'hint' }, 'Older recordings are deleted at startup and once a day.')
    ),
    row(
      'Maximum total size',
      h('div', { class: 'set-inline' }, numberField('recordings-size', 'Maximum size of all recordings in megabytes', settings.maxMegabytes, MIN_MAX_MEGABYTES, MAX_MAX_MEGABYTES, (maxMegabytes) => setRecordings({ maxMegabytes })), h('span', {}, 'MB')),
      h('p', { class: 'hint' }, 'When recordings grow past this, the oldest are deleted first.')
    ),
    row(
      'Saved recordings',
      h('div', { class: 'set-inline' },
        h('button', { class: 'btn ghost small', type: 'button', id: 'recordings-open', onClick: () => void api.openRecordingsFolder().catch((error: Error) => toast(error.message)) }, 'Open recordings folder'),
        h('button', { class: 'btn ghost small danger-text', type: 'button', id: 'recordings-delete', onClick: () => void deleteAll(refresh) }, 'Delete all recordings…')
      ),
      h('p', { class: 'hint', id: 'recordings-usage' }, usage)
    )
  ]
}
