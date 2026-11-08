import './tour.css'
import { TOUR_STEPS, TOUR_TEXT } from '../../shared/tourSteps'
import { nextTourStep, placeTourCard, previousTourStep } from '../../shared/tourLogic'
import { h } from '../dom'

let activeTour: GuidedTour | null = null

export function startTour(): void {
  activeTour?.close()
  activeTour = new GuidedTour(() => { activeTour = null })
}

class GuidedTour {
  private index = 0
  private root: HTMLElement
  private card: HTMLElement
  private spotlight: HTMLElement
  private target: HTMLElement | null = null
  private readonly oldFocus = document.activeElement as HTMLElement | null

  constructor(private readonly onClose: () => void) {
    this.spotlight = h('div', { class: 'tour-spotlight', 'aria-hidden': 'true' })
    this.card = h('section', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': TOUR_TEXT.dialog, tabindex: '-1' })
    this.root = h('div', { class: 'tour-scrim' }, this.spotlight, this.card)
    document.body.append(this.root)
    document.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.onResize)
    this.show(0)
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('resize', this.onResize)
    this.target?.classList.remove('tour-target')
    this.root.remove()
    this.oldFocus?.focus()
    this.onClose()
  }

  private readonly onResize = (): void => this.position()

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return }
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return
    if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); this.move(1); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.move(-1); return }
    if (event.key === 'Tab') { event.preventDefault(); this.card.focus() }
  }

  private move(direction: 1 | -1): void {
    const visible = TOUR_STEPS.map((step) => this.findVisible(step.target) !== null)
    const next = direction > 0 ? nextTourStep(this.index, visible) : previousTourStep(this.index, visible)
    if (next < 0) { if (direction > 0) this.close(); return }
    this.show(next)
  }

  private findVisible(selector: string): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.hidden || el.closest('[hidden]')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) return el
    }
    return null
  }

  private show(index: number): void {
    this.target?.classList.remove('tour-target')
    this.index = index
    const step = TOUR_STEPS[index]
    const target = this.findVisible(step.target)
    if (!target) { this.move(1); return }
    this.target = target
    target.classList.add('tour-target')
    const progress = h('div', { class: 'tour-progress', 'aria-label': TOUR_TEXT.stepOf(index + 1, TOUR_STEPS.length) },
      ...TOUR_STEPS.map((_, i) => h('span', { class: i < index ? 'done' : i === index ? 'current' : '' })))
    const actions = h('footer', { class: 'tour-actions' },
      h('button', { class: 'btn ghost small tour-skip', type: 'button', onClick: () => this.close() }, TOUR_TEXT.skip),
      index > 0 ? h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.move(-1) }, TOUR_TEXT.back) : null,
      h('button', { class: 'btn primary small', type: 'button', onClick: () => index === TOUR_STEPS.length - 1 ? this.close() : this.move(1) }, index === TOUR_STEPS.length - 1 ? TOUR_TEXT.done : TOUR_TEXT.next)
    )
    this.card.replaceChildren(progress, h('p', { class: 'tour-step-count' }, TOUR_TEXT.stepOf(index + 1, TOUR_STEPS.length)), h('h2', {}, step.title), h('p', {}, step.body), actions)
    this.card.focus()
    this.position()
  }

  private position(): void {
    if (!this.target?.isConnected) return
    const rect = this.target.getBoundingClientRect()
    const padding = 6
    this.spotlight.style.left = `${rect.left - padding}px`
    this.spotlight.style.top = `${rect.top - padding}px`
    this.spotlight.style.width = `${rect.width + padding * 2}px`
    this.spotlight.style.height = `${rect.height + padding * 2}px`
    const placed = placeTourCard({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, { width: this.card.offsetWidth, height: this.card.offsetHeight }, { width: innerWidth, height: innerHeight })
    this.card.style.left = `${placed.x}px`
    this.card.style.top = `${placed.y}px`
  }
}
