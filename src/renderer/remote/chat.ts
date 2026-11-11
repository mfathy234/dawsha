import { REMOTE_CHAT_READ_ONLY, REMOTE_CHAT_SEND_MAX, type RemoteChatItem, type RemoteChatPayload } from '../../shared/remoteChat'
import './chat.css'

export interface ChatSession { id: string; label: string; agent: string }

export interface ChatHost {
  request<T>(path: string, init?: RequestInit): Promise<T>
  /** Running Claude and Codex sessions, in the order to list them. */
  sessions(): ChatSession[]
  preferred(): string | null
  canSend(): boolean
  /** Called after a send is refused, so permissions are read again. */
  refreshState(): void
  onUnpaired(): void
}

const POLL_MS = 2500
const GLYPHS: Record<string, string> = { create: '+', edit: '✎', shell: '▸', read: '◎', search: '⌕', web: '↗', agent: '◇', todo: '☰', mcp: '◇', question: '?', other: '·' }
const SENT_NOTE = 'Sent'

let host: ChatHost
let root: HTMLElement
let visible = false
let selected: string | null = null
let version: string | undefined
let payload: RemoteChatPayload | null = null
let timer = 0
let busy = false
let sentNote = false
let status = ''
let statusIsError = false
let draft = ''
let polling = false
let renderKey = ''

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

const pad = (value: number): string => String(value)

function paragraphs(text: string): HTMLElement[] {
  return text.split(/\n{2,}/).map((part) => make('p', '', part.trim())).filter((element) => element.textContent !== '')
}

function toolRow(item: Extract<RemoteChatItem, { k: 'tool' }>): HTMLElement {
  const row = make('div', 'ch-tool')
  row.append(make('span', 'ch-ic', GLYPHS[item.kind] ?? '·'), make('span', 'ch-verb', item.verb))
  if (item.target) row.append(make('code', 'ch-target', item.target))
  if (item.add) row.append(make('span', 'ch-add', `+${pad(item.add)}`))
  if (item.del) row.append(make('span', 'ch-del', `−${pad(item.del)}`))
  if (item.failed) row.append(make('span', 'ch-quiet', 'Failed'))
  else if (!item.done) row.append(make('span', 'ch-quiet', 'Running'))
  return row
}

function summaryCard(item: Extract<RemoteChatItem, { k: 'sum' }>): HTMLElement {
  const card = make('div', 'ch-sum')
  card.append(make('b', '', `Changed ${item.files} file${item.files === 1 ? '' : 's'}`), make('span', 'ch-add', `+${pad(item.add)}`), make('span', 'ch-del', `−${pad(item.del)}`))
  return card
}

function lineFor(item: RemoteChatItem): HTMLElement {
  if (item.k === 'you') return make('div', 'ch-you', item.text)
  if (item.k === 'say') { const say = make('div', 'ch-say'); say.append(...paragraphs(item.text)); return say }
  if (item.k === 'tool') return toolRow(item)
  if (item.k === 'sum') return summaryCard(item)
  return make('div', 'ch-quiet ch-note', item.text)
}

function threadBody(): HTMLElement {
  const thread = make('div', 'ch-thread')
  thread.tabIndex = 0
  thread.setAttribute('role', 'log')
  thread.setAttribute('aria-label', 'Conversation')
  thread.setAttribute('aria-live', 'polite')
  if (!payload || payload.status === 'none') {
    thread.append(make('p', 'ch-quiet ch-empty', payload ? 'Nothing here yet. The chat appears after the first message.' : 'Loading the chat…'))
    return thread
  }
  if (payload.status === 'failed') {
    thread.append(make('p', 'ch-quiet ch-empty', payload.reason))
    return thread
  }
  if (payload.status !== 'ok') return thread
  if (payload.earlier > 0) thread.append(make('p', 'ch-quiet ch-earlier', `${payload.earlier} earlier item${payload.earlier === 1 ? '' : 's'} on your PC`))
  for (const item of payload.items) thread.append(lineFor(item))
  if (sentNote) thread.append(make('div', 'ch-quiet ch-sent', SENT_NOTE))
  return thread
}

