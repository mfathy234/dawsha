import { agentLabel } from '../../shared/agents'
import { textOrderFor } from '../../shared/arabicRows'
import { castDuration, parseCastAsync, type ParsedCast } from '../../shared/cast'
import { formatDuration, type RecordingSummary } from '../../shared/recordings'
import { buildSearchIndex, derivePermissionMarkers, type SearchIndex } from '../../shared/replaySearch'
import { mergeMarkers, recordedMarkers, SPEEDS, type ReplayMarker, type Speed } from '../../shared/replayTiming'
import { api } from '../api'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { closeReplay } from '../replayActions'
import { ReplayPlayer, type PlayerState } from '../replayPlayer'
import type { AppState } from '../state'
import { currentBundle, onThemeChange } from '../themeManager'
import { toast } from './toast'
import { ReplaySearchPanel } from './replaySearchPanel'
import { pageHeader } from './pageHeader'

const MAX_SCALE = 1.6
const SEEK_STEP_SECONDS = 5
const MARKER_LABELS = {
  prompt: 'Prompt sent',
  permission: 'Needs you',
  exit: 'Session ended',
  paused: 'Recording paused',
  resumed: 'Recording resumed',
  truncated: 'Recording stopped at size limit'
} as const

interface Loaded {
  id: string
  meta: RecordingSummary
  cast: ParsedCast
  player: ReplayPlayer
  markers: ReplayMarker[]
  index: SearchIndex
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  !target.classList.contains('xterm-helper-textarea') &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')

function whenLabel(meta: RecordingSummary): string {
  const start = new Date(meta.startedAt)
  const day = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const clock = (time: Date): string => time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const end = meta.endedAt === null ? 'running' : clock(new Date(meta.endedAt))
  return `${day} ${clock(start)} to ${end}`
}

export class ReplayViewComponent {
  readonly el = h('main', { class: 'replay-view', 'aria-label': 'Replay' })
  private readonly pageHead = pageHeader({ title: 'Replay', subtitle: '' })
  private readonly title = this.pageHead.querySelector('h1') as HTMLHeadingElement
  private readonly subtitle = this.pageHead.querySelector('p') as HTMLParagraphElement
  private readonly stageTime = h('span', { class: 'replay-stage-time mono' })
  private readonly stageNote = h('span', { class: 'replay-stage-note' })
  private readonly limitNote = h('span', { class: 'replay-limit', role: 'status', hidden: true }, 'Recording stopped at size limit')
  private readonly stageBody = h('div', { class: 'replay-stage-body' })
  private readonly termSlot = h('div', { class: 'replay-term-slot' })
  private readonly status = h('p', { class: 'replay-status', role: 'status' })
  private readonly elapsed = h('dd', { class: 'mono' })
  private readonly clock = h('dd', { class: 'mono' })
  private readonly search = new ReplaySearchPanel({
    jump: (eventIndex, query) => void this.jumpTo(eventIndex, query)
  })
  private readonly track = h('div', { class: 'replay-track' })
  private readonly fill = h('div', { class: 'replay-fill' })
  private readonly thumb = h('span', { class: 'replay-thumb', 'aria-hidden': 'true' })
  private readonly slider = h('div', {
    class: 'replay-slider',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Playback position',
    'aria-valuemin': '0'
  })
  private readonly playButton = h('button', { class: 'btn icon-only primary replay-play', type: 'button', 'aria-label': 'Play' })
  private readonly timeText = h('span', { class: 'replay-time mono' })
  private readonly totalText = h('span', { class: 'replay-total mono' })
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>()
  private readonly skipIdle = h('input', { type: 'checkbox', id: 'replay-skip-idle', checked: true })
  private loaded: Loaded | null = null
  private loadingId: string | null = null
  private observer: ResizeObserver | null = null
  private unsubscribeTheme: (() => void) | null = null
  private dragging: number | null = null
  private active = false

  constructor() {
    this.buildLayout()
    Object.defineProperty(window, '__replay', {
      configurable: true,
      value: {
        bufferText: (): string => this.loaded?.player.bufferText() ?? '',
        screenText: (): string => this.loaded?.player.screenText() ?? '',
        selection: (): string => this.loaded?.player.term.getSelection() ?? '',
        state: (): PlayerState | null => this.loaded?.player.state ?? null
      }
    })
  }

