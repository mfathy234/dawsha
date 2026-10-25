import { agentLabel } from '../../shared/agents'
import { filterRecordings, formatBytes, formatDuration, recordingSeconds, type RecordingSummary } from '../../shared/recordings'
import { api } from '../api'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { setRecordings } from '../actions'
import { closeReplayPicker, openReplay } from '../replayActions'
import { store } from '../state'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import { popupDismissButton } from './popupDismiss'

const SEARCH_DELAY_MS = 100

function whenText(time: number): string {
  const date = new Date(time)
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return `today ${clock}`
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (sameDay(date, yesterday)) return `yesterday ${clock}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`
}

export class ReplayPickerComponent {
  private overlay: HTMLElement | null = null
  private input: HTMLInputElement | null = null
  private list: HTMLElement | null = null
  private recordings: RecordingSummary[] = []
  private shown: RecordingSummary[] = []
  private selected = 0
  private loading = false
  private previous: HTMLElement | null = null
  private timer: number | undefined
  private token = 0

  update(state: AppState): void {
    if (state.replayPickerOpen && !this.overlay) this.open()
    if (this.overlay && this.recordings.length === 0 && !this.loading) this.render()
    if (!state.replayPickerOpen && this.overlay) this.teardown()
  }

  private open(): void {
    this.previous = document.activeElement as HTMLElement | null
    this.selected = 0
    this.input = h('input', {
      class: 'palette-input',
      id: 'replay-picker-input',
      type: 'text',
      placeholder: 'Search recordings by title, project, agent or date',
      'aria-label': 'Search recordings',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'replay-picker-list',
      autocomplete: 'off',
      spellcheck: 'false'
    })
    this.list = h('div', { class: 'palette-list', id: 'replay-picker-list', role: 'listbox', 'aria-label': 'Recordings, newest first' })
    const dialog = h('div', { class: 'palette replay-picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Replay a session' },
      h('div', { class: 'palette-head' }, icon(ICONS.history), this.input, popupDismissButton(() => this.dismiss())),
      this.list,
      h('div', { class: 'palette-foot' },
        h('span', { class: 'palette-hint-item' }, h('span', { class: 'palette-kbd' }, 'Enter'), ' replay'),
        h('span', { class: 'palette-hint-item' }, h('span', { class: 'palette-kbd' }, 'Up Down'), ' move'),
        h('span', { class: 'palette-hint-item' }, h('span', { class: 'palette-kbd' }, 'Esc'), ' close'))
    )
    this.overlay = h('div', { class: 'overlay palette-overlay' }, dialog)
    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) this.dismiss()
    })
    this.input.addEventListener('input', () => {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.selected = 0
        this.render()
      }, SEARCH_DELAY_MS)
    })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    document.body.appendChild(this.overlay)
    this.loading = true
    this.render()
    this.input.focus()
    const token = ++this.token
    api.listRecordings().then(
      (recordings) => {
        if (token !== this.token) return
        this.recordings = recordings
        this.loading = false
        this.render()
      },
      () => {
        if (token !== this.token) return
        this.loading = false
        this.render()
      }
    )
  }

  private teardown(): void {
    this.token += 1
    window.clearTimeout(this.timer)
    this.overlay?.remove()
    this.overlay = null
    this.input = null
    this.list = null
    this.recordings = []
    this.shown = []
  }

  private dismiss(): void {
    const previous = this.previous
    closeReplayPicker()
    requestAnimationFrame(() => {
      if (!document.querySelector('.overlay, .popover')) previous?.focus()
    })
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.dismiss()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (this.shown.length === 0) return
      this.select((this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % this.shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      window.clearTimeout(this.timer)
      this.render()
      const chosen = this.shown[this.selected]
      if (chosen) openReplay(chosen.id)
    }
  }

  private select(index: number): void {
    this.selected = index
    this.list?.querySelectorAll('.palette-row').forEach((row, position) => {
      const on = position === index
      row.classList.toggle('selected', on)
      row.setAttribute('aria-selected', String(on))
      if (on) row.scrollIntoView({ block: 'nearest' })
    })
    this.input?.setAttribute('aria-activedescendant', `replay-row-${index}`)
  }

  private render(): void {
    if (!this.list || !this.input) return
    this.shown = filterRecordings(this.recordings, this.input.value)
    this.selected = Math.min(this.selected, Math.max(0, this.shown.length - 1))
    clear(this.list)
    if (this.shown.length === 0) {
      this.list.append(this.emptyState())
      return
    }
    this.shown.forEach((recording, position) => this.list?.append(this.row(recording, position)))
    this.select(this.selected)
  }

  private emptyState(): HTMLElement {
    if (this.loading) return h('p', { class: 'palette-empty' }, 'Loading recordings…')
    if (this.recordings.length > 0) return h('p', { class: 'palette-empty' }, 'No recordings match that.')
    const { recordings } = store.state.settings
    if (recordings.enabled) {
      return h('p', { class: 'palette-empty' }, 'No recordings yet. Sessions you start from now on are recorded.')
    }
    return h('div', { class: 'replay-empty' },
      h('p', {}, 'Recording is off, so there is nothing to replay.'),
      h('p', { class: 'hint' }, `When on, Dawsha stores everything each terminal prints (including anything secret you display) for ${recordings.keepDays} days. It stays on this PC and you can delete it any time in Settings.`),
      h('button', { class: 'btn primary', type: 'button', id: 'replay-turn-on', onClick: () => setRecordings({ enabled: true }) }, 'Turn on recording')
    )
  }

  private row(recording: RecordingSummary, position: number): HTMLElement {
    const title = recording.title || recording.projectName || 'Untitled session'
    const duration = formatDuration(recordingSeconds(recording, Date.now()))
    const meta = [recording.projectName, agentLabel(recording.agent), whenText(recording.startedAt), recording.live ? 'recording now' : duration, formatBytes(recording.bytes)]
      .filter(Boolean)
      .join(' · ')
    const element = h('div', {
      class: 'palette-row replay-row',
      role: 'option',
      id: `replay-row-${position}`,
      'aria-selected': 'false',
      'data-recording': recording.id
    },
    h('span', { class: 'palette-lead' }, agentMark(recording.agent) ?? icon(ICONS.terminal)),
    h('span', { class: 'replay-row-main' }, h('span', { class: 'palette-title' }, title), h('span', { class: 'replay-row-meta' }, meta)))
    element.addEventListener('mousemove', () => {
      if (this.selected !== position) this.select(position)
    })
    element.addEventListener('click', () => openReplay(recording.id))
    return element
  }
}
