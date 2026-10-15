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
const MAX_RECONNECT_MS = 60_000
const RELATIVE_REFRESH_MS = 30_000
const REASON_FAILURES: Record<string, string> = {
  'new-prompt': 'a new prompt appeared',
  exited: 'the agent is no longer running',
  timeout: 'the agent was still busy',
  unreadable: 'the screen could not be read'
}
const KIND_LABEL = { command: 'Command', edit: 'File edit', other: 'Prompt' } as const

let host: ApprovalsHost
let root: HTMLElement
let enabled = false
let payload: ApprovalsPayload = { items: [], history: [], notify: false }
let loaded = false
let socket: WebSocket | null = null
let reconnectTimer = 0
let reconnectDelay = RECONNECT_MS
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
      : `${item.summary}\nOpen Dawsha to allow`
    const options: NotificationOptions & { actions?: Array<{ action: string; title: string }>; renotify?: boolean } = {
      body,
      tag: `approval:${item.id}:${item.fingerprint}`,
      data: { id: item.id, fingerprint: item.fingerprint, canAllow: item.canAllow },
      requireInteraction: true,
      ...(item.canAllow ? { actions: [{ action: 'allow', title: 'Allow' }, { action: 'open', title: 'Open' }] } : {})
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
  const gone = [...seen].filter((key) => !next.items.some((item) => `${item.id}:${item.fingerprint}` === key))
  seen = new Set(next.items.map((item) => `${item.id}:${item.fingerprint}`))
  payload = next
  if (gone.length > 0) void closeNotifications(gone)
  const firstLoad = !loaded
  loaded = true
  host.onBadge(payload.items.length)
  if (!firstLoad && fresh.length > 0) void notifyNew(fresh)
  render()
}

async function closeNotifications(keys: string[]): Promise<void> {
  if (!notificationsSupported()) return
  const registration = await registerWorker()
  if (!registration) return
  for (const key of keys) {
    try { for (const shown of await registration.getNotifications({ tag: `approval:${key}` })) shown.close() } catch { /* best effort */ }
  }
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
    reconnectDelay = RECONNECT_MS
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
    if (enabled) {
      reconnectTimer = window.setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(MAX_RECONNECT_MS, reconnectDelay * 2)
    }
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
    const result = await host.request<{ ok: boolean; reasonSent?: boolean; reasonFailure?: string }>('approvals/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, fingerprint: item.fingerprint, allow, ...(reason ? { reason } : {}) })
    })
    const failed = Boolean(reason) && result.reasonSent === false
    setMessage(allow ? 'Allowed.' : failed ? `Denied. The reason was not sent because ${REASON_FAILURES[result.reasonFailure ?? ''] ?? 'the agent was not ready'}.` : 'Denied.', failed)
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

interface CardView { element: HTMLElement; wait: HTMLElement; note: HTMLElement; deny: HTMLButtonElement; allow: HTMLButtonElement; signature: string }

const cards = new Map<string, CardView>()
let shell: { notify: HTMLElement; status: HTMLElement; list: HTMLElement; history: HTMLElement } | null = null
let signatures = { notify: '', status: '', list: '', history: '' }

const cardKey = (item: ApprovalItem): string => `${item.id}:${item.fingerprint}`

function blockNote(item: ApprovalItem): string {
  if (item.allowBlock === 'truncated') return 'Too long to show here. Open Dawsha to allow.'
  if (item.allowBlock === 'kind' || item.allowBlock === 'selection') return 'Answer this one on the computer.'
  if (item.allowBlock) return 'Open in Dawsha to allow. Edits outside the project and CI or config files can only be denied from the phone.'
  return item.kind === 'command' ? 'Commands run with your user’s rights on the computer.' : ''
}

