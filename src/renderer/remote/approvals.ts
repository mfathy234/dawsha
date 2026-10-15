import { AGENT_MARKS } from '../../shared/agents'
import { waitingLabel, type ApprovalHistoryEntry, type ApprovalItem, type ApprovalsPayload } from '../../shared/approvals'
import type { AgentKind } from '../../shared/types'

export interface ApprovalsHost {
  request<T>(path: string, init?: RequestInit): Promise<T>
  endpoint(path: string): string
  onBadge(count: number): void
  onUnpaired(): void
}

export const QUICK_REASONS = ['Stop and wait for me', 'Don’t run anything, just explain', 'Use a different approach']
const RECONNECT_MS = 3000
const RELATIVE_REFRESH_MS = 30_000
const KIND_LABEL = { command: 'Command', edit: 'File edit', other: 'Prompt' } as const

let host: ApprovalsHost
let root: HTMLElement
let enabled = false
let payload: ApprovalsPayload = { items: [], history: [], notify: false }
let loaded = false
let socket: WebSocket | null = null
let reconnectTimer = 0
let visible = false
let busyId: string | null = null
let message = ''
let messageIsError = false
let seen = new Set<string>()
let denyTarget: ApprovalItem | null = null
let swRegistration: Promise<ServiceWorkerRegistration | null> | null = null

const denyDialog = (): HTMLDialogElement => document.querySelector<HTMLDialogElement>('#deny-dialog')!

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function actionButton(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = make('button', className, label)
  element.type = 'button'
  element.disabled = disabled
  element.addEventListener('click', onClick)
  return element
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator
}

function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  swRegistration ??= navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => null)
  return swRegistration
}

async function enableNotifications(): Promise<void> {
  if (!notificationsSupported()) return
  const result = await Notification.requestPermission()
  if (result === 'granted') await registerWorker()
  setMessage(result === 'granted' ? 'Notifications are on while this page is open in the background.' : 'Notifications are blocked for this page. Allow them in your browser settings.', result !== 'granted')
  render()
}

async function notifyNew(items: ApprovalItem[]): Promise<void> {
  if (!payload.notify || document.visibilityState !== 'hidden' || !notificationsSupported() || Notification.permission !== 'granted') return
  const registration = await registerWorker()
  if (!registration) return
  for (const item of items) {
    const body = item.canAllow
      ? `${item.kind === 'command' ? 'Wants to run' : item.kind === 'edit' ? 'Wants to edit' : 'Asks'}: ${item.summary}`
      : `${item.summary}\nEdits outside src need a look in the app`
    const options: NotificationOptions & { actions?: Array<{ action: string; title: string }>; renotify?: boolean } = {
      body,
      tag: `approval:${item.id}:${item.fingerprint}`,
      data: { id: item.id, fingerprint: item.fingerprint, canAllow: item.canAllow },
      requireInteraction: true,
      ...(item.canAllow ? { actions: [{ action: 'allow', title: 'Allow' }, { action: 'deny', title: 'Deny' }] } : {})
    }
    try { await registration.showNotification(`${item.title} · ${item.projectName}`, options) } catch { /* the page still lists the prompt */ }
  }
}

function setMessage(text: string, isError = false): void {
  message = text
  messageIsError = isError
}

function apply(next: ApprovalsPayload): void {
  const fresh = next.items.filter((item) => !seen.has(`${item.id}:${item.fingerprint}`))
  seen = new Set(next.items.map((item) => `${item.id}:${item.fingerprint}`))
  payload = next
  const firstLoad = !loaded
  loaded = true
  host.onBadge(payload.items.length)
  if (!firstLoad && fresh.length > 0) void notifyNew(fresh)
  render()
}

function closeSocket(): void {
  window.clearTimeout(reconnectTimer)
  const current = socket
  socket = null
  current?.close()
}

