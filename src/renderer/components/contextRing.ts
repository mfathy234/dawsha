import { CLEAR_SLASH, COMPACT_SLASH, clearConfirm, type ContextReading } from '../../shared/chatContext'
import { contextRingView, contextSegments, contextUsedLine, contextWindowLine, segmentText } from '../../shared/contextRing'
import { placeMenu } from '../../shared/menuPlacement'
import { h } from '../dom'
import { confirmDialog } from './dialogs'

const SVG = 'http://www.w3.org/2000/svg'
const POPOVER_GAP = 6

export interface ContextRingHost {
  command(text: string): void
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

/** The small ring and share in a pane's header. A click opens the numbers and the two things to do about them. */
export class ContextRing {
  readonly el = h('button', { class: 'ctx-ring', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' })
  private readonly arc = svg('circle', { class: 'ctx-ring-arc', fill: 'none', 'stroke-linecap': 'round' })
  private readonly track = svg('circle', { class: 'ctx-ring-track', fill: 'none' })
  private readonly glyph = svg('svg', { class: 'ctx-ring-svg', 'aria-hidden': 'true', focusable: 'false' })
  private readonly text = h('span', { class: 'ctx-ring-text' })
  private reading: ContextReading | null = null
  private sessionName = ''
  private pop: HTMLElement | null = null
  private stopListening: (() => void) | null = null
  private shownKey = ''

  constructor(private readonly host: ContextRingHost) {
    this.glyph.append(this.track, this.arc)
    this.el.append(this.glyph, this.text)
    this.el.addEventListener('click', () => (this.pop ? this.close(true) : this.open()))
  }

  update(reading: ContextReading | null, sessionName: string): void {
    this.reading = reading
    this.sessionName = sessionName
    this.el.hidden = reading === null
    if (!reading) {
      this.close(false)
      return
    }
    const view = contextRingView(reading)
    const { size, center, radius, strokeWidth, circumference, dashOffset } = view.geometry
    this.glyph.setAttribute('width', String(size))
    this.glyph.setAttribute('height', String(size))
    this.glyph.setAttribute('viewBox', `0 0 ${size} ${size}`)
    for (const circle of [this.track, this.arc]) {
      circle.setAttribute('cx', String(center))
      circle.setAttribute('cy', String(center))
      circle.setAttribute('r', String(radius))
      circle.setAttribute('stroke-width', String(strokeWidth))
    }
    this.arc.setAttribute('stroke-dasharray', String(circumference))
    this.arc.setAttribute('stroke-dashoffset', String(dashOffset))
    this.arc.setAttribute('transform', `rotate(-90 ${center} ${center})`)
    this.text.textContent = view.text
    this.el.dataset.stage = view.stage
    this.el.setAttribute('aria-label', view.label)
    if (this.pop) this.refresh(this.pop, reading)
  }

  /** Closes the popover and drops its document listeners; a closed pane must not leave either behind. */
  destroy(): void {
    this.close(false)
  }

  private refresh(pop: HTMLElement, reading: ContextReading): void {
    if (this.keyOf(reading) === this.shownKey) return
    const focused = Array.from(pop.querySelectorAll('button')).findIndex((button) => button === document.activeElement)
    this.fill(pop, reading)
    this.place(pop)
    if (focused >= 0) pop.querySelectorAll('button')[focused]?.focus()
  }

  private keyOf(reading: ContextReading): string {
    return JSON.stringify([contextSegments(reading), contextUsedLine(reading), contextWindowLine(reading), this.sessionName])
  }

  private open(): void {
    const reading = this.reading
    if (!reading) return
    const pop = h('div', { class: 'popover ctx-pop', role: 'dialog', 'aria-label': 'Context' })
    this.fill(pop, reading)
    document.body.append(pop)
    this.place(pop)
    this.pop = pop
    this.el.setAttribute('aria-expanded', 'true')
    const outside = (event: PointerEvent): void => {
      if (!pop.contains(event.target as Node) && !this.el.contains(event.target as Node)) this.close(false)
    }
    const keys = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.close(true)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keys, true)
    this.stopListening = () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', keys, true)
    }
    pop.querySelector<HTMLElement>('button')?.focus()
  }

  private fill(pop: HTMLElement, reading: ContextReading): void {
    this.shownKey = this.keyOf(reading)
    const segments = contextSegments(reading)
    const windowLine = contextWindowLine(reading)
    const bar = h('div', { class: 'ctx-pop-bar', role: 'img', 'aria-label': contextUsedLine(reading) }, ...segments.map((s) => h('i', { class: `ctx-seg ctx-seg-${s.key}`, style: `width:${s.percent}%` })))
    const legend = h('ul', { class: 'ctx-pop-legend' }, ...segments.map((s) => h('li', {}, h('i', { class: `ctx-key ctx-seg-${s.key}`, 'aria-hidden': 'true' }), segmentText(s))))
    pop.replaceChildren(
      h('div', { class: 'ctx-pop-title' }, 'Context'),
      bar,
      legend,
      h('div', { class: 'ctx-pop-line' }, contextUsedLine(reading)),
      ...(windowLine ? [h('div', { class: 'ctx-pop-quiet' }, windowLine)] : []),
      h(
        'div',
        { class: 'ctx-pop-actions' },
        h('button', { class: 'btn small', type: 'button', onClick: () => this.compact() }, 'Compact'),
        h('button', { class: 'btn small', type: 'button', onClick: () => void this.clear() }, 'Clear')
      )
    )
  }

  private place(pop: HTMLElement): void {
    const rect = this.el.getBoundingClientRect()
    const placed = placeMenu(rect, pop.offsetWidth, pop.offsetHeight, innerWidth, innerHeight, POPOVER_GAP)
    pop.style.position = 'fixed'
    pop.style.left = `${placed.left}px`
    pop.style.top = `${placed.top}px`
    pop.style.maxHeight = placed.maxHeight === null ? '' : `${placed.maxHeight}px`
  }

  private close(returnFocus: boolean): void {
    if (!this.pop) return
    this.stopListening?.()
    this.stopListening = null
    this.pop.remove()
    this.pop = null
    this.shownKey = ''
    this.el.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.el.focus()
  }

  private compact(): void {
    this.close(true)
    this.host.command(COMPACT_SLASH)
  }

  private async clear(): Promise<void> {
    const name = this.sessionName || 'this session'
    this.close(true)
    if (await confirmDialog({ ...clearConfirm(name), danger: true })) this.host.command(CLEAR_SLASH)
  }
}
