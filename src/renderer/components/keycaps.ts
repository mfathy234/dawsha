import { h } from '../dom'

/** One keycap per key of a shortcut like "Ctrl+Shift+F". The "+" stays in the text (hidden by CSS) so the label reads the same. */
export function keycaps(shortcut: string, className = '', glyph: (key: string) => string = (key) => key): HTMLElement {
  const keys = shortcut.split('+')
  if (keys.length > 1 && keys[keys.length - 1] === '') keys.splice(keys.length - 2, 2, '+')
  const children: HTMLElement[] = []
  keys.forEach((key, index) => {
    if (index > 0) children.push(h('span', { class: 'keycap-sep', 'aria-hidden': 'true' }, '+'))
    children.push(h('kbd', { class: 'keycap' }, glyph(key)))
  })
  return h('span', { class: `keys ${className}`.trim() }, ...children)
}
