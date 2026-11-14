import type { DesktopSettings, LoginItemState } from '../../shared/desktopSettings'
import type { Settings } from '../../shared/types'
import { saveSettings } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import { store } from '../state'

type Row = (title: string, control: HTMLElement | null, ...notes: (HTMLElement | null)[]) => HTMLElement
type Toggle = (id: string, label: string, checked: boolean, disabled: boolean, change: (value: boolean) => void) => HTMLElement

/** OS sign-in state is refreshed on entry and focus, never inferred from a saved switch. */
export class DesktopSettingsControls {
  revision = 0
  private login: LoginItemState | null = null
  private busy = false
  private error = ''
  private checking = false

  constructor(private readonly refresh: () => void) {
    void this.reload()
    window.addEventListener('focus', () => { void this.reload() })
  }

  async reload(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try { this.login = await api.getLoginItem(); this.error = '' }
    catch { this.error = 'Could not read the sign-in setting.' }
    finally { this.checking = false; this.changed() }
  }

  private changed(): void { this.revision++; this.refresh() }

  private restoreFocus(id: string | undefined): void {
    if (id && document.activeElement === document.body) document.getElementById(id)?.focus()
  }

  private async setDesktop(change: Partial<DesktopSettings>): Promise<void> {
    const focusedId = document.activeElement?.id
    this.busy = true
    this.changed()
    const desktop = { ...store.state.settings.desktop, ...change }
    store.set(s => ({ ...s, settings: { ...s.settings, desktop } }))
    await saveSettings({ desktop })
    // saveSettings reports a failed save; read back so the control cannot keep showing an unsaved choice.
    try {
      const result = await api.getSettings()
      store.set(s => ({ ...s, settings: { ...s.settings, desktop: result.settings.desktop } }))
    } catch { this.error = 'Could not read the window setting.' }
    finally { this.busy = false; await this.reload(); this.changed(); this.restoreFocus(focusedId) }
  }

  private async setEnabled(enabled: boolean): Promise<void> {
    const focusedId = document.activeElement?.id
    this.busy = true
    this.error = ''
    this.changed()
    try { this.login = await api.setLoginItem(enabled) }
    catch { this.error = 'Could not change the sign-in setting.' }
    finally { this.busy = false; this.changed(); this.restoreFocus(focusedId) }
  }

  rows(settings: Settings, row: Row, toggle: Toggle): HTMLElement[] {
    const platform = this.login?.platform ?? (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : navigator.platform.toLowerCase().includes('win') ? 'win32' : 'linux')
    const rows: HTMLElement[] = []
    {
      // The same two-way switch as the other Settings choices, not a native dropdown.
      const choices: Array<['quit' | 'tray', string]> = [['quit', 'Quit Dawsha'], ...(this.login?.trayAvailable === false ? [] : [['tray', 'Keep in tray'] as ['tray', string]])]
      const current = settings.desktop.closeBehavior
      const choice = h('div', { class: 'segmented desktop-close-choice', id: 'desktop-close-behavior', role: 'group', 'aria-label': 'When I close the window' },
        ...choices.map(([value, label]) => h('button', {
          class: 'tab', type: 'button', id: `desktop-close-${value}`, 'data-value': value, 'aria-pressed': String(value === current), disabled: this.busy,
          onClick: () => { if (value !== current) void this.setDesktop({ closeBehavior: value }) }
        }, label)))
      rows.push(row('When I close the window', choice, h('p', { class: 'hint' }, current === 'tray' ? 'Agents keep running. Show Dawsha from the tray icon to come back.' : 'Closing the window quits Dawsha and its sessions.')))
    }
    if (platform === 'linux') return rows
    const disabled = !this.login?.packaged || this.busy
    rows.push(row('Start Dawsha when you sign in', toggle('desktop-login-toggle', 'Start Dawsha when you sign in', this.login?.enabled ?? false, disabled, value => { void this.setEnabled(value) }),
      h('p', { class: 'hint' }, this.login?.packaged ? 'Start Dawsha when you sign in.' : 'Available in the installed app.'),
      this.error ? h('p', { class: 'note error', role: 'alert' }, this.error) : null))
    if (settings.desktop.closeBehavior === 'tray') {
      rows.push(row('Start hidden in the tray', toggle('desktop-hidden-toggle', 'Start hidden in the tray', settings.desktop.startHidden, disabled || !this.login?.enabled, value => { void this.setDesktop({ startHidden: value }) }), h('p', { class: 'hint' }, 'Keep the main window out of the way when Dawsha starts at sign-in.')))
    }
    return rows
  }
}