function connect(): void {
  if (!enabled || socket) return
  const target = new URL(host.endpoint('approvals/stream'))
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
  const source = new WebSocket(target)
  socket = source
  source.addEventListener('message', (event) => {
    if (socket !== source) return
    try {
      const frame = JSON.parse(String(event.data)) as { event?: string; data?: unknown }
      if (frame.event === 'approvals' && frame.data && typeof frame.data === 'object') apply(frame.data as ApprovalsPayload)
      else if (frame.event === 'revoked') { closeSocket(); host.onUnpaired() }
      else if (frame.event === 'denied') { closeSocket(); void refresh() }
    } catch { setMessage('Received an invalid update from Dawsha.', true); render() }
  })
  const lost = (): void => {
    if (socket !== source) return
    socket = null
    if (enabled) reconnectTimer = window.setTimeout(connect, RECONNECT_MS)
  }
  source.addEventListener('close', lost)
  source.addEventListener('error', lost)
}

export async function refresh(): Promise<void> {
  if (!enabled) return
  try { apply(await host.request<ApprovalsPayload>('approvals')) } catch (error) {
    setMessage(error instanceof Error ? error.message : 'Could not load approvals.', true)
    render()
  }
}

async function answer(item: ApprovalItem, allow: boolean, reason?: string): Promise<void> {
  busyId = item.id
  setMessage('')
  render()
  try {
    const result = await host.request<{ ok: boolean; reasonSent?: boolean }>('approvals/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, fingerprint: item.fingerprint, allow, ...(reason ? { reason } : {}) })
    })
    setMessage(allow ? 'Allowed.' : reason && result.reasonSent === false ? 'Denied. Your message could not be sent, the agent was still busy.' : 'Denied.', Boolean(reason) && result.reasonSent === false)
  } catch (error) {
    setMessage(error instanceof Error ? error.message : 'Could not answer the prompt.', true)
  } finally {
    busyId = null
    await refresh()
  }
}

function openDeny(item: ApprovalItem): void {
  denyTarget = item
  const dialog = denyDialog()
  dialog.querySelector<HTMLElement>('#deny-title')!.textContent = `Deny ${item.summary}?`
  dialog.querySelector<HTMLElement>('#deny-subtitle')!.textContent = `${item.title.replace(' needs you', '')} · ${item.projectName}`
  const text = dialog.querySelector<HTMLTextAreaElement>('#deny-message')!
  text.value = ''
  const chips = dialog.querySelector<HTMLElement>('#deny-quick')!
  chips.replaceChildren(...QUICK_REASONS.map((reason) => {
    const chip = actionButton(reason, 'quick-reason', () => {
      text.value = reason
      for (const other of chips.children) other.classList.toggle('on', other === chip)
    })
    return chip
  }))
  text.oninput = () => { for (const chip of chips.children) chip.classList.toggle('on', chip.textContent === text.value) }
  dialog.showModal()
}

function submitDeny(): void {
  const item = denyTarget
  if (!item) return
  const reason = denyDialog().querySelector<HTMLTextAreaElement>('#deny-message')!.value.trim()
  denyDialog().close()
  denyTarget = null
  void answer(item, false, reason || undefined)
}

function card(item: ApprovalItem): HTMLElement {
  const busy = busyId === item.id
  const element = make('article', 'approval-card')
  const head = make('div', 'approval-head')
  const mark = make('span', `agent-badge agent-${item.agent}`, AGENT_MARKS[item.agent as AgentKind] ?? '?')
  mark.setAttribute('aria-hidden', 'true')
  const who = make('div', 'approval-who')
  who.append(make('strong', '', `${item.title.replace(' needs you', '')} · ${item.projectName}`), make('span', 'approval-wait', `waiting ${waitingLabel(item.since, Date.now())}`))
  head.append(mark, who, make('span', 'approval-kind', KIND_LABEL[item.kind]))
  const body = make('pre', 'approval-text')
  body.textContent = item.text
  body.tabIndex = 0
  body.setAttribute('aria-label', `Prompt from ${item.title.replace(' needs you', '')}`)
  const actions = make('div', 'approval-actions')
  actions.append(actionButton('Deny…', 'approval-btn', () => openDeny(item), busy))
  if (item.canAllow) actions.append(actionButton(busy ? 'Working…' : 'Allow once', 'approval-btn primary', () => void answer(item, true), busy))
  element.append(head, body)
  if (!item.canAllow) element.append(make('p', 'approval-note', 'Open in Dawsha to allow. Edits outside the project and CI or config files can only be denied from the phone.'))
  element.append(actions)
  return element
}