async function submit(input: HTMLTextAreaElement): Promise<void> {
  const text = input.value.trim()
  if (busy || !text || !selected) return
  busy = true
  status = ''
  render(true)
  try {
    await host.request('chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected, text }) })
    draft = ''
    sentNote = true
    version = undefined
    void poll()
  } catch (error) {
    const unpaired = error instanceof Error && 'status' in error && (error as { status?: number }).status === 401
    if (unpaired) { host.onUnpaired(); return }
    status = error instanceof Error ? error.message : 'Not sent. Try again.'
    statusIsError = true
    host.refreshState()
  } finally {
    busy = false
    render(true)
  }
}

function composer(): HTMLElement {
  if (!host.canSend()) {
    const note = make('div', 'ch-comp')
    note.append(make('p', 'ch-perm', REMOTE_CHAT_READ_ONLY))
    return note
  }
  const form = make('form', 'ch-comp')
  const box = make('div', 'ch-box')
  const input = make('textarea', 'ch-input')
  input.rows = 1
  input.maxLength = REMOTE_CHAT_SEND_MAX
  input.placeholder = 'Message…'
  input.setAttribute('aria-label', 'Message')
  input.setAttribute('enterkeyhint', 'send')
  input.value = draft
  input.dir = 'auto'
  const send = make('button', 'ch-send', '↑')
  send.type = 'submit'
  send.setAttribute('aria-label', 'Send message')
  send.disabled = busy
  const fit = (): void => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px` }
  input.addEventListener('input', () => { draft = input.value; fit() })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    void submit(input)
  })
  form.addEventListener('submit', (event) => { event.preventDefault(); void submit(input) })
  box.append(input, send)
  form.append(box)
  if (status) {
    const line = make('p', statusIsError ? 'ch-status error' : 'ch-status', status)
    line.setAttribute('role', 'status')
    form.prepend(line)
  }
  queueMicrotask(fit)
  return form
}

function header(sessions: ChatSession[]): HTMLElement {
  const bar = make('div', 'ch-head')
  if (sessions.length === 1) {
    bar.append(make('span', 'ch-title', sessions[0].label))
    return bar
  }
  const select = make('select', 'ch-select')
  select.setAttribute('aria-label', 'Session')
  for (const session of sessions) {
    const option = make('option', '', session.label)
    option.value = session.id
    option.selected = session.id === selected
    select.append(option)
  }
  select.addEventListener('change', () => { choose(select.value) })
  bar.append(select)
  return bar
}

function choose(id: string): void {
  selected = id
  version = undefined
  payload = null
  sentNote = false
  render(true)
  void poll()
}

function render(force = false): void {
  if (!root) return
  const sessions = host.sessions()
  if (!selected || !sessions.some((session) => session.id === selected)) {
    const next = sessions.find((session) => session.id === host.preferred())?.id ?? sessions[0]?.id ?? null
    if (next !== selected) { selected = next; version = undefined; payload = null; sentNote = false }
  }
  const key = JSON.stringify([selected, sessions.map((session) => session.id + session.label), host.canSend(), payload?.status === 'ok' ? payload.version : payload?.status, busy, status, sentNote])
  if (!force && key === renderKey) return
  renderKey = key
  if (!selected) {
    root.replaceChildren(make('p', 'ch-quiet ch-empty', 'No Claude or Codex session is running. Start one from Sessions.'))
    return
  }
  const thread = threadBody()
  const typing = root.querySelector<HTMLTextAreaElement>('.ch-input')
  const hadFocus = typing !== null && document.activeElement === typing
  const previous = root.querySelector<HTMLElement>('.ch-thread')
  const atEnd = !previous || previous.scrollHeight - previous.scrollTop - previous.clientHeight < 80
  root.replaceChildren(header(sessions), thread, composer())
  if (atEnd) thread.scrollTop = thread.scrollHeight
  else if (previous) thread.scrollTop = previous.scrollTop
  if (hadFocus) root.querySelector<HTMLTextAreaElement>('.ch-input')?.focus()
}

async function poll(): Promise<void> {
  if (polling || !visible || !selected || document.hidden) return
  polling = true
  const id = selected
  try {
    const query = `chat?id=${encodeURIComponent(id)}${version ? `&version=${encodeURIComponent(version)}` : ''}`
    const next = await host.request<RemoteChatPayload>(query)
    if (id !== selected) return
    if (next.status === 'unchanged') return
    if (next.status === 'ok') { version = next.version; sentNote = sentNote && !lastIsAgent(next) }
    else version = undefined
    payload = next
    render()
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 401) host.onUnpaired()
  } finally {
    polling = false
  }
}

function lastIsAgent(next: Extract<RemoteChatPayload, { status: 'ok' }>): boolean {
  const last = next.items.filter((item) => item.k === 'you' || item.k === 'say').at(-1)
  return last?.k === 'say'
}

function schedule(): void {
  window.clearInterval(timer)
  if (!visible) return
  timer = window.setInterval(() => void poll(), POLL_MS)
}

export function setChatVisible(value: boolean): void {
  if (visible === value) { if (value) render(); return }
  visible = value
  schedule()
  if (value) { render(true); void poll() }
}

export function refreshChat(): void {
  if (visible) { render(); void poll() }
}

export function initChat(options: { root: HTMLElement; host: ChatHost }): void {
  root = options.root
  host = options.host
  render(true)
}
