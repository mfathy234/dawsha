import { setImage, setTheme, toggleThemePicker } from '../actions'
import { api } from '../api'
import { THEMES, findTheme, hasLightTerminal } from '../../shared/themes'
import { h } from '../dom'
import type { AppState } from '../state'
import { popupDismissButton } from './popupDismiss'

const LIGHT_NOTE =
  "Claude Code's own colours follow its /theme setting: run /theme and pick light for best contrast."

export class ThemePickerComponent {
  private root: HTMLElement | null = null
  private signature = ''

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    if (state.themePickerOpen && !this.root) this.open()
    if (!state.themePickerOpen && this.root) this.close()
    if (this.root) this.render(state)
  }

  private open(): void {
    const rect = this.anchor().getBoundingClientRect()
    this.root = h('div', {
      class: 'popover theme-picker',
      role: 'dialog',
      'aria-label': 'Theme',
      style: `right:${Math.round(window.innerWidth - rect.right)}px;top:${Math.round(rect.bottom + 2)}px`
    })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        toggleThemePicker(false)
      }
    })
    document.body.appendChild(this.root)
    document.addEventListener('pointerdown', this.outside, true)
    this.signature = ''
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if ((target as HTMLElement).closest?.('.overlay')) return
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) toggleThemePicker(false)
  }

  private close(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.root?.remove()
    this.root = null
    this.anchor().focus()
  }

  private render(state: AppState): void {
    const { theme } = state.settings
    const signature = JSON.stringify([theme.id, theme.image.path, theme.image.enabled])
    if (signature === this.signature || !this.root) return
    this.signature = signature
    const active = findTheme(theme.id)
    const focusedId = (document.activeElement as HTMLElement | null)?.id
    const children: (HTMLElement | null)[] = [
      h('div', { class: 'popup-head' }, h('h2', { class: 'popover-title' }, 'Theme'), popupDismissButton(() => toggleThemePicker(false))),
      h('div', { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Theme' }, ...THEMES.map((t) => this.row(t.id, theme.id))),
      hasLightTerminal(active) ? h('p', { class: 'note', id: 'light-note' }, LIGHT_NOTE) : null,
      this.imageSection(state)
    ]
    this.root.replaceChildren(...children.filter((c): c is HTMLElement => c !== null))
    if (focusedId) document.getElementById(focusedId)?.focus()
    else this.root.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }

  private row(id: string, selectedId: string): HTMLElement {
    const theme = findTheme(id)
    const swatch = (color: string): HTMLElement => h('span', { class: 'swatch', style: `background:${color}` })
    const checked = id === selectedId
    return h(
      'button',
      {
        class: `theme-row${checked ? ' selected' : ''}`,
        id: `theme-${id}`,
        type: 'button',
        role: 'radio',
        'aria-checked': String(checked),
        onClick: () => setTheme(id)
      },
      h('span', { class: 'swatches' }, swatch(theme.app.background), swatch(theme.app.surface), swatch(theme.app.text), swatch(theme.app.accent)),
      h('span', { class: 'theme-name' }, theme.name),
      h('span', { class: 'theme-kind' }, theme.kind)
    )
  }

  private imageSection(state: AppState): HTMLElement {
    const image = state.settings.theme.image
    const fileName = image.path ? (image.path.split(/[\\/]/).pop() ?? image.path) : 'No image chosen'
    const toggle = h('input', { type: 'checkbox', id: 'image-enabled', disabled: image.path === null })
    toggle.checked = image.enabled
    toggle.addEventListener('change', () => setImage({ enabled: toggle.checked }))
    return h(
      'div',
      { class: 'image-section' },
      h('h3', { class: 'popover-subtitle' }, 'Background image'),
      h('label', { class: 'check', for: 'image-enabled' }, toggle, 'Show image behind terminals'),
      h(
        'div',
        { class: 'image-file' },
        h('span', { class: 'image-name', title: image.path ?? '' }, fileName),
        h('button', { class: 'btn ghost small', type: 'button', id: 'image-choose', onClick: () => void this.choose() }, 'Choose…'),
        image.path ? h('button', { class: 'btn ghost small', type: 'button', onClick: () => setImage({ path: null, enabled: false }) }, 'Remove') : null
      ),
      this.slider('Dim', 'image-dim', 0, 90, 1, image.dim, '%', (value) => setImage({ dim: value })),
      this.slider('Blur', 'image-blur', 0, 20, 1, image.blur, 'px', (value) => setImage({ blur: value }))
    )
  }

  private slider(
    label: string,
    id: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string,
    onInput: (value: number) => void
  ): HTMLElement {
    const output = h('output', { for: id }, `${value}${unit}`)
    const input = h('input', { type: 'range', id, min, max, step, value })
    input.addEventListener('input', () => {
      output.textContent = `${input.value}${unit}`
      onInput(Number(input.value))
    })
    return h('div', { class: 'slider' }, h('label', { for: id }, label), input, output)
  }

  private async choose(): Promise<void> {
    const path = await api.pickImage()
    if (path) setImage({ path, enabled: true })
  }
}
