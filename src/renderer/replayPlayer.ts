import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import type { ParsedCast } from '../shared/cast'
import {
  advancePosition,
  buildTimeline,
  clampPosition,
  eventCountAt,
  positionOfEvent,
  seekPlan,
  stepMarker,
  type ReplayMarker,
  type Speed,
  type Timeline
} from '../shared/replayTiming'
import { SEARCH_DECORATIONS } from './terminalSearch'
import { TERMINAL_FONT } from './terminalFont'
import type { ThemeBundle } from './themeManager'

export const REPLAY_FONT_SIZE = 13
const REPLAY_SCROLLBACK = 5000

export interface PlayerState {
  position: number
  total: number
  playing: boolean
  speed: Speed
  skipIdle: boolean
  applied: number
  recordedSeconds: number
  seeking: boolean
  finished: boolean
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export class ReplayPlayer {
  readonly term: Terminal
  private readonly search = new SearchAddon()
  private timeline: Timeline
  private applied = 0
  private position = 0
  private playing = false
  private speed: Speed = 4
  private skipIdle = true
  private seeking = false
  private pendingSeek: number | null = null
  private frame = 0
  private lastFrame = 0
  private disposed = false
  private readonly waiters = new Set<() => void>()

  constructor(
    private readonly cast: ParsedCast,
    private readonly endAt: number,
    bundle: ThemeBundle,
    private readonly onChange: (state: PlayerState) => void
  ) {
    this.term = new Terminal({
      cols: cast.header.width,
      rows: cast.header.height,
      fontFamily: TERMINAL_FONT,
      fontSize: REPLAY_FONT_SIZE,
      lineHeight: 1.2,
      scrollback: REPLAY_SCROLLBACK,
      cursorBlink: false,
      disableStdin: true,
      allowProposedApi: true,
      allowTransparency: true,
      theme: bundle.xterm,
      minimumContrastRatio: bundle.minimumContrastRatio
    })
    this.term.loadAddon(this.search)
    this.timeline = buildTimeline(cast.events, endAt, this.skipIdle)
  }

  mount(parent: HTMLElement): void {
    this.term.open(parent)
    this.emit()
  }

  applyBundle(bundle: ThemeBundle): void {
    this.term.options.theme = bundle.xterm
    this.term.options.minimumContrastRatio = bundle.minimumContrastRatio
  }

  get state(): PlayerState {
    const last = this.applied > 0 ? this.cast.events[this.applied - 1].t : 0
    return {
      position: this.position,
      total: this.timeline.total,
      playing: this.playing,
      speed: this.speed,
      skipIdle: this.skipIdle,
      applied: this.applied,
      recordedSeconds: last,
      seeking: this.seeking,
      finished: this.position >= this.timeline.total
    }
  }

  get duration(): number {
    return this.timeline.total
  }

  positionOf(eventIndex: number): number {
    return positionOfEvent(this.timeline, eventIndex)
  }

  play(): void {
    if (this.playing || this.disposed) return
    if (this.position >= this.timeline.total) void this.seekTo(0)
    this.playing = true
    this.lastFrame = performance.now()
    this.frame = requestAnimationFrame(this.tick)
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.frame)
    this.emit()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  setSpeed(speed: Speed): void {
    this.speed = speed
    this.emit()
  }

  setSkipIdle(skipIdle: boolean): void {
    if (this.skipIdle === skipIdle) return
    this.skipIdle = skipIdle
    this.timeline = buildTimeline(this.cast.events, this.endAt, skipIdle)
    this.position = this.applied > 0 ? this.timeline.times[this.applied - 1] : 0
    this.emit()
  }

  step(markers: ReplayMarker[], direction: 1 | -1): Promise<void> {
    return this.seekTo(stepMarker(markers, this.timeline, this.position, direction))
  }

  seekToEvent(eventIndex: number): Promise<void> {
    return this.seekTo(positionOfEvent(this.timeline, eventIndex))
  }

  async seekTo(position: number): Promise<void> {
    this.pendingSeek = clampPosition(this.timeline, position)
    if (this.seeking) return
    this.seeking = true
    this.emit()
    try {
      while (this.pendingSeek !== null && !this.disposed) {
        const next = this.pendingSeek
        this.pendingSeek = null
        await this.runSeek(next)
      }
    } finally {
      this.seeking = false
      this.emit()
    }
  }

  highlight(query: string): boolean {
    this.term.clearSelection()
    return this.search.findNext(query, { caseSensitive: false, decorations: SEARCH_DECORATIONS })
  }

  clearHighlight(): void {
    this.search.clearDecorations()
    this.term.clearSelection()
  }

  screenText(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = buffer.viewportY; row < buffer.viewportY + this.term.rows; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    return lines.join('\n')
  }

  bufferText(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row += 1) lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    return lines.join('\n')
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    for (const release of this.waiters) release()
    this.waiters.clear()
    cancelAnimationFrame(this.frame)
    this.term.dispose()
  }

  private readonly tick = (now: number): void => {
    if (!this.playing || this.disposed) return
    const elapsed = (now - this.lastFrame) / 1000
    this.lastFrame = now
    if (!this.seeking) {
      this.position = advancePosition(this.timeline, this.position, elapsed, this.speed)
      this.applyTo(eventCountAt(this.timeline, this.position))
      if (this.position >= this.timeline.total) {
        this.playing = false
        this.emit()
        return
      }
    }
    this.emit()
    this.frame = requestAnimationFrame(this.tick)
  }

  private applyTo(count: number): void {
    if (count <= this.applied) return
    const plan = seekPlan(this.cast.events, this.applied, count)
    for (const step of plan.steps) {
      if (step.type === 'write') this.term.write(step.data)
      else this.term.resize(step.cols, step.rows)
    }
    this.applied = count
  }

  private async runSeek(position: number): Promise<void> {
    const count = eventCountAt(this.timeline, position)
    const plan = seekPlan(this.cast.events, this.applied, count)
    if (plan.reset) {
      this.term.reset()
      this.term.resize(this.cast.header.width, this.cast.header.height)
      this.applied = 0
    }
    for (const step of plan.steps) {
      if (this.disposed) return
      if (step.type === 'resize') this.term.resize(step.cols, step.rows)
      else await this.writeAndWait(step.data)
      if (this.disposed) return
      await yieldToUi()
    }
    this.applied = count
    this.position = position
    this.emit()
  }

  private writeAndWait(data: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const release = (): void => {
        this.waiters.delete(release)
        resolve()
      }
      this.waiters.add(release)
      this.term.write(data, release)
    })
  }

  private emit(): void {
    if (!this.disposed) this.onChange(this.state)
  }
}
