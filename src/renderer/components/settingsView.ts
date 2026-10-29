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
  setColorSessionsByTag,
  setDimOtherPanes,
  setShowRecap,
  setSidebarCollapsed,
  showSettingsSection,
  showView,
  toggleThemePicker
} from '../actions'
import { AGENTS, AGENT_NAMES, FULL_ACCESS_FLAGS } from '../../shared/agents'
import {
  HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_RULES,
  defaultHighlightRules,
  highlightBackground,
  highlightPreview,
  highlightTint,
  sameRules,
  validateRule,
  type HighlightColor,
  type HighlightRule,
  type HighlightSettings
} from '../../shared/highlights'
import { compareVersions } from '../../shared/version'
import { swatchGroup } from './swatchGroup'
import { currentBundle } from '../themeManager'
import { entriesUpTo } from '../../shared/changelog'
import { DEFAULT_PALETTE_SHORTCUT } from '../../shared/settingsSchema'
import { isRemoteControlBuild } from '../../shared/remoteBuild'
import type { RemoteAccessState } from '../../shared/types'
import { formatShortcut, parseShortcut } from '../../shared/shortcuts'
import { updateStatusLine } from '../../shared/updates'
import { releaseTagUrl } from '../../shared/markdown'
import { h } from '../dom'
import { api } from '../api'
import { createRemoteAccessView } from './remoteAccessView'
import { CHANGELOG_ENTRIES } from '../changelog'
import { store, type AppState, type SettingsSection } from '../state'
import { entryBlock } from './whatsNew'
import { invalidateRecordingStats, recordingRows } from './recordingSettings'
import { exportSettingsFromUi, importSettingsFromUi } from '../settingsTransferActions'
import { pageHeader } from './pageHeader'

