import { pairingLink } from '../../shared/remotePairing'
import { describeActivity } from '../../shared/remoteActivity'
import { REMOTE_CAPABILITIES, REMOTE_CAPABILITY_INFO } from '../../shared/remoteCapabilities'
import { deviceIsActive, isValidPinEmail, lastSeenLabel, statusCopy } from '../../shared/remoteStatus'
import type { RemoteAccessPatch, RemoteAccessState } from '../../shared/types'
import { qrSvg } from '../qr'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { api } from '../api'
import { confirmDialog } from './dialogs'
import { toast } from './toast'

export interface RemoteAccessHost {
  state(): RemoteAccessState | null
  error(): string | null
  busy(): boolean
  checking(): boolean
  run(action: () => Promise<RemoteAccessState>): Promise<void>
  refresh(): void
  verify(): void
}

const STATUS_ICON = { on: ICONS.linkOn, dropped: ICONS.linkDropped, off: ICONS.linkOff, busy: ICONS.refresh } as const
const INSTALL_NOTE = 'Dawsha checks for a compatible Cloudflare Tunnel and installs a verified copy in app data if needed. First setup needs internet access; no administrator access is required.'
const EMAIL_NOTE = 'Cloudflare emails a one-time PIN to this address before anyone can open the link.'
const NO_PIN_NOTE = 'Anyone with the link still needs a pairing code from this PC. Add a PIN email below for a second check.'

const clock = (time: number): string => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (time: number): string => new Date(time).toLocaleDateString([], { day: 'numeric', month: 'short' })

function checkbox(id: string, disabled: boolean, checked: boolean, onChange: (value: boolean) => void, ...label: (Node | string | null)[]): HTMLElement {
  const input = h('input', { type: 'checkbox', id, disabled })
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'ra-cap', for: id }, input, h('span', {}, ...label))
}

function copyButton(id: string, value: string, label: string, disabled: boolean): HTMLElement {
  const text = h('span', {}, `Copy ${label}`)
  const glyph = icon(ICONS.copy)
  const button = h('button', { class: 'remote-icon-btn remote-copy-btn', type: 'button', id, disabled }, glyph, text) as HTMLButtonElement
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
        text.textContent = `Copy ${label}`
      }, 1600)
    } catch {
      toast(`Could not copy the ${label}.`)
    }
  })())
  return button
}

