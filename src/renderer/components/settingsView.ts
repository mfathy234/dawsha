import {
  disableBridge,
  enableBridge,
  openDataFolder,
  openOnboarding,
  openUpdateLink,
  openWhatsNew,
  resetHighlightRules,
  runUpdateAction,
  setAutoUpdateCheck,
  setFullAccess,
  setHighlights,
  setPaletteShortcut,
  setSessionInfo,
  setSidebarCollapsed,
  showSettingsSection,
  showView
} from '../actions'
import { AGENTS, AGENT_NAMES, FULL_ACCESS_FLAGS } from '../../shared/agents'
import { pairingLink } from '../../shared/remotePairing'
import { qrSvg } from '../qr'
import {
  HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_RULES,
  defaultHighlightRules,
  highlightTint,
  sameRules,
  validateRule,
  type HighlightColor,
  type HighlightRule,
  type HighlightSettings
} from '../../shared/highlights'
import { compareVersions } from '../../shared/version'
import { entriesUpTo } from '../../shared/changelog'
import { DEFAULT_PALETTE_SHORTCUT } from '../../shared/settingsSchema'
import { isRemoteControlBuild } from '../../shared/remoteBuild'
import type { RemoteAccessSettings, RemoteAccessState } from '../../shared/types'
import { formatShortcut, parseShortcut } from '../../shared/shortcuts'
import { updateStatusLine } from '../../shared/updates'
import { releaseTagUrl } from '../../shared/markdown'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { api } from '../api'
import type { PaneonImportPreview } from '../../shared/paneonImport'
import { confirmDialog } from './dialogs'
import { toast } from './toast'
import { CHANGELOG_ENTRIES } from '../changelog'
import { store, type AppState, type SettingsSection } from '../state'
import { entryBlock } from './whatsNew'
import { invalidateRecordingStats, recordingRows } from './recordingSettings'
import { dictationRows } from './dictationSettings'
import { exportSettingsFromUi, importSettingsFromUi } from '../settingsTransferActions'
import { orchestratorSettingsRows } from './orch/orchSettings'

const SECTIONS: { id: SettingsSection; label: string; lede: string }[] = [
  { id: 'general', label: 'General', lede: 'Keyboard shortcut, sidebar, recordings and setup.' },
  { id: 'notifications', label: 'Notifications & session info', lede: 'What Dawsha shows and tells you while sessions run.' },
  { id: 'agents', label: 'Agents', lede: 'How new sessions start for each agent.' },
  { id: 'updates', label: 'Updates', lede: 'Keep Dawsha current.' },
  { id: 'highlights', label: 'Highlights', lede: 'Tint terminal lines that contain the words you care about.' },
  { id: 'orchestrator', label: 'Orchestrator', lede: 'Plans, agent profiles, effort and prices for the orchestrator.' },
  { id: 'changelog', label: 'Changelog', lede: 'Every released version, newest first.' },
  { id: 'about', label: 'About', lede: 'Version, links and where your data lives.' }
]
if (isRemoteControlBuild) SECTIONS.push({ id: 'remote', label: 'Remote Access', lede: 'Reach this Dawsha installation from your own devices.' })

const visibleSections = (_state: AppState): typeof SECTIONS => SECTIONS

const REPO_URL = 'https://github.com/mfathy234/dawsha'
const LINKS = [
  { id: 'settings-link-repo', label: 'GitHub repository', url: REPO_URL },
  { id: 'settings-link-releases', label: 'Releases', url: `${REPO_URL}/releases` },
  { id: 'settings-link-license', label: 'License (MIT)', url: `${REPO_URL}/blob/main/LICENSE` }
]

function row(title: string, control: HTMLElement | null, ...notes: (HTMLElement | null)[]): HTMLElement {
  return h(
    'div',
    { class: 'set-row' },
    h('div', { class: 'set-main' }, h('div', { class: 'set-name' }, title), ...notes),
    control ? h('div', { class: 'set-control' }, control) : null
  )
}

function checkbox(id: string, label: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, disabled })
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'check', for: id }, input, label)
}

interface RuleDraft {
  pattern: string
  regex: boolean
  color: HighlightColor
}

const emptyDraft = (): RuleDraft => ({ pattern: '', regex: false, color: 'red' })

const COLOR_LABELS: Record<HighlightColor, string> = { red: 'Red', amber: 'Amber', green: 'Green', blue: 'Blue', purple: 'Purple' }

