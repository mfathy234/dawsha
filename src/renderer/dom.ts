import { placeMenu } from '../shared/menuPlacement'

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, '').toLowerCase(), value)
    else if (key === 'class') element.className = String(value)
    else if (value === true) element.setAttribute(key, '')
    else element.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return element
}

/** Removes a popup after a short fade; the node is inert and ignored by overlay checks meanwhile. */
export function leave(element: Element | null | undefined): void {
  if (!element?.isConnected) return
  if (element.classList.contains('leaving')) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.remove()
    return
  }
  element.classList.add('leaving')
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
  element.removeAttribute('id')
  element.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  window.setTimeout(() => element.remove(), 100)
}

export function icon(svg: string): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'icon'
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.innerHTML = svg
  return wrapper
}

export function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild)
}

export const iconButton = (label: string, svg: string, onClick: () => void, extraClass = ''): HTMLButtonElement =>
  h('button', { class: `icon-btn ${extraClass}`.trim(), type: 'button', 'aria-label': label, title: label, onClick }, icon(svg))

export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

export function placeNearAnchor(menu: HTMLElement, anchor: Element | null, gap = 4): void {
  if (!anchor) return
  const a = anchor.getBoundingClientRect()
  menu.classList.add('floating')
  menu.style.maxHeight = ''
  const m = menu.getBoundingClientRect()
  const placed = placeMenu(a, m.width, m.height, window.innerWidth, window.innerHeight, gap)
  menu.style.left = `${placed.left}px`
  menu.style.top = `${placed.top}px`
  menu.style.right = 'auto'
  menu.style.maxHeight = placed.maxHeight === null ? '' : `${placed.maxHeight}px`
  menu.style.overflowY = placed.maxHeight === null ? '' : 'auto'
}