  update(state: AppState): void {
    const wanted = state.view === 'replay' ? state.replay : null
    this.el.hidden = wanted === null
    if (!wanted) {
      if (this.active) this.deactivate()
      return
    }
    if (!this.active) this.activate()
    if (this.loaded?.id !== wanted.id && this.loadingId !== wanted.id) void this.load(wanted.id)
  }

  private activate(): void {
    this.active = true
    document.addEventListener('keydown', this.onKey, true)
    this.unsubscribeTheme = onThemeChange((bundle) => this.loaded?.player.applyBundle(bundle))
  }

  private deactivate(): void {
    this.active = false
    document.removeEventListener('keydown', this.onKey, true)
    this.unsubscribeTheme?.()
    this.unsubscribeTheme = null
    this.unload()
    this.loadingId = null
  }

  private unload(): void {
    this.observer?.disconnect()
    this.observer = null
    this.loaded?.player.dispose()
    this.loaded = null
    clear(this.termSlot)
    this.search.reset()
  }

  private async load(id: string): Promise<void> {
    this.unload()
    this.loadingId = id
    this.setStatus('Loading recording…')
    this.title.textContent = 'Replay'
    this.subtitle.textContent = ''
    try {
      const [recordings, text] = await Promise.all([api.listRecordings(), api.readRecording(id)])
      const meta = recordings.find((recording) => recording.id === id)
      const cast = await parseCastAsync(text)
      if (this.loadingId !== id || !this.active) return
      if (!meta || !cast) throw new Error('This recording could not be read.')
      this.show({ id, meta, cast })
    } catch (error) {
      if (this.loadingId !== id) return
      this.setStatus((error as Error).message || 'This recording could not be opened.')
      toast((error as Error).message || 'This recording could not be opened.')
    }
  }

  private show(input: { id: string; meta: RecordingSummary; cast: ParsedCast }): void {
    const { id, meta, cast } = input
    const index = buildSearchIndex(cast.events)
    const markers = mergeMarkers(recordedMarkers(cast.events), derivePermissionMarkers(index, cast.events))
    const finished = meta.endedAt === null ? 0 : (meta.endedAt - meta.startedAt) / 1000
    const player = new ReplayPlayer(
      cast,
      Math.max(castDuration(cast.events), finished),
      currentBundle(),
      (state) => this.render(state),
      textOrderFor(meta.agent)
    )
    player.setSkipIdle((this.skipIdle as HTMLInputElement).checked)
    this.loaded = { id, meta, cast, player, markers, index }
    this.setStatus('')
    this.limitNote.hidden = meta.endReason !== 'size-limit'
    this.title.textContent = meta.title || meta.projectName || 'Session'
    this.subtitle.textContent = [meta.projectName, agentLabel(meta.agent), whenLabel(meta)].filter(Boolean).join(' · ')
    this.search.attach(index, cast.events)
    player.mount(this.termSlot)
    this.observer = new ResizeObserver(() => this.fit())
    this.observer.observe(this.stageBody)
    player.term.onResize(() => this.fit())
    this.drawMarkers()
    this.fit()
    void player.seekTo(0).then(() => this.fit())
  }

  private setStatus(text: string): void {
    this.status.textContent = text
    this.status.hidden = text === ''
  }

  private fit(): void {
    const screen = this.termSlot.querySelector<HTMLElement>('.xterm-screen')
    if (!screen || screen.offsetWidth === 0) return
    const width = screen.offsetWidth
    const height = screen.offsetHeight
    const room = this.stageBody.getBoundingClientRect()
    const scale = Math.min(MAX_SCALE, Math.max(0.2, (room.width - 24) / width), Math.max(0.2, (room.height - 24) / height))
    this.termSlot.style.width = `${width * scale}px`
    this.termSlot.style.height = `${height * scale}px`
    const host = this.termSlot.firstElementChild as HTMLElement | null
    if (host) {
      host.style.width = `${width}px`
      host.style.height = `${height}px`
      host.style.transform = `scale(${scale})`
    }
  }

