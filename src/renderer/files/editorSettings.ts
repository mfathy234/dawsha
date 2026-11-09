import { EDITOR_FONT_MAX, EDITOR_FONT_MIN, type EditorPrefs } from '../../shared/filesLayout'
import { h, icon, iconButton } from '../dom'
import { ICONS } from '../icons'

export interface EditorSettingsHooks {
  prefs(): EditorPrefs
  /** The new look; the caller stores it and applies it to every open editor. */
  change(next: EditorPrefs): void
}

/** The gear in the editor's corner and the small popover it opens: font size and word wrap. */
export class EditorSettings {
  readonly el = h('div', { class: 'files-editor-tools', hidden: true })
  private readonly gear = h('button', { class: 'icon-btn small', type: 'button', id: 'files-editor-settings', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'files-editor-popover', title: 'Editor settings', 'aria-label': 'Editor settings', onClick: () => this.toggle() }, icon(ICONS.settings))
  private readonly size = h('span', { class: 'editor-size', id: 'files-editor-size', 'aria-live': 'polite' })
  private readonly smaller = iconButton('Smaller text', ICONS.minus, () => this.step(-1), 'small')
  private readonly larger = iconButton('Larger text', ICONS.plus, () => this.step(1), 'small')
  private readonly wrap = h('button', { class: 'toggle', type: 'button', id: 'files-editor-wrap', role: 'switch', 'aria-label': 'Word wrap', onClick: () => this.toggleWrap() })
  private readonly popover = h('div', { class: 'popover editor-popover', id: 'files-editor-popover', role: 'dialog', 'aria-label': 'Editor settings' },
    h('div', { class: 'editor-row' }, h('span', { class: 'editor-label' }, 'Font size'), h('span', { class: 'editor-stepper' }, this.smaller, this.size, this.larger)),
    h('div', { class: 'editor-row' }, h('span', { class: 'editor-label' }, 'Word wrap'), this.wrap)
  )

  constructor(private readonly hooks: EditorSettingsHooks) {
    // The popover joins the page only while open, so a closed one never counts as an open dialog.
    this.el.append(this.gear)
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.popover.isConnected) return
      event.stopPropagation()
      this.close()
      this.gear.focus()
    })
    document.addEventListener('pointerdown', (event) => {
      if (this.popover.isConnected && !this.el.contains(event.target as Node)) this.close()
    }, true)
    this.render()
  }

  /** The gear only shows while a file is open in the editor. */
  setVisible(visible: boolean): void {
    this.el.hidden = !visible
    if (!visible) this.close()
  }

  private toggle(): void {
    if (this.popover.isConnected) return this.close()
    this.render()
    this.el.append(this.popover)
    this.gear.setAttribute('aria-expanded', 'true')
  }

  private close(): void {
    this.popover.remove()
    this.gear.setAttribute('aria-expanded', 'false')
  }

  private step(direction: 1 | -1): void {
    const prefs = this.hooks.prefs()
    this.hooks.change({ ...prefs, fontSize: prefs.fontSize + direction })
    this.render()
  }

  private toggleWrap(): void {
    const prefs = this.hooks.prefs()
    this.hooks.change({ ...prefs, wrap: !prefs.wrap })
    this.render()
  }

  private render(): void {
    const prefs = this.hooks.prefs()
    this.size.textContent = String(prefs.fontSize)
    this.smaller.disabled = prefs.fontSize <= EDITOR_FONT_MIN
    this.larger.disabled = prefs.fontSize >= EDITOR_FONT_MAX
    this.wrap.setAttribute('aria-checked', String(prefs.wrap))
  }
}