function historyRow(entry: ApprovalHistoryEntry): HTMLElement {
  const row = make('li', 'history-row')
  const line = make('span', 'history-main')
  line.append(make('strong', entry.allowed ? 'history-allowed' : 'history-denied', entry.allowed ? 'Allowed' : 'Denied'), document.createTextNode(` ${entry.summary}`))
  row.append(line, make('span', 'history-meta', `${entry.source === 'phone' ? entry.device : 'desktop'} · ${clock(entry.time)}`))
  return row
}

function notificationRow(): HTMLElement | null {
  if (!notificationsSupported()) return make('p', 'approval-hint', 'This browser cannot show notifications. Keep this page open to see new prompts.')
  if (Notification.permission === 'granted') return payload.notify ? null : make('p', 'approval-hint', 'Notifications are off in Dawsha, or paused while you are at the computer.')
  if (Notification.permission === 'denied') return make('p', 'approval-hint', 'Notifications are blocked for this page. Allow them in your browser settings.')
  const row = make('div', 'approval-notify')
  row.append(make('span', '', 'Get a notification when a session needs you.'), actionButton('Turn on', 'quiet-button', () => void enableNotifications()))
  return row
}

export function render(): void {
  if (!root) return
  root.replaceChildren()
  if (!enabled) {
    const off = make('div', 'empty-state')
    off.append(make('p', 'eyebrow', 'TURNED OFF'), make('h2', '', 'Approvals are off'), make('p', '', 'Turn on “Let paired phones answer permission prompts” in Dawsha’s Remote Access settings, then come back here.'))
    root.append(off)
    return
  }
  const list = make('div', 'approval-list')
  if (!loaded) list.append(make('p', 'quiet-empty', 'Loading…'))
  else if (payload.items.length === 0) list.append(make('p', 'quiet-empty', 'Nothing is waiting for you.'))
  else list.append(...payload.items.map(card))
  const status = make('div', 'remote-notice')
  status.setAttribute('role', 'status')
  status.textContent = message
  status.classList.toggle('error', messageIsError)
  status.hidden = !message
  const notify = notificationRow()
  root.append(...(notify ? [notify] : []), status, list)
  if (payload.history.length > 0) {
    const section = make('section', 'approval-history')
    section.append(make('h2', '', 'Earlier today'))
    const entries = make('ul', 'history-list')
    entries.append(...payload.history.map(historyRow))
    section.append(entries)
    root.append(section)
  }
}

export function setApprovalsEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  if (!enabled) {
    closeSocket()
    payload = { items: [], history: [], notify: false }
    loaded = false
    host.onBadge(0)
  } else {
    void refresh().then(() => { connect(); if (notificationsSupported() && Notification.permission === 'granted') void registerWorker() })
  }
  render()
}

export function setApprovalsVisible(next: boolean): void {
  if (next === visible) return
  visible = next
  if (visible && enabled) { void refresh(); connect() }
  render()
}

export function reconnectApprovals(): void {
  if (enabled && !socket) connect()
}

export function initApprovals(options: { host: ApprovalsHost; root: HTMLElement }): void {
  host = options.host
  root = options.root
  const dialog = denyDialog()
  dialog.querySelector<HTMLButtonElement>('#deny-back')!.addEventListener('click', () => { dialog.close(); denyTarget = null })
  dialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', (event) => { event.preventDefault(); submitDeny() })
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'open-approvals') window.dispatchEvent(new Event('dawsha-open-approvals'))
  })
  window.setInterval(() => { if (visible && enabled) render() }, RELATIVE_REFRESH_MS)
}