function buildCard(item: ApprovalItem): CardView {
  const element = make('article', 'approval-card')
  const head = make('div', 'approval-head')
  const mark = make('span', `agent-badge agent-${item.agent}`, AGENT_MARKS[item.agent as AgentKind] ?? '?')
  mark.setAttribute('aria-hidden', 'true')
  const who = make('div', 'approval-who')
  const wait = make('span', 'approval-wait')
  who.append(make('strong', '', `${item.title.replace(' needs you', '')} · ${item.projectName}`), wait)
  head.append(mark, who, make('span', 'approval-kind', KIND_LABEL[item.kind]))
  const body = make('pre', 'approval-text')
  body.textContent = item.text
  body.tabIndex = 0
  body.setAttribute('aria-label', `Prompt from ${item.title.replace(' needs you', '')}`)
  const note = make('p', 'approval-note')
  const actions = make('div', 'approval-actions')
  const deny = actionButton('Deny…', 'approval-btn', () => openDeny(item))
  const allow = actionButton('Allow once', 'approval-btn primary', () => void answer(item, true))
  actions.append(deny, allow)
  element.append(head, body, note, actions)
  return { element, wait, note, deny, allow, signature: '' }
}

function updateCard(view: CardView, item: ApprovalItem): void {
  const busy = busyId === item.id
  const wait = `waiting ${waitingLabel(item.since, Date.now())}`
  if (view.wait.textContent !== wait) view.wait.textContent = wait
  const note = blockNote(item)
  if (view.note.textContent !== note) view.note.textContent = note
  view.note.hidden = !note
  view.deny.disabled = busy
  view.allow.hidden = !item.canAllow
  view.allow.disabled = busy
  const label = busy ? 'Working…' : 'Allow once'
  if (view.allow.textContent !== label) view.allow.textContent = label
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

function ensureShell(): NonNullable<typeof shell> {
  if (shell) return shell
  const status = make('div', 'remote-notice')
  status.setAttribute('role', 'status')
  shell = { notify: make('div'), status, list: make('div', 'approval-list'), history: make('div') }
  root.append(shell.notify, shell.status, shell.list, shell.history)
  return shell
}

function renderOff(): void {
  const off = make('div', 'empty-state')
  off.append(make('p', 'eyebrow', 'TURNED OFF'), make('h2', '', 'Approvals are off'), make('p', '', 'Turn on “Let paired phones answer permission prompts” in Dawsha’s Remote Access settings, then come back here.'))
  root.replaceChildren(off)
  shell = null
  cards.clear()
  signatures = { notify: '', status: '', list: '', history: '' }
}

export function render(): void {
  if (!root) return
  if (!enabled) { if (shell || root.childElementCount === 0) renderOff(); return }
  if (root.querySelector('.empty-state')) root.replaceChildren()
  const parts = ensureShell()

  const notify = notificationRow()
  const notifySignature = notify ? `${notify.className}|${notify.textContent}` : ''
  if (notifySignature !== signatures.notify) {
    signatures = { ...signatures, notify: notifySignature }
    parts.notify.replaceChildren(...(notify ? [notify] : []))
  }

  const statusSignature = `${message}|${messageIsError}`
  if (statusSignature !== signatures.status) {
    signatures = { ...signatures, status: statusSignature }
    parts.status.textContent = message
    parts.status.classList.toggle('error', messageIsError)
    parts.status.hidden = !message
  }

  const wanted = new Set(payload.items.map(cardKey))
  for (const [key, view] of cards) if (!wanted.has(key)) { view.element.remove(); cards.delete(key) }
  for (const item of payload.items) {
    const key = cardKey(item)
    let view = cards.get(key)
    if (!view) { view = buildCard(item); cards.set(key, view) }
    updateCard(view, item)
  }
  const listSignature = `${loaded}|${payload.items.map(cardKey).join(',')}`
  if (listSignature !== signatures.list) {
    signatures = { ...signatures, list: listSignature }
    const children: HTMLElement[] = payload.items.map((item) => cards.get(cardKey(item))!.element)
    if (!loaded) children.push(make('p', 'quiet-empty', 'Loading…'))
    else if (children.length === 0) children.push(make('p', 'quiet-empty', 'Nothing is waiting for you.'))
    parts.list.replaceChildren(...children)
  }

  const historySignature = payload.history.map((entry) => entry.id).join(',')
  if (historySignature !== signatures.history) {
    signatures = { ...signatures, history: historySignature }
    if (payload.history.length === 0) parts.history.replaceChildren()
    else {
      const section = make('section', 'approval-history')
      section.append(make('h2', '', 'Earlier today'))
      const entries = make('ul', 'history-list')
      entries.append(...payload.history.map(historyRow))
      section.append(entries)
      parts.history.replaceChildren(section)
    }
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