  private render(state: PlayerState): void {
    const loaded = this.loaded
    if (!loaded) return
    const share = state.total > 0 ? Math.min(1, state.position / state.total) : 0
    const percent = `${(share * 100).toFixed(3)}%`
    this.fill.style.width = percent
    this.thumb.style.left = percent
    this.slider.setAttribute('aria-valuemax', String(Math.round(state.total)))
    this.slider.setAttribute('aria-valuenow', String(Math.round(state.position)))
    this.slider.setAttribute('aria-valuetext', `${formatDuration(state.position)} of ${formatDuration(state.total)}`)
    this.timeText.textContent = formatDuration(state.position)
    this.totalText.textContent = `/ ${formatDuration(state.total)}`
    const label = state.playing ? 'Pause' : state.finished ? 'Replay from the start' : 'Play'
    this.playButton.setAttribute('aria-label', label)
    this.playButton.title = `${label} (Space)`
    this.playButton.replaceChildren(icon(state.playing ? ICONS.pause : ICONS.play))
    for (const [speed, button] of this.speedButtons) button.setAttribute('aria-pressed', String(speed === state.speed))
    this.stageTime.textContent = formatDuration(state.recordedSeconds)
    this.stageNote.textContent = state.seeking ? 'Seeking…' : `of ${formatDuration(loaded.cast.events.length > 0 ? castDuration(loaded.cast.events) : 0)} recorded`
    this.elapsed.textContent = `${formatDuration(state.recordedSeconds)} into the session`
    const wall = new Date(loaded.meta.startedAt + state.recordedSeconds * 1000)
    this.clock.textContent = wall.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    this.el.dataset.playing = String(state.playing)
    this.el.dataset.position = state.position.toFixed(2)
  }

  private drawMarkers(): void {
    const loaded = this.loaded
    clear(this.track)
    this.track.append(this.fill)
    if (!loaded) return
    const total = loaded.player.duration
    for (const marker of loaded.markers) {
      const at = loaded.player.positionOf(marker.index)
      const label = `${MARKER_LABELS[marker.kind]} at ${formatDuration(marker.t)}`
      const button = h('button', {
        class: `replay-marker ${marker.kind}`,
        type: 'button',
        tabindex: '-1',
        title: label,
        'aria-label': label,
        'data-kind': marker.kind
      })
      button.style.left = `${total > 0 ? (at / total) * 100 : 0}%`
      button.addEventListener('pointerdown', (event) => event.stopPropagation())
      button.addEventListener('click', () => void loaded.player.seekTo(at))
      this.track.append(button)
    }
    this.track.append(this.thumb)
  }

  private async jumpTo(eventIndex: number, query: string): Promise<void> {
    const player = this.loaded?.player
    if (!player) return
    player.pause()
    await player.seekToEvent(eventIndex)
    this.fit()
    if (!player.highlight(query)) player.clearHighlight()
  }

