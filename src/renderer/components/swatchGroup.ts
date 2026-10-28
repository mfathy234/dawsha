import { highlightTint, type HighlightColor } from '../../shared/highlights'
import { swatchTarget } from '../../shared/swatchKeys'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import './swatchGroup.css'

export interface SwatchOption {
  value: HighlightColor
  label: string
}

interface SwatchGroupOptions {
  id: string
  label: string
  options: readonly SwatchOption[]
  value: HighlightColor
  disabled?: boolean
  onChange(value: HighlightColor): void
}

/** A radio group of colour swatches: one tab stop, arrow keys move and select, the chosen one carries a ring and a check. */
export function swatchGroup(options: SwatchGroupOptions): HTMLElement {
  const group = h('div', { class: 'swatch-group', id: options.id, role: 'radiogroup', 'aria-label': options.label, 'data-hl-field': '' })
  let current = options.value
  const buttons = options.options.map((option, index) => {
    const button = h(
      'button',
      { class: 'swatch', type: 'button', role: 'radio', 'aria-label': option.label, title: option.label, 'data-color': option.value, disabled: options.disabled === true },
      h('span', { class: 'swatch-fill', 'aria-hidden': 'true' }, icon(ICONS.check))
    )
    button.style.setProperty('--swatch', highlightTint(option.value))
    button.addEventListener('click', () => choose(index, false))
    return button
  })

  function paint(): void {
    buttons.forEach((button, index) => {
      const selected = options.options[index].value === current
      button.setAttribute('aria-checked', String(selected))
      button.tabIndex = selected ? 0 : -1
    })
  }

  function choose(index: number, focus: boolean): void {
    current = options.options[index].value
    paint()
    if (focus) buttons[index].focus()
    options.onChange(current)
  }

  group.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const rtl = getComputedStyle(group).direction === 'rtl'
    const next = swatchTarget(buttons.length, at, event.key, rtl)
    if (next === null) return
    event.preventDefault()
    choose(next, true)
  })

  group.append(...buttons)
  paint()
  return group
}
