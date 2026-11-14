export const SPIN_MS = 900

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function duration(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function easing(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** A negative delay that keeps every spinner on the same turn, so redrawing one never makes it jump. */
export const spinPhase = (): string => `${-(Date.now() % SPIN_MS)}ms`

export function spinner(): HTMLElement {
  const element = document.createElement('span')
  element.className = 'mini-spin'
  element.setAttribute('aria-hidden', 'true')
  element.style.setProperty('--phase', spinPhase())
  return element
}

const OUT = (): string => easing('--ease-out', 'ease-out')

/** A card that appears fades and rises a little. */
export function enter(element: HTMLElement): void {
  if (reducedMotion()) return
  element.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: duration('--dur-3', 220), easing: OUT() })
}

/** The list and a session's detail slide past each other. */
export function slide(element: HTMLElement, from: 'start' | 'end'): void {
  if (reducedMotion()) return
  const x = from === 'end' ? 24 : -24
  element.animate([{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }], { duration: duration('--dur-3', 220), easing: OUT() })
}

/** A card that leaves fades out where it was, then goes. */
export function leave(element: HTMLElement): void {
  if (reducedMotion()) { element.remove(); return }
  const fade = element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }], { duration: duration('--dur-2', 160), easing: OUT(), fill: 'forwards' })
  fade.addEventListener('finish', () => element.remove())
  fade.addEventListener('cancel', () => element.remove())
}

/** Cards that moved slide from where they were to where they are (first, last, invert, play). */
export function flip(cards: ReadonlyMap<string, HTMLElement>, before: ReadonlyMap<string, number>): void {
  if (reducedMotion()) return
  for (const [id, element] of cards) {
    const was = before.get(id)
    if (was === undefined) continue
    const delta = was - element.getBoundingClientRect().top
    if (Math.abs(delta) < 1) continue
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: duration('--dur-4', 320), easing: OUT() })
  }
}

/** One soft ring that fades once, to say a session started waiting for you. */
export function glow(element: HTMLElement): void {
  if (reducedMotion()) return
  element.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 900, easing: OUT() })
}