  private positionFromPointer(event: PointerEvent): number {
    const rect = this.track.getBoundingClientRect()
    const share = rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0
    return share * (this.loaded?.player.duration ?? 0)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    if (document.querySelector('.overlay:not(.leaving)')) return
    if (event.key === 'Escape') {
      // Only a filled text box clears first; a checkbox's value is always 'on'.
      if (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox' && event.target.value !== '') {
        event.preventDefault()
        event.stopPropagation()
        this.search.clear()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeReplay()
      return
    }
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (isTyping(target) || (target instanceof HTMLButtonElement && target !== this.playButton)) return
    event.preventDefault()
    this.loaded?.player.toggle()
  }

  private onSliderKey(event: KeyboardEvent): void {
    const player = this.loaded?.player
    if (!player) return
    const now = player.state.position
    const steps: Record<string, number> = {
      ArrowLeft: now - SEEK_STEP_SECONDS,
      ArrowRight: now + SEEK_STEP_SECONDS,
      PageDown: now - SEEK_STEP_SECONDS * 6,
      PageUp: now + SEEK_STEP_SECONDS * 6,
      Home: 0,
      End: player.duration
    }
    if (!(event.key in steps)) return
    event.preventDefault()
    void player.seekTo(steps[event.key])
  }

  private buildLayout(): void {
    const back = h('button', { class: 'btn ghost', type: 'button', id: 'replay-back', onClick: () => closeReplay() }, '← Back')
    const head = this.pageHead
    head.classList.add('replay-head')
    head.append(
      back,
      h('span', { class: 'replay-divider' }),
      h('span', { class: 'replay-badge' }, 'Replay'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'replay-readonly' }, 'Read only. Nothing here changes your files.')
    )
    const stage = h('section', { class: 'replay-stage', 'aria-label': 'Recorded terminal' },
      h('div', { class: 'replay-stage-head' }, this.stageTime, this.stageNote, h('span', { class: 'spacer' }), this.limitNote),
      h('div', { class: 'replay-stage-frame' }, this.stageBody, this.status)
    )
    this.stageBody.append(this.termSlot)
    const copy = h('button', {
      class: 'btn small',
      type: 'button',
      id: 'replay-copy',
      onClick: () => void this.copyScreen()
    }, 'Copy screen text')
    const side = h('aside', { class: 'replay-side', 'aria-label': 'At this point' },
      h('div', { class: 'replay-card' },
        h('h2', { class: 'replay-card-title' }, 'At this point'),
        h('dl', { class: 'replay-facts' }, h('dt', {}, 'Time elapsed'), this.elapsed, h('dt', {}, 'Clock time'), this.clock),
        h('div', { class: 'replay-card-actions' }, copy)
      ),
      this.search.el
    )
    this.slider.append(this.track)
    this.slider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      this.dragging = event.pointerId
      this.slider.setPointerCapture(event.pointerId)
      this.slider.focus()
      void this.loaded?.player.seekTo(this.positionFromPointer(event))
    })
    this.slider.addEventListener('pointermove', (event) => {
      if (this.dragging !== event.pointerId) return
      void this.loaded?.player.seekTo(this.positionFromPointer(event))
    })
    const release = (event: PointerEvent): void => {
      if (this.dragging !== event.pointerId) return
      this.dragging = null
      if (this.slider.hasPointerCapture(event.pointerId)) this.slider.releasePointerCapture(event.pointerId)
    }
    this.slider.addEventListener('pointerup', release)
    this.slider.addEventListener('pointercancel', release)
    this.slider.addEventListener('keydown', (event) => this.onSliderKey(event))
    this.playButton.addEventListener('click', () => this.loaded?.player.toggle())
    const previous = h('button', {
      class: 'btn icon-only', type: 'button', id: 'replay-prev', 'aria-label': 'Previous marker', title: 'Previous marker',
      onClick: () => this.loaded && void this.loaded.player.step(this.loaded.markers, -1)
    }, icon(ICONS.skipBack))
    const next = h('button', {
      class: 'btn icon-only', type: 'button', id: 'replay-next', 'aria-label': 'Next marker', title: 'Next marker',
      onClick: () => this.loaded && void this.loaded.player.step(this.loaded.markers, 1)
    }, icon(ICONS.skipForward))
    const speeds = h('div', { class: 'replay-speeds', role: 'group', 'aria-label': 'Speed' })
    for (const speed of SPEEDS) {
      const button = h('button', {
        class: 'btn small ghost', type: 'button', 'data-speed': speed, 'aria-pressed': String(speed === 4),
        onClick: () => this.loaded?.player.setSpeed(speed)
      }, `${speed}×`)
      this.speedButtons.set(speed, button)
      speeds.append(button)
    }
    this.skipIdle.addEventListener('change', () => this.loaded?.player.setSkipIdle((this.skipIdle as HTMLInputElement).checked))
    const legend = h('span', { class: 'replay-legend' },
      h('span', {}, h('b', { class: 'prompt' }, '◆'), ' prompt'),
      h('span', {}, h('b', { class: 'permission' }, '◆'), ' needs you'),
      h('span', {}, h('b', { class: 'exit' }, '◆'), ' ended')
    )
    const controls = h('div', { class: 'replay-controls', role: 'group', 'aria-label': 'Playback' },
      this.slider,
      h('div', { class: 'replay-buttons' },
        previous, this.playButton, next, this.timeText, this.totalText,
        h('span', { class: 'spacer' }), legend, h('span', { class: 'spacer' }),
        speeds,
        h('label', { class: 'replay-skip', for: 'replay-skip-idle' }, this.skipIdle, 'Skip idle time')
      )
    )
    this.el.append(head, h('div', { class: 'replay-body' }, stage, side), controls)
    this.playButton.replaceChildren(icon(ICONS.play))
    this.status.hidden = true
  }

  private async copyScreen(): Promise<void> {
    const text = this.loaded?.player.screenText() ?? ''
    if (text === '') {
      toast('The screen is empty at this point.', 'info')
      return
    }
    try {
      await api.writeClipboard(text)
      toast('Screen text copied.', 'info')
    } catch (error) {
      toast((error as Error).message || 'Could not copy the screen text.')
    }
  }
}