export class SettingsViewComponent {
  readonly el = h('main', { class: 'settings-view', 'aria-label': 'Settings' })
  private readonly nav = h('div', { class: 'settings-nav', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Settings sections' })
  private readonly panel = h('div', { class: 'settings-panel', role: 'tabpanel' })
  private readonly title = h('h2', { class: 'settings-section-title' })
  private readonly lede = h('p', { class: 'lede' })
  private signature = ''
  private navSection: string | null = null
  private shortcutDraft: string | null = null
  private shortcutError: string | null = null
  private addDraft: RuleDraft = emptyDraft()
  private addError: string | null = null
  private editIndex: number | null = null
  private editDraft: RuleDraft = emptyDraft()
  private editError: string | null = null
  private paneonImport: PaneonImportPreview | null = null
  private remoteAccess: RemoteAccessState | null = null
  private remoteError: string | null = null
  private remoteBusy = false
  private remotePollTimer: ReturnType<typeof setTimeout> | null = null
  private pairingExpiryTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    void api.paneonImportPreview().then((preview) => { this.paneonImport = preview; this.refresh() }).catch(() => undefined)
    if (isRemoteControlBuild) void this.loadRemoteAccess()
    this.nav.addEventListener('keydown', (event) => this.onNavKey(event))
    this.panel.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link]')
      if (!link) return
      event.preventDefault()
      openUpdateLink(link.href)
    })
    this.el.append(
      h('div', { class: 'settings-head' }, h('h1', {}, 'Settings'), h('p', { class: 'lede' }, 'Preferences for Dawsha. Theme and background image stay in the Theme menu.')),
      h('div', { class: 'settings-body' }, this.nav, h('div', { class: 'settings-content' }, this.title, this.lede, this.panel))
    )
  }

  update(state: AppState, force = false): void {
    if (!force && this.editingField()) return
    const signature = JSON.stringify([
      state.settingsSection,
      state.settings.paletteShortcut,
      state.settings.sidebarCollapsed,
      state.settings.fullAccess,
      state.settings.sessionInfo,
      state.settings.autoUpdateCheck,
      state.settings.highlights,
      state.settings.recordings,
      state.settings.orchestrator,
      this.remoteAccess,
      this.remoteError,
      this.remoteBusy,
      this.addError,
      this.editIndex,
      this.editError,
      state.bridge,
      state.update,
      state.info.version,
      state.info.userData,
      this.shortcutError,
      Math.floor(Date.now() / 60_000)
    ])
    if (signature === this.signature) return
    this.signature = signature
    this.render(state)
  }

  show(): void {
    invalidateRecordingStats()
    this.refresh()
  }

  private refresh(): void {
    this.signature = ''
    this.update(store.state, true)
  }

  private editingField(): boolean {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !this.el.contains(active)) return false
    return active.id === 'palette-shortcut' || active.hasAttribute('data-hl-field')
  }

  private render(state: AppState): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.id
    const sections = visibleSections(state)
    const section = sections.find((s) => s.id === state.settingsSection) ?? sections[0]
    const navKey = `${section.id}|${sections.length}`
    if (this.navSection !== navKey) {
      this.navSection = navKey
      this.nav.replaceChildren(...sections.map((s) => this.tab(s, s.id === section.id)))
    }
    this.title.replaceChildren(section.label)
    if (section.id === 'remote') {
      this.title.append(h('span', { id: 'remote-settings-beta', class: 'beta-badge' }, 'BETA'))
    }
    this.lede.textContent = section.lede
    this.panel.setAttribute('aria-labelledby', `settings-tab-${section.id}`)
    this.panel.replaceChildren(...this.body(section.id, state))
    if (focusedId && this.el.contains(document.activeElement) === false) document.getElementById(focusedId)?.focus()
  }

  private tab(section: (typeof SECTIONS)[number], selected: boolean): HTMLElement {
    return h(
      'button',
      {
        class: `settings-tab${selected ? ' selected' : ''}`,
        type: 'button',
        role: 'tab',
        id: `settings-tab-${section.id}`,
        'aria-selected': String(selected),
        tabindex: selected ? 0 : -1,
        onClick: () => showSettingsSection(section.id)
      },
      section.label
    )
  }

  private onNavKey(event: KeyboardEvent): void {
    const sections = visibleSections(store.state)
    const index = sections.findIndex((s) => s.id === store.state.settingsSection)
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + step + sections.length) % sections.length
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    showSettingsSection(sections[target].id)
    requestAnimationFrame(() => document.getElementById(`settings-tab-${sections[target].id}`)?.focus())
  }

  private body(section: SettingsSection, state: AppState): HTMLElement[] {
    switch (section) {
      case 'general':
        return this.general(state)
      case 'notifications':
        return this.notifications(state)
      case 'agents':
        return this.agents(state)
      case 'updates':
        return this.updates(state)
      case 'highlights':
        return this.highlights(state)
      case 'remote':
        return this.remoteAccessBody()
      case 'orchestrator':
        return orchestratorSettingsRows(state, () => this.refresh())
      case 'changelog':
        return this.changelog(state)
      default:
        return this.about(state)
    }
  }

  private async loadRemoteAccess(): Promise<void> {
    const remote = api.remoteAccess
    if (!remote) return
    try {
      this.remoteAccess = await remote.getState()
      this.remoteError = null
    } catch (error) {
      this.remoteError = (error as Error).message || 'Remote Access status could not be loaded.'
      if (this.remoteAccess?.pairing && this.remoteAccess.pairing.expiresAt <= Date.now()) {
        this.remoteAccess = { ...this.remoteAccess, pairing: null }
      }
    }
    this.refresh()
  }

  private async runRemoteAction(action: () => Promise<RemoteAccessState>): Promise<void> {
    this.remoteBusy = true
    this.remoteError = null
    this.refresh()
    try { this.remoteAccess = await action() } catch (error) {
      this.remoteError = (error as Error).message || 'Remote Access could not be changed.'
    } finally {
      this.remoteBusy = false
      this.refresh()
    }
  }

  private remoteAccessBody(): HTMLElement[] {
    const remote = api.remoteAccess
    const state = this.remoteAccess
    if (!remote) return []
    if (this.pairingExpiryTimer) clearTimeout(this.pairingExpiryTimer)
    this.pairingExpiryTimer = state?.enabled && state.pairing && state.pairing.expiresAt > Date.now()
      ? setTimeout(() => {
          this.pairingExpiryTimer = null
          void this.loadRemoteAccess()
        }, Math.max(0, state.pairing.expiresAt - Date.now()) + 50)
      : null
    const status = state?.status ?? 'off'
    const enabled = state?.enabled === true
    if (this.remotePollTimer) clearTimeout(this.remotePollTimer)
    this.remotePollTimer = status === 'connecting'
      ? setTimeout(() => { this.remotePollTimer = null; void this.loadRemoteAccess() }, 2000)
      : null
    const mainAction = h('button', {
      class: enabled ? 'btn ghost small' : 'btn primary small',
      type: 'button',
      id: 'remote-access-toggle',
      disabled: this.remoteBusy,
      onClick: () => void this.runRemoteAction(() => enabled ? remote.disable() : remote.enable())
    }, this.remoteBusy ? (enabled ? 'Working…' : 'Preparing tunnel…') : enabled ? 'Stop Remote Access' : (status === 'setup-required' || this.remoteError) ? 'Try again' : 'Start Remote Access')
    const securityNote = h('p', { class: 'hint remote-hero-note' }, state?.permissions.allowedEmail
      ? 'Cloudflare will send a PIN to this email before Dawsha asks for its pairing code. Cloudflare processes traffic through the public-facing URL.'
      : 'With no PIN email, the short-lived Dawsha pairing code is the only login gate. Keep the public-facing URL private; Cloudflare processes proxied traffic.')
    const statusLine = h('p', { class: `remote-status remote-status-${status}`, role: 'status' },
      h('span', { class: 'remote-status-dot', 'aria-hidden': 'true' }), state?.message ?? 'Remote Access is off.')
    const qrTarget = enabled && state.url ? pairingLink(state.url, state.pairing?.code) : ''
    const qr = enabled && state.url
      ? h('section', { class: 'remote-qr-card' },
          h('div', { class: 'remote-qr', 'data-qr': qrTarget },
            qrSvg(qrTarget, state.pairing ? 'QR code that opens Dawsha and pairs your phone' : 'QR code that opens Dawsha on your phone')),
          h('div', { class: 'remote-qr-copy' },
            h('h4', {}, 'Scan with your phone'),
            h('p', { class: 'hint' }, state.pairing
              ? 'Point your camera at the code. It opens Dawsha and pairs this phone, no typing needed.'
              : 'Point your camera at the code to open Dawsha, then create a pairing code.'),
            state.pairing ? this.pairingCountdown(state.pairing.expiresAt) : null))
      : null
    const steps = enabled && state.url
      ? h('div', { class: 'remote-steps' },
          h('section', { class: 'remote-step' },
            h('div', { class: 'remote-step-head' }, h('span', { class: 'remote-step-number' }, '1'), h('h4', {}, 'Open on your phone')),
            h('div', { class: 'remote-field' },
              h('code', { class: 'remote-url', title: state.url }, state.url),
              this.copyButton('remote-copy-url', state.url, 'URL')),
            h('p', { class: 'hint' }, 'Quick Tunnel links change each time Remote Access restarts.')),
          h('section', { class: 'remote-step' },
            h('div', { class: 'remote-step-head' }, h('span', { class: 'remote-step-number' }, '2'), h('h4', {}, 'Enter the pairing code')),
            state.pairing
              ? h('div', { class: 'remote-code-block' },
                  h('code', { class: 'remote-pairing-code', 'aria-label': `Pairing code ${state.pairing.code.split('').join(' ')}` },
                    ...state.pairing.code.split('').map((digit) => h('span', { class: 'remote-digit' }, digit))),
                  h('div', { class: 'remote-code-actions' },
                    this.copyButton('remote-copy-code', state.pairing.code, 'Pairing code', this.remoteBusy),
                    h('button', { class: 'remote-icon-btn', type: 'button', id: 'remote-refresh-code', disabled: this.remoteBusy, onClick: () => void this.runRemoteAction(() => remote.refreshPairing()) }, icon(ICONS.refresh), 'New code'),
                    this.pairingCountdown(state.pairing.expiresAt)))
              : h('div', { class: 'remote-code-block remote-code-empty' },
                  h('p', { class: 'hint' }, 'No active pairing code.'),
                  h('button', { class: 'btn primary small', type: 'button', id: 'remote-refresh-code', disabled: this.remoteBusy, onClick: () => void this.runRemoteAction(() => remote.refreshPairing()) }, 'Create code')),
            h('p', { class: 'hint' }, state.permissions.allowedEmail ? 'Enter it after the Cloudflare email PIN.' : 'Codes expire after a few minutes. Create a new one any time.')))
      : null
    const rows: HTMLElement[] = [
      h('div', { class: `remote-hero${enabled ? ' on' : ''}` },
        h('div', { class: 'remote-hero-head' },
          h('div', { class: 'remote-hero-copy' },
            h('h3', {}, enabled ? 'Connect your phone' : 'Use Dawsha from your phone'),
            statusLine),
          mainAction),
        qr || steps ? h('div', { class: 'remote-connect' }, qr, h('div', { class: 'remote-manual' }, qr ? h('p', { class: 'remote-manual-label' }, 'Or connect by hand') : null, steps)) : null,
        securityNote,
        this.remoteError ? h('p', { class: 'note error set-note', role: 'alert' }, this.remoteError) : null)
    ]
    const allowedEmail = h('input', { class: 'text-input', type: 'email', value: state?.permissions.allowedEmail ?? '', placeholder: 'you@example.com', autocomplete: 'email', disabled: this.remoteBusy || enabled }) as HTMLInputElement
    rows.push(row('Cloudflare PIN email (optional)', h('div', { class: 'remote-email-setting' }, allowedEmail,
      h('button', { class: 'btn ghost small', type: 'button', disabled: this.remoteBusy || enabled, onClick: () => void this.runRemoteAction(() => remote.setAllowedEmail(allowedEmail.value)) }, 'Save email')),
    h('p', { class: 'hint' }, 'Dawsha checks for a compatible Cloudflare Tunnel and installs a verified copy in app data if needed. First setup needs internet access; no administrator access is required.')))
    if (!state) return rows

    rows.push(row('Terminal input', checkbox('remote-terminal-input', 'Allow paired browsers to type into active terminals', state.permissions.terminalInput, this.remoteBusy, (value) => {
      void this.runRemoteAction(() => remote.setPermissions({ terminalInput: value }))
    }), h('p', { class: 'hint' }, 'This can send commands to the agent running in that terminal.')))

    rows.push(row('Start or resume sessions', checkbox('remote-session-control', 'Allow paired browsers to start or resume the configured agent', state.permissions.sessionControl, this.remoteBusy, (value) => {
      void (async () => {
        if (value && !await confirmDialog({
          title: 'Allow remote session control?',
          body: 'New and resumed agents inherit their existing Dawsha full-access setting. With full access enabled, an agent can read and change files and run commands in the project.',
          confirmLabel: 'Allow session control',
          danger: false
        })) {
          this.refresh()
          return
        }
        await this.runRemoteAction(() => remote.setPermissions({ sessionControl: value }))
      })()
    }), h('p', { class: 'hint' }, 'The browser can choose a supported agent for each configured project and resume that agent’s existing sessions.')))

    rows.push(...this.approvalRows(state))

    const devices = state.devices.length
      ? state.devices.map((device) => row(device.name,
          h('button', { class: 'btn ghost small', type: 'button', disabled: this.remoteBusy, onClick: () => void this.runRemoteAction(() => remote.revokeDevice(device.id)) }, 'Revoke'),
          h('p', { class: 'hint' }, `Paired ${new Date(device.pairedAt).toLocaleString()} · Last seen ${new Date(device.lastSeenAt).toLocaleString()}`)))
      : [h('p', { class: 'hint remote-empty' }, 'No browsers are paired.')]
    rows.push(row('Paired devices', h('div', { class: 'remote-device-list' }, ...devices),
      h('p', { class: 'hint' }, 'Revocation takes effect immediately for that browser.')))
    return rows
  }

  private approvalRows(state: RemoteAccessState): HTMLElement[] {
    const remote = api.remoteAccess
    if (!remote) return []
    const access = state.permissions
    const set = (patch: Partial<RemoteAccessSettings>) => void this.runRemoteAction(() => remote.setPermissions(patch))
    const minutes = h('input', {
      class: 'text-input remote-away-minutes',
      id: 'remote-approvals-minutes',
      type: 'number',
      min: '1',
      max: '60',
      value: String(access.approvalsAwayMinutes),
      disabled: this.remoteBusy || !access.approvals || !access.approvalsOnlyWhenAway,
      'aria-label': 'Minutes without keyboard or mouse input before notifying'
    }) as HTMLInputElement
    minutes.addEventListener('change', () => set({ approvalsAwayMinutes: Number(minutes.value) }))
    return [
      h('div', { class: 'remote-approvals-head' },
        h('h4', {}, 'Approvals from your phone'),
        h('p', { class: 'hint' }, 'Answer permission prompts from a paired phone. Your agents keep running on this computer.')),
      row('Phone approvals', checkbox('remote-approvals', 'Let paired phones answer permission prompts', access.approvals, this.remoteBusy, (value) => {
        void (async () => {
          if (value && !await confirmDialog({
            title: 'Let paired phones answer permission prompts?',
            body: 'A paired phone will be able to allow or deny the command or edit an agent is waiting on, from anywhere the phone can reach Dawsha. Allowing a prompt lets the agent run it on this computer.',
            confirmLabel: 'Allow phone approvals',
            danger: false
          })) {
            this.refresh()
            return
          }
          set({ approvals: value })
        })()
      }),
        h('p', { class: 'hint' }, 'A permission separate from terminal input and session control. It lets a phone allow or deny the prompt an agent is waiting on, nothing else.')),
      row('Notifications', checkbox('remote-approvals-notify', 'Notify the phone when a session needs you', access.approvalsNotify, this.remoteBusy || !access.approvals, (value) => set({ approvalsNotify: value })),
        h('p', { class: 'hint' }, 'Uses browser notifications on the phone while its page is open in the background. Allow and Deny buttons show where the phone supports them. Alerts do not reach a closed browser.')),
      row('Only when I am away', checkbox('remote-approvals-away', 'Notify only when this computer has been idle', access.approvalsOnlyWhenAway, this.remoteBusy || !access.approvals || !access.approvalsNotify, (value) => set({ approvalsOnlyWhenAway: value })),
        h('p', { class: 'hint' }, 'Counts time with no keyboard or mouse input here. Prompts stay answerable on the phone either way.')),
      row('Idle minutes', minutes),
      row('CI and config files', checkbox('remote-approvals-config', 'Phone can allow edits to CI and config files', access.approvalsAllowConfigEdits, this.remoteBusy || !access.approvals, (value) => set({ approvalsAllowConfigEdits: value })),
        h('p', { class: 'hint' }, 'Off by default: edits outside the project, to .github, .yml, package.json, lockfiles and .env files can only be denied from the phone. Detection reads the prompt text, so it is best effort.'))
    ]
  }

  private copyButton(id: string, value: string, label: string, disabled = false): HTMLElement {
    const text = h('span', {}, 'Copy')
    const glyph = icon(ICONS.copy)
    const button = h('button', { class: 'remote-icon-btn remote-copy-btn', type: 'button', id, disabled, 'aria-label': `Copy ${label.toLowerCase()}` }, glyph, text) as HTMLButtonElement
    let reset = 0
    button.addEventListener('click', () => void (async () => {
      try {
        await api.writeClipboard(value)
        window.clearTimeout(reset)
        button.classList.add('copied')
        glyph.innerHTML = ICONS.check
        text.textContent = 'Copied'
        reset = window.setTimeout(() => {
          button.classList.remove('copied')
          glyph.innerHTML = ICONS.copy
          text.textContent = 'Copy'
        }, 1600)
      } catch {
        toast(`Could not copy ${label.toLowerCase()}.`)
      }
    })())
    return button
  }

  private pairingCountdown(expiresAt: number): HTMLElement {
    const label = h('span', { class: 'remote-expiry', title: `Expires ${new Date(expiresAt).toLocaleTimeString()}` })
    const update = (): void => {
      const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
      label.textContent = seconds > 90 ? `Expires in ${Math.ceil(seconds / 60)} min` : `Expires in ${seconds}s`
      label.classList.toggle('soon', seconds <= 60)
      // Keep ticking until the settings view re-renders and drops this label.
      if (label.isConnected) shown = true
      if (seconds > 0 && !(shown && !label.isConnected)) window.setTimeout(update, seconds > 90 ? 15_000 : 1000)
    }
    let shown = false
    update()
    return label
  }

  private general(state: AppState): HTMLElement[] {
    const draft = this.shortcutDraft ?? formatShortcut(parseShortcut(state.settings.paletteShortcut) ?? parseShortcut(DEFAULT_PALETTE_SHORTCUT)!)
    const input = h('input', {
      class: `text-input mono${this.shortcutError ? ' invalid' : ''}`,
      type: 'text',
      id: 'palette-shortcut',
      value: draft,
      'aria-label': 'Command palette shortcut',
      'aria-invalid': String(this.shortcutError !== null),
      'aria-describedby': 'palette-shortcut-error',
      spellcheck: 'false'
    })
    input.addEventListener('input', () => {
      this.shortcutDraft = input.value
      if (this.shortcutError) {
        this.shortcutError = null
        input.classList.remove('invalid')
        document.getElementById('palette-shortcut-error')?.remove()
      }
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitShortcut(input.value)
      }
    })
    input.addEventListener('blur', () => {
      if (this.shortcutDraft !== null) this.commitShortcut(input.value)
    })
    const reset = h(
      'button',
      {
        class: 'btn ghost small',
        type: 'button',
        id: 'palette-shortcut-reset',
        disabled: state.settings.paletteShortcut === DEFAULT_PALETTE_SHORTCUT && this.shortcutDraft === null,
        onMouseDown: (event: Event) => event.preventDefault(),
        onClick: () => this.resetShortcut()
      },
      'Reset'
    )
    return [
      row(
        'Command palette shortcut',
        h('div', { class: 'set-inline' }, input, reset),
        h('p', { class: 'hint' }, navigator.platform.toLowerCase().includes('mac')
          ? 'Command or Option plus a key. Command+Shift+P always works too.'
          : `Ctrl or Alt plus a key, such as ${DEFAULT_PALETTE_SHORTCUT} or Alt+Space. Ctrl+Shift+P always works too.`),
        this.shortcutError ? h('p', { class: 'field-error', id: 'palette-shortcut-error', role: 'alert' }, this.shortcutError) : null
      ),
      row('Sidebar', checkbox('sidebar-collapsed', 'Start with the sidebar collapsed', state.settings.sidebarCollapsed, false, setSidebarCollapsed)),
      row(
        'Getting started',
        h('button', { class: 'btn ghost small', type: 'button', id: 'getting-started', onClick: () => openOnboarding() }, 'Getting started…'),
        h('p', { class: 'hint' }, 'Reopen the setup guide for projects, agents and session info.')
      ),
      h('h3', { class: 'set-subhead', id: 'dictation-heading' }, 'Voice dictation'),
      ...dictationRows(state),
      h('h3', { class: 'set-subhead', id: 'recordings-heading' }, 'Recordings'),
      ...recordingRows(state, () => this.refresh()),
      h('h3', { class: 'set-subhead', id: 'transfer-heading' }, 'Back up and move'),
      row(
        'Settings file',
        h('div', { class: 'set-inline' },
          h('button', { class: 'btn ghost small', type: 'button', id: 'export-settings', onClick: () => void exportSettingsFromUi() }, 'Export settings…'),
          h('button', { class: 'btn ghost small', type: 'button', id: 'import-settings', onClick: () => void importSettingsFromUi() }, 'Import settings…')),
        h('p', { class: 'hint' }, 'Save your projects, snippets, layouts, highlight rules and preferences to one file to move Dawsha to another PC. Remote Access, open sessions and usage history are never included.')
      ),
      ...(this.paneonImport?.available ? [row(
        'Paneon settings',
        h('button', {
          class: 'btn ghost small', type: 'button', id: 'import-paneon-settings',
          disabled: this.paneonImport.pending || this.paneonImport.error !== null,
          onClick: () => void this.importPaneonSettings()
        }, 'Import Paneon settings'),
        h('p', { class: 'hint', id: 'paneon-import-summary' },
          this.paneonImport.pending
            ? 'Import queued; close and reopen Dawsha to apply it.'
            : this.paneonImport.error ?? `${this.paneonImport.projects} project${this.paneonImport.projects === 1 ? '' : 's'}, ${this.paneonImport.layouts} layout${this.paneonImport.layouts === 1 ? '' : 's'} and ${this.paneonImport.snippets} snippet${this.paneonImport.snippets === 1 ? '' : 's'} found. Your current Dawsha settings will be backed up.`
        )
      )] : [])
    ]
  }

  private async importPaneonSettings(): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Import Paneon settings?',
      body: 'This replaces Dawsha settings on the next launch. A backup of the current Dawsha settings will be saved. Paneon stays untouched; close and reopen Dawsha to apply the import.',
      confirmLabel: 'Import Paneon settings',
      danger: false
    })
    if (!confirmed) return
    try {
      await api.queuePaneonImport()
      this.paneonImport = { ...this.paneonImport!, pending: true }
      this.refresh()
      toast('Paneon import queued. Close and reopen Dawsha to apply it.', 'info')
    } catch (error) {
      toast((error as Error).message || 'Paneon settings could not be imported.')
    }
  }

  private commitShortcut(text: string): void {
    const binding = parseShortcut(text)
    if (!binding) {
      this.shortcutDraft = text
      this.shortcutError = text.trim() === '' ? 'Enter a shortcut.' : `"${text.trim()}" is not a valid shortcut. Use Ctrl or Alt plus a letter, digit, F1–F12 or a named key.`
      this.refresh()
      return
    }
    this.shortcutDraft = null
    this.shortcutError = null
    setPaletteShortcut(formatShortcut(binding))
    this.refresh()
  }

  private resetShortcut(): void {
    this.shortcutDraft = null
    this.shortcutError = null
    setPaletteShortcut(DEFAULT_PALETTE_SHORTCUT)
    this.refresh()
  }

  private notifications(state: AppState): HTMLElement[] {
    const { bridge, settings } = state
    const info = settings.sessionInfo
    const toggleBridge = (on: boolean): void => {
      void (on ? enableBridge() : disableBridge()).finally(() => this.refresh())
    }
    return [
      row(
        'Session info',
        checkbox('bridge-toggle', 'Show live session info', bridge.installed, bridge.busy, toggleBridge),
        h('p', { class: 'hint' }, 'Adds a status line to ~/.claude/settings.json after you confirm. Turning it off restores the old one.'),
        bridge.error ? h('p', { class: 'note error set-note', id: 'bridge-error', role: 'alert' }, bridge.error) : null,
        bridge.note ? h('p', { class: 'note set-note', id: 'bridge-note' }, bridge.note) : null
      ),
      row(
        'Notifications',
        h(
          'div',
          { class: 'set-stack' },
          checkbox('notify-toggle', 'Notify when a session is done or needs you', info.notifications, false, (value) =>
            setSessionInfo({ notifications: value })
          ),
          checkbox('sound-toggle', 'Play a sound with notifications', info.sound, !info.notifications, (value) => setSessionInfo({ sound: value }))
        )
      )
    ]
  }

  private agents(state: AppState): HTMLElement[] {
    const rows = AGENTS.map((agent) =>
      row(
        AGENT_NAMES[agent],
        checkbox(`settings-full-access-${agent}`, 'Start with full access', state.settings.fullAccess[agent], false, (value) => setFullAccess(agent, value)),
        h('p', { class: 'hint' }, `Runs without approval prompts (${FULL_ACCESS_FLAGS[agent]}). Applies to new sessions.`)
      )
    )
    const manage = row(
      'Installs',
      h('button', { class: 'btn ghost small', type: 'button', id: 'settings-manage-agents', onClick: () => showView('agents') }, 'Manage installs in Agents'),
      h('p', { class: 'hint' }, 'Install or update the command-line agents.')
    )
    return [...rows, manage]
  }

  private updates(state: AppState): HTMLElement[] {
    const { update, settings, info } = state
    const busy = update.status === 'checking' || update.status === 'downloading' || update.mode === 'dev'
    const controls: HTMLElement[] = []
    if (update.status === 'available') {
      controls.push(update.mode === 'portable'
        ? h('button', { class: 'btn primary small', type: 'button', id: 'settings-update-download', onClick: () => openUpdateLink(releaseTagUrl(update.version ?? '')) }, 'Download')
        : h('button', { class: 'btn primary small', type: 'button', id: 'settings-update-download', onClick: () => void runUpdateAction('download') }, 'Download and install'))
    } else if (update.status === 'ready') {
      controls.push(h('button', { class: 'btn primary small', type: 'button', id: 'settings-update-install', onClick: () => void runUpdateAction('restart') }, 'Install and restart'))
    } else if (update.status === 'error') {
      controls.push(h('button', { class: 'btn ghost small', type: 'button', id: 'settings-update-retry', onClick: () => void runUpdateAction('retry') }, 'Try again'))
    }
    if (update.status === 'downloading') controls.push(h('span', { class: 'set-value', id: 'settings-update-progress', role: 'status' }, `Downloading ${update.version ?? 'update'} · ${Math.round(update.percent)}%`))
    controls.push(h('button', { class: 'btn ghost small', type: 'button', id: 'check-now', disabled: busy, onClick: () => void runUpdateAction('check') }, update.status === 'checking' ? 'Checking…' : 'Check now'))
    const statusNotes: HTMLElement[] = [h('p', { class: 'hint', id: 'update-status' }, updateStatusLine(update, Date.now()))]
    if (update.status === 'available' && update.mode === 'portable') statusNotes.push(h('p', { class: 'hint' }, 'Portable builds must be downloaded and installed manually.'))
    if (update.status === 'ready') statusNotes.push(h('p', { class: 'hint' }, 'Your sessions reopen after the app restarts.'))
    if (update.status === 'error' && update.error) statusNotes.push(h('p', { class: 'hint', role: 'alert' }, update.error))
    return [
      row('Current version', h('span', { class: 'set-value mono', id: 'settings-version' }, info.version || 'unknown')),
      row('Automatic checks', checkbox('auto-update-toggle', 'Check for updates automatically', settings.autoUpdateCheck, false, setAutoUpdateCheck)),
      row(
        'Status',
        h('div', { class: 'set-inline update-settings-actions' }, ...controls),
        ...statusNotes
      )
    ]
  }

  private highlights(state: AppState): HTMLElement[] {
    const current = state.settings.highlights
    const rules = current.rules.map((rule, index) => (index === this.editIndex ? this.editRow() : this.ruleRow(rule, index, current)))
    const atLimit = current.rules.length >= MAX_HIGHLIGHT_RULES
    return [
      row(
        'Highlight lines',
        checkbox('highlights-toggle', 'Highlight matching lines', current.enabled, false, (enabled) =>
          setHighlights({ ...current, enabled })
        ),
        h('p', { class: 'hint' }, 'Lines are matched as they arrive, ignoring case. The first matching rule sets the color.')
      ),
      h('div', { class: 'hl-rules', id: 'highlight-rules' }, ...rules),
      ...(current.rules.length === 0 ? [h('p', { class: 'tool-empty', id: 'highlight-empty' }, 'No rules yet. Add one below or reset to the defaults.')] : []),
      this.ruleForm({
        draft: this.addDraft,
        idPrefix: 'hl-add',
        submitLabel: 'Add rule',
        error: this.addError,
        disabled: atLimit,
        onChange: () => {
          this.addError = null
          document.getElementById('hl-add-error')?.remove()
        },
        onSubmit: () => this.addRule(current)
      }),
      ...(atLimit ? [h('p', { class: 'hint' }, `At most ${MAX_HIGHLIGHT_RULES} rules.`)] : []),
      row(
        'Defaults',
        h(
          'button',
          {
            class: 'btn ghost small',
            type: 'button',
            id: 'highlights-reset',
            disabled: sameRules(current.rules, defaultHighlightRules()),
            onClick: () => {
              this.editIndex = null
              void resetHighlightRules().finally(() => this.refresh())
            }
          },
          'Reset to defaults'
        ),
        h('p', { class: 'hint' }, 'Replaces your rules with the built-in error, warning and success words.')
      )
    ]
  }

  private ruleRow(rule: HighlightRule, index: number, current: HighlightSettings): HTMLElement {
    const swatch = h('span', { class: 'hl-swatch', 'aria-hidden': 'true' })
    swatch.style.background = highlightTint(rule.color)
    return h(
      'div',
      { class: 'set-row hl-rule', 'data-rule': rule.pattern, 'data-color': rule.color },
      h(
        'div',
        { class: 'set-main' },
        h(
          'div',
          { class: 'hl-rule-name' },
          swatch,
          h('code', { class: 'hl-pattern' }, rule.pattern),
          h('span', { class: 'hint' }, `${COLOR_LABELS[rule.color]}${rule.regex === true ? ', regex' : ''}`)
        )
      ),
      h(
        'div',
        { class: 'set-control set-inline' },
        h(
          'button',
          {
            class: 'btn ghost small',
            type: 'button',
            id: `hl-edit-${index}`,
            'aria-label': `Edit rule ${rule.pattern}`,
            onClick: () => this.startEdit(rule, index)
          },
          'Edit'
        ),
        h(
          'button',
          {
            class: 'btn ghost small',
            type: 'button',
            id: `hl-remove-${index}`,
            'aria-label': `Remove rule ${rule.pattern}`,
            onClick: () => {
              this.editIndex = null
              setHighlights({ ...current, rules: current.rules.filter((_, i) => i !== index) })
              this.refresh()
            }
          },
          'Remove'
        )
      )
    )
  }

  private editRow(): HTMLElement {
    return this.ruleForm({
      draft: this.editDraft,
      idPrefix: 'hl-edit',
      submitLabel: 'Save',
      error: this.editError,
      disabled: false,
      onChange: () => {
        this.editError = null
        document.getElementById('hl-edit-error')?.remove()
      },
      onSubmit: () => this.saveEdit(store.state.settings.highlights),
      onCancel: () => {
        this.editIndex = null
        this.editError = null
        this.refresh()
      }
    })
  }

  private ruleForm(options: {
    draft: RuleDraft
    idPrefix: string
    submitLabel: string
    error: string | null
    disabled: boolean
    onChange(): void
    onSubmit(): void
    onCancel?: () => void
  }): HTMLElement {
    const { draft, idPrefix, error } = options
    const pattern = h('input', {
      class: `text-input mono${error ? ' invalid' : ''}`,
      type: 'text',
      id: `${idPrefix}-pattern`,
      value: draft.pattern,
      placeholder: draft.regex ? 'Regular expression' : 'Word or phrase',
      'aria-label': 'Rule pattern',
      'aria-invalid': String(error !== null),
      'data-hl-field': '',
      spellcheck: 'false',
      disabled: options.disabled
    })
    pattern.addEventListener('input', () => {
      draft.pattern = pattern.value
      options.onChange()
    })
    pattern.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        options.onSubmit()
      } else if (event.key === 'Escape' && options.onCancel) {
        event.preventDefault()
        options.onCancel()
      }
    })
    const color = h('select', { class: 'field-select', id: `${idPrefix}-color`, 'aria-label': 'Rule color', 'data-hl-field': '', disabled: options.disabled })
    for (const name of HIGHLIGHT_COLORS) color.append(h('option', { value: name }, COLOR_LABELS[name]))
    color.value = draft.color
    color.addEventListener('change', () => {
      draft.color = color.value as HighlightColor
    })
    const regex = checkbox(`${idPrefix}-regex`, 'Regex', draft.regex, options.disabled, (value) => {
      draft.regex = value
      pattern.setAttribute('placeholder', value ? 'Regular expression' : 'Word or phrase')
      options.onChange()
    })
    regex.querySelector('input')?.setAttribute('data-hl-field', '')
    const buttons = [
      h('button', { class: 'btn ghost small', type: 'button', id: `${idPrefix}-submit`, disabled: options.disabled, onClick: () => options.onSubmit() }, options.submitLabel),
      options.onCancel ? h('button', { class: 'btn ghost small', type: 'button', id: `${idPrefix}-cancel`, onClick: () => options.onCancel?.() }, 'Cancel') : null
    ]
    return h(
      'div',
      { class: 'set-row hl-form-row' },
      h(
        'div',
        { class: 'set-main' },
        h('div', { class: 'hl-form' }, pattern, color, regex, ...buttons),
        error ? h('p', { class: 'field-error', id: `${idPrefix}-error`, role: 'alert' }, error) : null
      )
    )
  }

  private addRule(current: HighlightSettings): void {
    const problem = this.problemWith(this.addDraft, current.rules, -1)
    if (problem) {
      this.addError = problem
      this.refresh()
      return
    }
    setHighlights({ ...current, rules: [...current.rules, this.toRule(this.addDraft)] })
    this.addDraft = emptyDraft()
    this.addError = null
    this.refresh()
    document.getElementById('hl-add-pattern')?.focus()
  }

  private startEdit(rule: HighlightRule, index: number): void {
    this.editIndex = index
    this.editDraft = { pattern: rule.pattern, regex: rule.regex === true, color: rule.color }
    this.editError = null
    this.refresh()
    document.getElementById('hl-edit-pattern')?.focus()
  }

  private saveEdit(current: HighlightSettings): void {
    const index = this.editIndex
    if (index === null) return
    const problem = this.problemWith(this.editDraft, current.rules, index)
    if (problem) {
      this.editError = problem
      this.refresh()
      return
    }
    const rules = current.rules.map((rule, i) => (i === index ? this.toRule(this.editDraft) : rule))
    this.editIndex = null
    this.editError = null
    setHighlights({ ...current, rules })
    this.refresh()
  }

  private toRule(draft: RuleDraft): HighlightRule {
    const pattern = draft.pattern.trim()
    return draft.regex ? { pattern, color: draft.color, regex: true } : { pattern, color: draft.color }
  }

  private problemWith(draft: RuleDraft, rules: HighlightRule[], skip: number): string | null {
    const invalid = validateRule(draft.pattern, draft.regex)
    if (invalid) return invalid
    const text = draft.pattern.trim().toLowerCase()
    const duplicate = rules.some((rule, i) => i !== skip && (rule.regex === true) === draft.regex && rule.pattern.toLowerCase() === text)
    return duplicate ? 'That rule already exists.' : null
  }

  private changelog(state: AppState): HTMLElement[] {
    const current = state.info.version
    const entries = entriesUpTo(CHANGELOG_ENTRIES, current).sort((a, b) => compareVersions(b.version, a.version))
    const toolbar = row(
      "What's new",
      h('button', { class: 'btn ghost small', type: 'button', id: 'whats-new', onClick: () => openWhatsNew() }, "Show what's new"),
      h('p', { class: 'hint' }, 'The release notes dialog for this version.')
    )
    const list = h(
      'div',
      { class: 'cl-list', id: 'changelog-list' },
      ...entries.map((entry) => {
        const block = entryBlock(entry)
        block.classList.add('cl-entry')
        if (entry.version === current) {
          block.classList.add('current')
          block.querySelector('h3')?.append(h('span', { class: 'cl-current' }, 'current'))
        }
        return block
      })
    )
    return [toolbar, entries.length === 0 ? h('p', { class: 'tool-empty' }, 'No changelog available.') : list]
  }

  private about(state: AppState): HTMLElement[] {
    const { version, userData } = state.info
    const sep = userData.includes('\\') ? '\\' : '/'
    const path = (label: string, value: string, id: string): HTMLElement =>
      row(label, null, h('code', { class: 'set-path', id }, value || 'unknown'))
    return [
      row('Dawsha', h('span', { class: 'set-value mono', id: 'about-version' }, version || 'unknown')),
      row(
        'Links',
        h(
          'div',
          { class: 'set-links' },
          ...LINKS.map((link) =>
            h('button', { class: 'tool-link', type: 'button', id: link.id, onClick: () => openUpdateLink(link.url) }, link.label)
          )
        )
      ),
      row(
        'Data folder',
        h('button', { class: 'btn ghost small', type: 'button', id: 'open-data-folder', disabled: !userData, onClick: () => openDataFolder() }, 'Open data folder'),
        h('code', { class: 'set-path', id: 'about-user-data' }, userData || 'unknown')
      ),
      path('Settings file', userData ? `${userData}${sep}settings.json` : '', 'about-settings-file'),
      path('Usage history', userData ? `${userData}${sep}usage-history.json` : '', 'about-usage-file')
    ]
  }
}