function pairingCountdown(expiresAt: number): HTMLElement {
  const label = h('span', { class: 'remote-expiry', title: `Expires ${new Date(expiresAt).toLocaleTimeString()}` })
  let shown = false
  const update = (): void => {
    const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
    label.textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · one phone per code`
    label.classList.toggle('soon', seconds <= 60)
    if (label.isConnected) shown = true
    if (seconds > 0 && !(shown && !label.isConnected)) window.setTimeout(update, 1000)
  }
  update()
  return label
}

export function createRemoteAccessView(host: RemoteAccessHost) {
  let emailEditing = false
  let emailDraft = ''
  let emailError: string | null = null

  const set = (patch: RemoteAccessPatch): void => { void host.run(() => api.remoteAccess!.setPermissions(patch)) }

  function statusCard(state: RemoteAccessState | null): HTMLElement[] {
    const remote = api.remoteAccess!
    const status = state?.status ?? 'off'
    const checking = host.checking() && status === 'available'
    const busy = host.busy()
    const copy = checking
      ? { kind: 'busy' as const, title: 'Checking the connection…', detail: 'Testing the tunnel from this PC.' }
      : statusCopy({ status, droppedAt: state?.droppedAt ?? null, message: state?.message ?? '', now: Date.now() })
    const enabled = state?.enabled === true
    const actions: HTMLElement[] = []
    if (copy.kind === 'on') actions.push(h('button', { class: 'btn ghost small', type: 'button', id: 'remote-test', disabled: busy, onClick: () => host.verify() }, 'Test from here'))
    if (status === 'dropped') actions.push(h('button', { class: 'btn primary small', type: 'button', id: 'remote-reconnect', disabled: busy, onClick: () => void host.run(() => remote.reconnect()) }, 'Reconnect'))
    if (copy.kind === 'busy' && !checking && !enabled) actions.push(h('button', { class: 'btn primary small', type: 'button', id: 'remote-access-toggle', disabled: true }, 'Preparing tunnel…'))
    else {
      const label = enabled ? 'Turn off' : (status === 'setup-required' || host.error()) ? 'Try again' : 'Turn on'
      actions.push(h('button', {
        class: enabled ? 'btn ghost small' : 'btn primary small',
        type: 'button',
        id: 'remote-access-toggle',
        disabled: busy,
        onClick: () => void host.run(() => enabled ? remote.disable() : remote.enable())
      }, busy && !enabled ? 'Preparing tunnel…' : label))
    }
    const card = h('section', { class: `ra-status ra-${copy.kind}`, id: 'remote-status', role: 'status' },
      h('span', { class: 'ra-status-icon', 'aria-hidden': 'true' }),
      h('div', { class: 'ra-status-copy' }, h('p', { class: 'ra-status-title' }, copy.title), h('p', { class: 'ra-status-detail' }, copy.detail)),
      h('div', { class: 'ra-status-actions' }, ...actions))
    card.querySelector<HTMLElement>('.ra-status-icon')!.innerHTML = STATUS_ICON[copy.kind]
    const parts: HTMLElement[] = [card]
    if (!enabled && (status === 'off' || status === 'setup-required')) parts.push(h('p', { class: 'hint ra-install-note', id: 'remote-install-note' }, INSTALL_NOTE))
    if (state?.notice && !checking) parts.push(h('p', { class: 'hint remote-notice', id: 'remote-address-changed', role: 'status' }, state.notice))
    if (host.error()) parts.push(h('p', { class: 'note error set-note', role: 'alert' }, host.error()))
    return parts
  }

  function connectCard(state: RemoteAccessState | null): HTMLElement {
    const remote = api.remoteAccess!
    const busy = host.busy()
    const card = h('section', { class: 'ra-card', id: 'remote-connect' }, h('h3', {}, 'Connect a phone'))
    if (!state?.enabled || !state.url || host.checking()) {
      card.append(h('p', { class: 'ra-pair-empty' }, state?.status === 'dropped' ? 'The link is paused. Reconnect to get a new one.' : 'Turn on Remote Access to get a link and a pairing code.'))
      return card
    }
    const target = pairingLink(state.url, state.pairing?.code)
    const qr = h('div', { class: 'remote-qr', 'data-qr': target }, qrSvg(target, state.pairing ? 'QR code that opens Dawsha and pairs your phone' : 'QR code that opens Dawsha on your phone'))
    const copy = h('div', { class: 'ra-pair-copy' }, h('p', {}, 'Scan it, or open the link and type the code'))
    if (state.pairing) {
      copy.append(
        h('code', { class: 'remote-pairing-code', 'aria-label': `Pairing code ${state.pairing.code.split('').join(' ')}` },
          ...state.pairing.code.split('').map((digit) => h('span', { class: 'remote-digit' }, digit))),
        pairingCountdown(state.pairing.expiresAt))
    } else copy.append(h('p', {}, 'No active pairing code.'))
    copy.append(
      h('code', { class: 'remote-url', title: state.url }, state.url),
      h('div', { class: 'ra-actions' },
        copyButton('remote-copy-url', state.url, 'link', busy),
        h('button', { class: 'remote-icon-btn', type: 'button', id: 'remote-refresh-code', disabled: busy, onClick: () => void host.run(() => remote.refreshPairing()) }, icon(ICONS.refresh), state.pairing ? 'New code' : 'Create code')))
    card.append(h('div', { class: 'ra-pair' }, qr, copy))
    if (!state.permissions.allowedEmail) card.append(h('p', { class: 'hint', id: 'remote-security-note' }, NO_PIN_NOTE))
    else card.append(h('p', { class: 'hint' }, `Cloudflare emails a PIN to ${state.permissions.allowedEmail} first, then Dawsha asks for the code.`))
    return card
  }

  function switchRow(id: string, label: string, on: boolean, onChange: (value: boolean) => void): HTMLElement {
    const toggle = h('button', { class: 'ra-switch', type: 'button', id, role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled: host.busy() })
    toggle.addEventListener('click', () => onChange(!on))
    return h('div', { class: 'ra-switch-row' }, toggle, h('span', {}, label))
  }

  function connectionCard(state: RemoteAccessState | null): HTMLElement {
    const now = Date.now()
    const status = state?.status ?? 'off'
    const online = (state?.devices ?? []).filter((device) => deviceIsActive(device.lastSeenAt, now))
    const rows: [string, string][] = status === 'off' || status === 'setup-required'
      ? [['Status', 'Off']]
      : [
          ['Status', status === 'available' ? 'Reachable' : status === 'dropped' ? 'Not reachable' : 'Connecting'],
          ['Tunnel', 'Cloudflare Quick Tunnel'],
          ['Round trip', state?.roundTripMs != null && status === 'available' ? `${state.roundTripMs} ms` : '—'],
          ['Link changed', state?.linkChangedAt ? `${day(state.linkChangedAt) === day(now) ? 'today' : day(state.linkChangedAt)} ${clock(state.linkChangedAt)}${status === 'dropped' ? ' · will change on reconnect' : ''}` : '—'],
          ['Phones online', online.length ? online.map((device) => device.name).join(', ') : 'none']
        ]
    const access = state?.permissions
    return h('section', { class: 'ra-card', id: 'remote-connection' },
      h('h3', {}, 'Connection'),
      h('dl', { class: 'ra-kv' }, ...rows.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)])),
      access ? h('div', { class: 'ra-switches' },
        switchRow('remote-auto-reconnect', 'Reconnect on its own when the tunnel drops', access.autoReconnect, (value) => set({ autoReconnect: value })),
        switchRow('remote-notify-link', 'Tell me when the link changes, so I can re-scan', access.notifyLinkChange, (value) => set({ notifyLinkChange: value }))) : null)
  }

  function phonesCard(state: RemoteAccessState | null): HTMLElement {
    const remote = api.remoteAccess!
    const now = Date.now()
    const devices = state?.devices ?? []
    const list = devices.length
      ? devices.map((device) => h('div', { class: 'ra-device', 'data-device': device.name },
          h('span', { class: 'ra-device-icon', 'aria-hidden': 'true' }),
          h('b', {}, device.name),
          h('small', {}, `${lastSeenLabel(device.lastSeenAt, now)} · paired ${day(device.pairedAt)}`),
          h('button', {
            class: 'btn ghost small ra-remove',
            type: 'button',
            disabled: host.busy(),
            'aria-label': `Remove ${device.name}`,
            onClick: () => void (async () => {
              const ok = await confirmDialog({
                title: `Remove ${device.name}?`,
                body: `${device.name} is signed out at once and needs a new code to come back.`,
                confirmLabel: `Remove ${device.name}`
              })
              if (ok) await host.run(() => remote.revokeDevice(device.id))
            })()
          }, 'Remove…')))
      : [h('p', { class: 'ra-pair-empty' }, 'No phones are paired yet.')]
    for (const tile of list) tile.querySelector<HTMLElement>('.ra-device-icon')?.insertAdjacentHTML('afterbegin', ICONS.phone)
    return h('section', { class: 'ra-card', id: 'remote-phones' }, h('h3', {}, 'Phones'), ...list)
  }

  function capabilitiesCard(state: RemoteAccessState | null): HTMLElement {
    const card = h('section', { class: 'ra-card', id: 'remote-capabilities' }, h('h3', {}, 'What a phone can do'))
    if (!state) return card
    const caps = state.permissions.capabilities
    const rows = REMOTE_CAPABILITIES.map((capability) => {
      const info = REMOTE_CAPABILITY_INFO[capability]
      return checkbox(`remote-cap-${capability}`, host.busy(), caps[capability], (value) => {
        void (async () => {
          if (value && info.confirm && !await confirmDialog({ ...info.confirm, danger: false })) { host.refresh(); return }
          set({ capabilities: { [capability]: value } })
        })()
      }, info.label, info.hint ? h('small', {}, info.hint) : null)
    })
    card.append(h('div', { class: 'ra-caps' }, ...rows))
    return card
  }

  function alertsCard(state: RemoteAccessState): HTMLElement {
    const access = state.permissions
    const approvalsOn = access.capabilities.commands || access.capabilities.answers
    const minutes = h('input', {
      class: 'text-input remote-away-minutes',
      id: 'remote-approvals-minutes',
      type: 'number',
      min: '1',
      max: '60',
      value: String(access.approvalsAwayMinutes),
      disabled: host.busy() || !approvalsOn || !access.approvalsOnlyWhenAway,
      'aria-label': 'Minutes without keyboard or mouse input before notifying'
    }) as HTMLInputElement
    minutes.addEventListener('change', () => set({ approvalsAwayMinutes: Number(minutes.value) }))
    return h('section', { class: 'ra-card ra-wide', id: 'remote-alerts' },
      h('h3', {}, 'Phone alerts and limits'),
      h('div', { class: 'ra-caps' },
        checkbox('remote-approvals-notify', host.busy() || !approvalsOn, access.approvalsNotify, (value) => set({ approvalsNotify: value }),
          'Notify the phone when a session needs you', h('small', {}, 'Uses browser notifications while the phone page is open in the background.')),
        h('div', { class: 'ra-away' },
          checkbox('remote-approvals-away', host.busy() || !approvalsOn || !access.approvalsNotify, access.approvalsOnlyWhenAway, (value) => set({ approvalsOnlyWhenAway: value }), 'Only when this PC has been idle for'),
          minutes, h('span', {}, 'minutes')),
        checkbox('remote-approvals-config', host.busy() || !approvalsOn, access.approvalsAllowConfigEdits, (value) => set({ approvalsAllowConfigEdits: value }),
          'Phone can allow edits to CI and config files', h('small', {}, 'Off by default. Detection reads the prompt text, so it is best effort.'))))
  }

  function emailRow(state: RemoteAccessState | null): HTMLElement {
    const remote = api.remoteAccess!
    const saved = state?.permissions.allowedEmail ?? ''
    const locked = host.busy() || state?.enabled === true
    const editing = emailEditing || !saved
    const control = h('div', { class: 'ra-email-control' })
    if (editing) {
      const input = h('input', {
        class: `text-input${emailError ? ' invalid' : ''}`,
        id: 'remote-email-input',
        type: 'email',
        value: emailDraft || saved,
        placeholder: 'you@example.com',
        autocomplete: 'email',
        'aria-label': 'Cloudflare PIN email',
        'aria-invalid': String(emailError !== null),
        disabled: locked
      }) as HTMLInputElement
      input.addEventListener('input', () => { emailDraft = input.value })
      const save = (): void => {
        const value = input.value.trim()
        if (!isValidPinEmail(value)) { emailError = 'Enter a full address such as you@example.com.'; emailDraft = input.value; host.refresh(); return }
        emailError = null
        emailDraft = ''
        emailEditing = false
        void host.run(() => remote.setAllowedEmail(value))
      }
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') save() })
      control.append(input, h('button', { class: 'btn primary small', type: 'button', id: 'remote-email-save', disabled: locked, onClick: save }, 'Save'))
      if (saved) control.append(h('button', { class: 'btn ghost small', type: 'button', id: 'remote-email-cancel', onClick: () => { emailEditing = false; emailDraft = ''; emailError = null; host.refresh() } }, 'Cancel'))
    } else {
      control.append(
        h('span', { class: 'ra-email-value', id: 'remote-email-saved' }, saved),
        h('button', { class: 'btn ghost small', type: 'button', id: 'remote-email-change', disabled: locked, onClick: () => { emailEditing = true; emailDraft = saved; host.refresh() } }, 'Change'),
        h('button', {
          class: 'btn ghost small',
          type: 'button',
          id: 'remote-email-remove',
          disabled: locked,
          onClick: () => void (async () => {
            const ok = await confirmDialog({
              title: 'Remove the PIN email?',
              body: `Cloudflare will stop emailing a PIN to ${saved}. Anyone with the link will only need a pairing code.`,
              confirmLabel: `Remove ${saved}`
            })
            if (ok) await host.run(() => remote.setAllowedEmail(''))
          })()
        }, 'Remove'))
    }
    return h('div', { class: 'set-row', id: 'remote-email-row' },
      h('div', { class: 'set-main' },
        h('div', { class: 'set-name' }, 'Cloudflare PIN email (optional)'),
        h('p', { class: 'hint', id: 'remote-email-note' }, EMAIL_NOTE),
        state?.enabled ? h('p', { class: 'hint' }, 'Turn Remote Access off to change it.') : null,
        emailError ? h('p', { class: 'ra-email-error', id: 'remote-email-error', role: 'alert' }, emailError) : null),
      h('div', { class: 'set-control' }, control))
  }

  function activityCard(state: RemoteAccessState | null): HTMLElement {
    const entries = state?.activity ?? []
    return h('section', { class: 'ra-card ra-wide', id: 'remote-activity' },
      h('h3', {}, 'Recent from your phones'),
      entries.length
        ? h('ul', { class: 'ra-log' }, ...entries.map((entry) => h('li', {}, h('time', {}, clock(entry.time)), h('span', {}, describeActivity(entry)))))
        : h('p', { class: 'ra-pair-empty' }, 'Nothing yet. What your phones do shows up here.'))
  }

  return {
    build(): HTMLElement[] {
      if (!api.remoteAccess) return []
      const state = host.state()
      const parts = [
        ...statusCard(state),
        h('div', { class: 'ra-grid' }, connectCard(state), connectionCard(state)),
        h('div', { class: 'ra-grid' }, phonesCard(state), capabilitiesCard(state)),
        emailRow(state)
      ]
      if (state) parts.push(alertsCard(state), activityCard(state))
      return parts
    }
  }
}