const SECTIONS: { id: SettingsSection; label: string; lede: string }[] = [
  { id: 'general', label: 'General', lede: 'Keyboard shortcut, sidebar, recordings and setup.' },
  { id: 'appearance', label: 'Appearance', lede: 'Choose a theme and terminal background.' },
  { id: 'notifications', label: 'Notifications', lede: 'What Dawsha shows and tells you while sessions run.' },
  { id: 'agents', label: 'Agents', lede: 'How new sessions start for each agent.' },
  { id: 'import', label: 'Import', lede: 'Bring settings from another Dawsha installation.' },
  ...(isRemoteControlBuild ? [{ id: 'remote' as const, label: 'Remote access', lede: 'Reach this Dawsha installation from your own devices.' }] : []),
  { id: 'updates', label: 'Updates', lede: 'Keep Dawsha current.' },
  { id: 'about', label: 'About', lede: 'Version, links and where your data lives.' }
]

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
  private readonly search = h('input', { class: 'text-input settings-search', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', onInput: () => this.refresh() })
  private readonly panel = h('div', { class: 'settings-panel', role: 'tabpanel' })
  private readonly title = h('h2', { class: 'settings-section-title' })
  private readonly lede = h('p', { class: 'lede' })
  private signature = ''
  private importPath = ''
  private navSection: string | null = null
  private shortcutDraft: string | null = null
  private shortcutError: string | null = null
  private addDraft: RuleDraft = emptyDraft()
  private addError: string | null = null
  private editIndex: number | null = null
  private editDraft: RuleDraft = emptyDraft()
  private editError: string | null = null
  private readonly highlightPreviewEl = h('div', { class: 'hl-preview', id: 'highlight-preview', role: 'group', 'aria-label': 'Preview of highlighted terminal lines' })
  private remoteAccess: RemoteAccessState | null = null
  private remoteError: string | null = null
  private remoteBusy = false
  private remoteChecking = false
  private remoteVerifiedAt = 0
  private remotePollTimer: ReturnType<typeof setTimeout> | null = null
  private pairingExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly remotePanel = createRemoteAccessView({
    state: () => this.remoteAccess,
    error: () => this.remoteError,
    busy: () => this.remoteBusy,
    checking: () => this.remoteChecking,
    run: (action) => this.runRemoteAction(action),
    refresh: () => this.refresh(),
    verify: () => void this.verifyRemote(true)
  })

  constructor() {
    if (isRemoteControlBuild) {
      void this.loadRemoteAccess().then(() => this.verifyRemote(true))
      window.addEventListener('focus', () => {
        if (this.el.getClientRects().length > 0) void this.verifyRemote()
      })
    }
    this.nav.addEventListener('keydown', (event) => this.onNavKey(event))
    this.panel.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link]')
      if (!link) return
      event.preventDefault()
      openUpdateLink(link.href)
    })
    this.el.append(
  pageHeader({ title: 'Settings', subtitle: 'Preferences for Dawsha.' }),
      h('div', { class: 'settings-body' }, h('aside', { class: 'settings-rail' }, this.search, this.nav), h('div', { class: 'settings-content' }, this.title, this.lede, this.panel))
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
    if (isRemoteControlBuild) void this.verifyRemote()
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
    const route = state.settingsSection === 'highlights' ? 'notifications' : state.settingsSection === 'changelog' ? 'about' : state.settingsSection
    const section = sections.find((s) => s.id === route) ?? sections[0]
    const query = this.search.value.trim().toLocaleLowerCase()
    const filteredSections = query ? sections.filter((item) => `${item.label} ${item.lede}`.toLocaleLowerCase().includes(query)) : sections
    const navKey = `${section.id}|${sections.length}|${query}`
    if (this.navSection !== navKey) {
      this.navSection = navKey
      this.nav.replaceChildren(...(filteredSections.length
        ? filteredSections.map((s) => this.tab(s, s.id === section.id))
        : [h('p', { class: 'settings-no-match', role: 'status' }, 'No matching settings sections')]))
    }
    this.title.replaceChildren(section.label)
    this.title.hidden = section.id === 'remote'
    this.lede.hidden = section.id === 'remote'
    if (section.id === 'remote') {
      this.title.append(h('span', { id: 'remote-settings-beta', class: 'beta-badge' }, 'Beta'))
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
      case 'appearance':
        return [h('div', { class: 'settings-appearance' }, h('p', {}, 'Theme and background image'), h('button', { class: 'btn', type: 'button', id: 'settings-theme-picker', onClick: () => toggleThemePicker() }, 'Choose theme'))]
      case 'import':
        return [h('div', { class: 'settings-import' },
          h('p', {}, 'Choose a settings file to preview its projects and preferences before importing.'),
          h('div', { class: 'set-inline' },
            h('input', { class: 'text-input settings-import-path', id: 'settings-import-path', type: 'text', readonly: true, value: this.importPath, placeholder: 'No file selected', 'aria-label': 'Settings file' }),
            h('button', { class: 'btn', type: 'button', id: 'import-settings', onClick: () => void importSettingsFromUi((path) => { this.importPath = path; this.refresh() }) }, 'Browse'),
            h('button', { class: 'btn', type: 'button', id: 'export-settings', onClick: () => void exportSettingsFromUi() }, 'Export settings')
          ))]
      case 'notifications':
        return [...this.notifications(state), ...this.highlights(state)]
      case 'agents':
        return this.agents(state)
      case 'updates':
        return this.updates(state)
      case 'highlights':
        return this.highlights(state)
      case 'remote':
        return this.remoteAccessBody()
      case 'changelog':
        return [...this.about(state), ...this.changelog(state)]
      default:
        return [...this.about(state), ...this.changelog(state)]
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

  // Ask main to check the tunnel end to end before the link or QR is shown, so a stale address is never presented as working.
  private async verifyRemote(force = false): Promise<void> {
    const remote = api.remoteAccess
    if (!remote || this.remoteChecking || this.remoteAccess?.status !== 'available') return
    if (!force && Date.now() - this.remoteVerifiedAt < 60_000) return
    this.remoteChecking = true
    this.refresh()
    try { this.remoteAccess = await remote.verify() } catch (error) {
      this.remoteError = (error as Error).message || 'Remote Access could not be checked.'
    } finally {
      this.remoteChecking = false
      this.remoteVerifiedAt = Date.now()
      this.refresh()
    }
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
    const state = this.remoteAccess
    if (!api.remoteAccess) return []
    if (this.pairingExpiryTimer) clearTimeout(this.pairingExpiryTimer)
    this.pairingExpiryTimer = state?.enabled && state.pairing && state.pairing.expiresAt > Date.now()
      ? setTimeout(() => {
          this.pairingExpiryTimer = null
          void this.loadRemoteAccess()
        }, Math.max(0, state.pairing.expiresAt - Date.now()) + 50)
      : null
    if (this.remotePollTimer) clearTimeout(this.remotePollTimer)
    const pollMs = state?.status === 'connecting' || state?.status === 'reconnecting' ? 2000 : state?.status === 'dropped' ? 5000 : state?.status === 'available' ? 15_000 : 0
    this.remotePollTimer = pollMs ? setTimeout(() => { this.remotePollTimer = null; void this.loadRemoteAccess() }, pollMs) : null
    return this.remotePanel.build()
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
      row('Sessions', checkbox('dim-other-panes', "Dim sessions you're not working in", state.settings.dimOtherPanes, false, setDimOtherPanes)),
      row('Tag colours', checkbox('color-sessions-by-tag', 'Colour sessions by their tag (bug, feature, ...)', state.settings.colorSessionsByTag, false, setColorSessionsByTag)),
      row('Recap', checkbox('show-recap', 'Show a one-line recap in each session', state.settings.showRecap, false, setShowRecap)),
      row('Sidebar', checkbox('sidebar-collapsed', 'Start with the sidebar collapsed', state.settings.sidebarCollapsed, false, setSidebarCollapsed)),
      row(
        'Getting started',
        h('button', { class: 'btn ghost small', type: 'button', id: 'getting-started', onClick: () => openOnboarding() }, 'Getting started…'),
        h('p', { class: 'hint' }, 'Reopen the setup guide for projects, agents and session info.')
      ),
      h('h3', { class: 'set-subhead', id: 'recordings-heading' }, 'Recordings'),
      ...recordingRows(state, () => this.refresh()),
    ]
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
      h('button', { class: 'btn ghost small', type: 'button', id: 'settings-manage-agents', onClick: () => showView('agents') }, 'Manage installs in Agent tools'),
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
      this.renderPreview(current),
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

  private renderPreview(current: HighlightSettings): HTMLElement {
    const draft = this.editIndex !== null ? this.editDraft : this.addDraft
    const typed = draft.pattern.trim() === '' ? null : this.toRule(draft)
    const kind = currentBundle().theme.kind === 'light' ? 'light' : 'dark'
    const lines = highlightPreview(current.rules, typed).map((line) => {
      const el = h('div', { class: `hl-preview-line${line.draft ? ' draft' : ''}`, 'data-hl': line.color ?? undefined }, line.text)
      if (line.color && current.enabled) {
        el.style.background = highlightBackground(line.color, kind)
        el.style.boxShadow = `inset 3px 0 0 ${highlightTint(line.color)}`
      }
      return el
    })
    this.highlightPreviewEl.replaceChildren(...lines)
    return this.highlightPreviewEl
  }

  private updatePreview(): void {
    if (this.highlightPreviewEl.isConnected) this.renderPreview(store.state.settings.highlights)
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
      this.updatePreview()
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
    const color = swatchGroup({
      id: `${idPrefix}-color`,
      label: 'Rule color',
      options: HIGHLIGHT_COLORS.map((value) => ({ value, label: COLOR_LABELS[value] })),
      value: draft.color,
      disabled: options.disabled,
      onChange: (value) => {
        draft.color = value
        this.updatePreview()
      }
    })
    const regex = checkbox(`${idPrefix}-regex`, 'Regex', draft.regex, options.disabled, (value) => {
      draft.regex = value
      pattern.setAttribute('placeholder', value ? 'Regular expression' : 'Word or phrase')
      options.onChange()
      this.updatePreview()
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
