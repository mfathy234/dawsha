import { choiceFromKey, INBOX_EMPTY, inboxSummary, moveSelection } from '../../shared/inbox'
import { AGENT_NAMES } from '../../shared/agents'
import { noteLine } from '../../shared/sessionCare'
import { focusPane, showView } from '../actions'
import { clear, h } from '../dom'
import { answerInbox, inboxItems, loadInboxDetail, type InboxDetail, type InboxItem } from '../inbox'
import { markRead } from '../sessionCare'
import { sendToSession } from '../sendToSession'
import { store, type AppState } from '../state'
import { isOverlayOpen } from '../overlayOpen'
import { identityMark } from './crewAvatar'
import { toast } from './toast'
import './inbox.css'

const DETAIL_MS = 3000

/** Every session that needs you or finished unseen, with a way to answer each without leaving the list. */
export class InboxViewComponent {
  readonly el = h('main', { class: 'inbox-view', 'aria-label': 'Inbox', hidden: true })
  private readonly title = h('h1', { class: 'inbox-title' }, 'Inbox')
  private readonly summary = h('span', { class: 'inbox-summary' })
  private readonly list = h('div', { class: 'inbox-list', role: 'listbox', 'aria-label': 'Sessions that need you' })
  private readonly keys = h('div', { class: 'inbox-keys' }, h('span', {}, '↑↓ move'), h('span', {}, '1–9 answer'), h('span', {}, 'Enter reply'), h('span', {}, 'E mark read'), h('span', {}, 'O open session'), h('span', {}, 'Esc close'))
  private readonly detail = h('div', { class: 'inbox-detail' })
  private readonly reply = h('input', { class: 'inbox-reply', type: 'text', placeholder: 'Or write a reply…', 'aria-label': 'Reply', autocomplete: 'off' })
  private readonly send = h('button', { class: 'btn primary inbox-send', type: 'button', disabled: true }, 'Send and next')
  private readonly replyRow = h('div', { class: 'inbox-reply-row' }, this.reply, this.send)
  private readonly empty = h('div', { class: 'inbox-empty' }, h('p', {}, INBOX_EMPTY))
  private readonly panel = h('section', { class: 'inbox-panel' }, this.detail, this.replyRow)
  private items: InboxItem[] = []
  private selected: string | null = null
  private visible = false
  private listKey = ''
  private detailKey = ''
  private details = new Map<string, { at: number; value: InboxDetail | null }>()
  private drafts = new Map<string, string>()
  private loading = false

  constructor() {
    this.el.append(h('div', { class: 'inbox-side' }, h('div', { class: 'inbox-head' }, this.title, this.summary), this.list, this.keys), this.panel, this.empty)
    this.send.addEventListener('click', () => this.sendReply())
    this.reply.addEventListener('input', () => {
      if (this.selected) this.drafts.set(this.selected, this.reply.value)
      this.send.disabled = this.reply.value.trim() === ''
    })
    document.addEventListener('keydown', this.onKey, true)
  }

  update(state: AppState): void {
    const visible = state.view === 'inbox'
    this.el.hidden = !visible
    if (visible !== this.visible) {
      this.visible = visible
      if (visible) {
        this.details.clear()
        this.selected = null
      }
    }
    if (!visible) return
    this.items = inboxItems(state)
    if (!this.selected || !this.items.some((item) => item.paneId === this.selected)) this.selected = this.items[0]?.paneId ?? null
    this.render()
    void this.refreshDetail()
  }

  private current(): InboxItem | undefined {
    return this.items.find((item) => item.paneId === this.selected)
  }

  private render(): void {
    const empty = this.items.length === 0
    this.summary.textContent = inboxSummary(this.items)
    this.panel.hidden = empty
    this.empty.hidden = !empty
    this.list.hidden = empty
    const listKey = JSON.stringify([this.selected, this.items.map((item) => [item.paneId, item.state, item.waitText, item.line, item.view.title, item.view.agent])])
    if (listKey !== this.listKey) {
      this.listKey = listKey
      clear(this.list)
      this.list.append(...this.items.map((item) => this.row(item)))
    }
    const item = this.current()
    const cached = item ? this.details.get(item.paneId)?.value ?? null : null
    const detailKey = JSON.stringify([item?.paneId, item?.state, item?.line, item?.question, item?.choices, item?.note, cached])
    if (detailKey !== this.detailKey) {
      this.detailKey = detailKey
      this.renderDetail(item, cached)
    }
    const draft = item ? (this.drafts.get(item.paneId) ?? '') : ''
    if (document.activeElement !== this.reply && this.reply.value !== draft) this.reply.value = draft
    this.send.disabled = this.reply.value.trim() === ''
  }

