import { h } from '../dom'
import {
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  SPLIT_STEP,
  applyDelta,
  defaultSplit
} from '../../shared/splits'
import type { GridSplit } from '../../shared/types'

export type Axis = 'cols' | 'rows'

export interface GutterInfo {
  grid: HTMLElement
  enabled: boolean
  cols: number
  rows: number
  rowsFrom: number
  variant: string
  sizes: GridSplit
  spanned: Set<number>
}

interface Gutter {
  el: HTMLElement
  axis: Axis
  boundary: number
}

const pixels = (template: string): number[] =>
  template.split(' ').map((token) => Number.parseFloat(token)).filter((value) => Number.isFinite(value))

export class GridGutters {
  readonly el = h('div', { class: 'gutters', hidden: true })
  private readonly gutters = new Map<string, Gutter>()
  private info: GutterInfo | null = null
  private live: { axis: Axis; sizes: number[] } | null = null
  private dragging: { axis: Axis; boundary: number; start: number; sizes: number[]; total: number } | null = null

  constructor(private readonly onChange: (axis: Axis, sizes: number[]) => void) {}

  update(info: GutterInfo): void {
    this.info = info
    this.live = null
    const wanted = new Set<string>()
    if (info.enabled) {
      for (let boundary = 0; boundary < info.cols - 1; boundary += 1) wanted.add(`cols-${boundary}`)
      for (let boundary = 0; boundary < info.rows - 1; boundary += 1) wanted.add(`rows-${boundary}`)
    }
    for (const [key, gutter] of this.gutters) {
      if (!wanted.has(key)) {
        gutter.el.remove()
        this.gutters.delete(key)
      }
    }
    for (const key of wanted) {
      if (this.gutters.has(key)) continue
      const [axis, boundary] = key.split('-')
      const gutter = this.build(axis as Axis, Number(boundary))
      this.gutters.set(key, gutter)
      this.el.append(gutter.el)
    }
    this.el.hidden = !info.enabled || wanted.size === 0
    this.position()
  }

  position(): void {
    const info = this.info
    if (!info || !info.enabled) return
    const style = getComputedStyle(info.grid)
    const columns = pixels(style.gridTemplateColumns)
    const rows = pixels(style.gridTemplateRows)
    if (columns.length !== info.cols || rows.length !== info.rows) return
    const gap = Number.parseFloat(style.columnGap) || 0
    const rowGap = Number.parseFloat(style.rowGap) || 0
    const left = Number.parseFloat(style.paddingLeft) || 0
    const top = Number.parseFloat(style.paddingTop) || 0
    const width = columns.reduce((sum, value) => sum + value, 0) + gap * (info.cols - 1)
    const height = rows.reduce((sum, value) => sum + value, 0) + rowGap * (info.rows - 1)
    const originX = info.grid.offsetLeft + left
    const originY = info.grid.offsetTop + top
    for (const gutter of this.gutters.values()) {
      const sizes = info.sizes[gutter.axis]
      gutter.el.setAttribute('aria-valuenow', String(Math.round(sizes[gutter.boundary] * 100)))
      const style = gutter.el.style
      if (gutter.axis === 'cols') {
        const offset = columns.slice(0, gutter.boundary + 1).reduce((sum, value) => sum + value, 0)
        const x = originX + offset + gap * gutter.boundary
        const clipped = info.spanned.has(gutter.boundary) && info.rows > 1
        const length = clipped
          ? rows.slice(0, info.rows - 1).reduce((sum, value) => sum + value, 0) + rowGap * (info.rows - 2)
          : height
        style.left = `${x}px`
        style.top = `${originY}px`
        style.width = `${gap}px`
        style.height = `${length}px`
      } else {
        const offset = rows.slice(0, gutter.boundary + 1).reduce((sum, value) => sum + value, 0)
        const skip = info.rowsFrom
        const inset = columns.slice(0, skip).reduce((sum, value) => sum + value, 0) + gap * skip
        style.left = `${originX + inset}px`
        style.top = `${originY + offset + rowGap * gutter.boundary}px`
        style.width = `${width - inset}px`
        style.height = `${rowGap}px`
      }
    }
  }

  private build(axis: Axis, boundary: number): Gutter {
    const el = h('div', {
      class: `gutter gutter-${axis}`,
      role: 'separator',
      tabindex: '0',
      'aria-orientation': axis === 'cols' ? 'vertical' : 'horizontal',
      'aria-label': axis === 'cols' ? `Resize columns ${boundary + 1} and ${boundary + 2}` : `Resize rows ${boundary + 1} and ${boundary + 2}`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'data-axis': axis,
      'data-boundary': String(boundary)
    })
    el.addEventListener('pointerdown', (event) => this.begin(event, axis, boundary, el))
    el.addEventListener('pointermove', (event) => this.move(event))
    el.addEventListener('pointerup', (event) => this.end(event, el))
    el.addEventListener('pointercancel', (event) => this.end(event, el))
    el.addEventListener('dblclick', () => {
      const info = this.info
      if (info) this.emit(axis, this.defaults(axis))
    })
    el.addEventListener('keydown', (event) => this.key(event, axis, boundary))
    return { el, axis, boundary }
  }

  private defaults(axis: Axis): number[] {
    const info = this.info
    if (!info) return []
    return defaultSplit(info.cols, info.rows, info.variant)[axis]
  }

  private emit(axis: Axis, sizes: number[]): void {
    this.live = { axis, sizes }
    this.onChange(axis, sizes)
  }

  private totalOf(axis: Axis): number {
    const info = this.info
    if (!info) return 0
    const style = getComputedStyle(info.grid)
    return pixels(axis === 'cols' ? style.gridTemplateColumns : style.gridTemplateRows).reduce((sum, value) => sum + value, 0)
  }

  private begin(event: PointerEvent, axis: Axis, boundary: number, el: HTMLElement): void {
    const info = this.info
    if (!info || event.button !== 0) return
    event.preventDefault()
    el.setPointerCapture(event.pointerId)
    el.classList.add('dragging')
    this.dragging = {
      axis,
      boundary,
      start: axis === 'cols' ? event.clientX : event.clientY,
      sizes: [...info.sizes[axis]],
      total: this.totalOf(axis)
    }
  }

  private move(event: PointerEvent): void {
    const drag = this.dragging
    if (!drag) return
    const delta = (drag.axis === 'cols' ? event.clientX : event.clientY) - drag.start
    const min = drag.axis === 'cols' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
    this.emit(drag.axis, applyDelta(drag.sizes, drag.boundary, delta, drag.total, min))
  }

  private end(event: PointerEvent, el: HTMLElement): void {
    if (!this.dragging) return
    this.dragging = null
    el.classList.remove('dragging')
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  }

  private key(event: KeyboardEvent, axis: Axis, boundary: number): void {
    const info = this.info
    if (!info) return
    const keys = axis === 'cols' ? { less: 'ArrowLeft', more: 'ArrowRight' } : { less: 'ArrowUp', more: 'ArrowDown' }
    if (event.key !== keys.less && event.key !== keys.more) return
    event.preventDefault()
    event.stopPropagation()
    const step = (event.key === keys.more ? 1 : -1) * SPLIT_STEP * (event.shiftKey ? 4 : 1)
    const min = axis === 'cols' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
    const current = this.live?.axis === axis ? this.live.sizes : info.sizes[axis]
    this.emit(axis, applyDelta(current, boundary, step, this.totalOf(axis), min))
  }
}
