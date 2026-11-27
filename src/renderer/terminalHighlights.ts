import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import {
  compileRules,
  highlightBackground,
  highlightTint,
  type CompiledRules,
  type HighlightColor,
  type HighlightRule,
  type HighlightSettings
} from '../shared/highlights'

export const MAX_DECORATIONS = 500
const MAX_SCAN_ROWS = 5000
const RECENT_ROWS = 200

export interface HighlightHost {
  config(): { settings: HighlightSettings; kind: 'dark' | 'light' }
  /** A line matched a rule that has a trigger; the host decides whether it is worth announcing. */
  fire?(rule: HighlightRule, line: string): void
}

export class TerminalHighlights {
  private decorations: IDecoration[] = []
  private marker: IMarker | null = null
  private compiled: { rules: HighlightRule[]; value: CompiledRules } | null = null
  private readonly subscription: IDisposable
  /** False while the terminal is hidden: lines still run their triggers, but get no decoration, which a hidden terminal would only draw and throw away. */
  private active = true
  private readonly colors = new WeakMap<IDecoration, HighlightColor>()
  private skipped = false

  constructor(
    private readonly term: Terminal,
    private readonly host: HighlightHost
  ) {
    this.resetMarker()
    this.subscription = term.onWriteParsed(() => this.scan())
  }

  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (active && this.skipped) this.decorateRecent()
  }

  refresh(): void {
    if (!this.host.config().settings.enabled) this.clear()
    this.resetMarker()
  }

  dispose(): void {
    this.subscription.dispose()
    this.clear()
  }

  private clear(): void {
    for (const decoration of this.decorations) decoration.dispose()
    this.decorations = []
    this.dropMarker()
  }

  private dropMarker(): void {
    this.marker?.dispose()
    this.marker = null
  }

  private resetMarker(): void {
    this.marker?.dispose()
    this.marker = this.term.registerMarker(0) ?? null
  }

  private rules(settings: HighlightSettings): CompiledRules {
    if (this.compiled?.rules !== settings.rules) this.compiled = { rules: settings.rules, value: compileRules(settings.rules) }
    return this.compiled.value
  }

  private scan(): void {
    const { settings, kind } = this.host.config()
    const buffer = this.term.buffer.active
    if (buffer.type !== 'normal') return this.dropMarker()
    if (!settings.enabled || settings.rules.length === 0) return this.resetMarker()
    const cursor = buffer.baseY + buffer.cursorY
    if (this.marker && !this.marker.isDisposed && cursor < this.marker.line) this.dropFrom(cursor, this.rules(settings))
    if (!this.marker || this.marker.isDisposed || cursor < this.marker.line) return this.resetMarker()
    const from = Math.max(this.marker.line, cursor - MAX_SCAN_ROWS)
    if (cursor === from) return
    const rules = this.rules(settings)
    for (let row = from; row < cursor; row += 1) {
      const text = buffer.getLine(row)?.translateToString(true) ?? ''
      const rule = rules.match(text)
      if (!rule) continue
      if (this.active) this.decorate(row, cursor, rule.color, kind)
      else this.skipped = true
      if (rule.trigger) this.host.fire?.(rule, text)
    }
    this.resetMarker()
  }

  /** After a stay out of sight, decorates the matching lines of the screen and the rows just above it. */
  private decorateRecent(): void {
    this.skipped = false
    const { settings, kind } = this.host.config()
    const buffer = this.term.buffer.active
    if (buffer.type !== 'normal' || !settings.enabled || settings.rules.length === 0) return
    const cursor = buffer.baseY + buffer.cursorY
    const rules = this.rules(settings)
    for (let row = Math.max(0, cursor - this.term.rows - RECENT_ROWS); row < cursor; row += 1) {
      const rule = rules.match(buffer.getLine(row)?.translateToString(true) ?? '')
      if (rule) this.decorate(row, cursor, rule.color, kind)
    }
  }

  /** A program that redraws its screen rewinds the cursor over rows it prints again; a row that still matches keeps its decoration instead of getting a new one on every redraw. */
  private dropFrom(row: number, rules: CompiledRules): void {
    const buffer = this.term.buffer.active
    for (const decoration of this.decorations) {
      const line = decoration.marker.line
      if (line < row) continue
      const rule = rules.match(buffer.getLine(line)?.translateToString(true) ?? '')
      if (!rule || this.colors.get(decoration) !== rule.color) decoration.dispose()
    }
    this.decorations = this.decorations.filter((d) => !d.isDisposed)
  }

  private decorate(row: number, cursor: number, color: HighlightColor, kind: 'dark' | 'light'): void {
    this.decorations = this.decorations.filter((d) => !d.isDisposed)
    if (this.decorations.some((d) => d.marker.line === row)) return
    const marker = this.term.registerMarker(row - cursor)
    if (!marker) return
    const decoration = this.term.registerDecoration({ marker, x: 0, width: this.term.cols, height: 1, layer: 'bottom' })
    if (!decoration) {
      marker.dispose()
      return
    }
    decoration.onRender((element) => {
      // xterm calls this on every repaint of the row; the styles only need setting once per element.
      if (element.dataset.hl === color && element.dataset.hlKind === kind) return
      element.classList.add('term-hl')
      element.dataset.hl = color
      element.dataset.hlKind = kind
      element.style.width = '100%'
      element.style.pointerEvents = 'none'
      element.style.background = highlightBackground(color, kind)
      element.style.boxShadow = `inset 3px 0 0 ${highlightTint(color)}`
    })
    this.colors.set(decoration, color)
    this.decorations.push(decoration)
    while (this.decorations.length > MAX_DECORATIONS) this.decorations.shift()?.dispose()
  }
}