  private row(item: InboxItem): HTMLElement {
    const selected = item.paneId === this.selected
    return h('button', { class: `inbox-row${selected ? ' selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(selected), 'data-pane-id': item.paneId, onClick: () => this.select(item.paneId) },
      h('span', { class: 'inbox-row-head' }, identityMark(item.view, 18), h('span', { class: 'inbox-name', dir: 'auto' }, item.view.title), h('span', { class: 'inbox-project' }, item.view.project?.name ?? ''), h('span', { class: 'inbox-spacer' }), h('span', { class: `inbox-state state-${item.state}` }, item.waitText)),
      h('span', { class: 'inbox-line', dir: 'auto' }, item.line))
  }

  private renderDetail(item: InboxItem | undefined, detail: InboxDetail | null): void {
    clear(this.detail)
    if (!item) return
    const meta = [item.view.project?.name, item.view.branch, item.waitText.toLowerCase()].filter(Boolean).join(' · ')
    this.detail.append(h('div', { class: 'inbox-detail-head' }, identityMark(item.view, 22), h('span', { class: 'inbox-detail-name', dir: 'auto' }, item.view.title), h('span', { class: 'inbox-detail-meta' }, meta)))
    if (item.note) this.detail.append(h('div', { class: 'inbox-note', dir: 'auto' }, noteLine(item.view.pane.care?.note)))
    if (detail?.asked) this.detail.append(h('div', { class: 'inbox-asked', dir: 'auto' }, 'You asked: ', h('span', {}, detail.asked)))
    const excerpt = detail && detail.reply.length > 0 ? detail.reply : item.state === 'needs' ? [] : [item.line]
    if (excerpt.length > 0) this.detail.append(h('div', { class: 'inbox-reply-text', dir: 'auto' }, ...excerpt.map((line) => h('p', {}, line))))
    if (item.state === 'needs') this.detail.append(this.questionBlock(item))
    else this.detail.append(h('div', { class: 'inbox-actions' }, h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.markSelectedRead() }, 'Mark read'), h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.openSelected() }, 'Open session')))
  }

  private questionBlock(item: InboxItem): HTMLElement {
    const name = item.view.agent === 'shell' ? 'The session' : AGENT_NAMES[item.view.agent]
    const block = h('div', { class: 'inbox-question' }, h('div', { class: 'inbox-ask' }, `${name} is asking`))
    if (item.question) block.append(h('p', { class: 'inbox-ask-text', dir: 'auto' }, item.question))
    for (const choice of item.choices) {
      block.append(h('button', { class: 'inbox-choice', type: 'button', 'data-number': String(choice.number), onClick: () => this.answer(choice.number) }, h('span', { class: 'inbox-choice-n' }, String(choice.number)), h('span', { class: 'inbox-choice-label', dir: 'auto' }, choice.label)))
    }
    if (item.choices.length === 0) block.append(h('p', { class: 'inbox-hint' }, 'Write a reply below, or open the session to answer.'))
    return block
  }

  private async refreshDetail(): Promise<void> {
    const item = this.current()
    if (!item || this.loading) return
    const known = this.details.get(item.paneId)
    if (known && Date.now() - known.at < DETAIL_MS) return
    this.loading = true
    const paneId = item.paneId
    const value = await loadInboxDetail(paneId).catch(() => null)
    this.loading = false
    this.details.set(paneId, { at: Date.now(), value })
    if (this.visible) this.render()
  }

  private select(paneId: string): void {
    this.selected = paneId
    this.render()
    void this.refreshDetail()
  }

  private nextAfter(paneId: string): string | null {
    const ids = this.items.map((item) => item.paneId)
    const at = ids.indexOf(paneId)
    return ids[at + 1] ?? ids[at - 1] ?? null
  }

  private answer(number: number): void {
    const item = this.current()
    if (!item) return
    if (!answerInbox(item.paneId, number)) return toast('That request changed. Open the session to review it.')
    this.selected = this.nextAfter(item.paneId)
    this.render()
  }

  private sendReply(): void {
    const item = this.current()
    const text = this.reply.value.trim()
    if (!item || text === '') return
    const refusal = sendToSession(item.paneId, text)
    if (refusal) return toast(refusal)
    this.drafts.delete(item.paneId)
    this.reply.value = ''
    markRead(item.paneId)
    this.selected = this.nextAfter(item.paneId)
    this.render()
  }

  private markSelectedRead(): void {
    const item = this.current()
    if (!item) return
    markRead(item.paneId)
    this.selected = this.nextAfter(item.paneId)
    this.render()
  }

  private openSelected(): void {
    const item = this.current()
    if (!item) return
    markRead(item.paneId)
    focusPane(item.paneId)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.visible || store.state.view !== 'inbox' || event.isComposing || isOverlayOpen()) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const typing = document.activeElement === this.reply
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      showView('grid')
      return
    }
    if (typing) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      this.sendReply()
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    const consume = (): void => { event.preventDefault(); event.stopPropagation() }
    const ids = this.items.map((item) => item.paneId)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      consume()
      this.select(moveSelection(ids, this.selected, event.key === 'ArrowDown' ? 1 : -1) ?? '')
      return
    }
    const item = this.current()
    const number = item?.state === 'needs' ? choiceFromKey(event.key, item.choices.length) : null
    if (number !== null && item?.choices.some((choice) => choice.number === number)) {
      consume()
      this.answer(number)
    } else if (event.key === 'Enter') {
      consume()
      this.reply.focus()
    } else if (event.key.toLowerCase() === 'e') {
      consume()
      this.markSelectedRead()
    } else if (event.key.toLowerCase() === 'o') {
      consume()
      this.openSelected()
    }
  }
}
