import { changesLabel, MINI_SEND_MAX } from '../../shared/miniDetail'
import type { MiniSession } from '../../shared/miniWindow'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { spinner, spinPhase } from './motion'
import { PermissionBlock, ProgressBar, setText, tile, tileKey, type MiniHost } from './parts'

const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M6 11l6-6 6 6"/></svg>'
const SENT_MS = 2000
const MAX_ROWS_PX = 96

export const drafts = new Map<string, string>()

function section(label: string, body: HTMLElement): { el: HTMLElement; body: HTMLElement } {
  return { el: h('div', { class: 'mini-block', hidden: true }, h('span', { class: 'mini-label' }, label), body), body }
}

/** The reply box at the bottom of the detail: Enter sends, Shift+Enter starts a new line. */
class Composer {
  readonly el: HTMLFormElement
  private readonly area = h('textarea', { class: 'mini-input', rows: 1, dir: 'auto', 'aria-label': 'Message this session', placeholder: 'Message this session', maxlength: MINI_SEND_MAX, enterkeyhint: 'send' })
  private readonly note = h('span', { class: 'mini-compose-note', role: 'status' })
  private readonly button = h('button', { type: 'submit', class: 'mini-send', 'aria-label': 'Send message', title: 'Send message' }, icon(SEND_ICON))
  private reason = ''
  private sent = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly session: () => MiniSession, private readonly host: MiniHost, private readonly paneId: string) {
    this.area.value = drafts.get(paneId) ?? ''
    this.el = h('form', { class: 'mini-compose' }, h('div', { class: 'mini-compose-row' }, this.area, this.button), this.note)
    this.el.addEventListener('submit', (event) => { event.preventDefault(); this.send() })
    this.area.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      this.send()
    })
    this.area.addEventListener('input', () => { drafts.set(paneId, this.area.value); this.grow() })
    queueMicrotask(() => this.grow())
  }

  private grow(): void {
    this.area.style.height = 'auto'
    this.area.style.height = `${Math.min(this.area.scrollHeight, MAX_ROWS_PX)}px`
    this.area.style.overflowY = this.area.scrollHeight > MAX_ROWS_PX ? 'auto' : 'hidden'
  }

  private send(): void {
    const text = this.area.value.trim()
    if (text === '' || this.reason !== '') return
    this.host.send(this.session(), text)
    this.area.value = ''
    drafts.delete(this.paneId)
    this.grow()
    this.sent = true
    this.render()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.sent = false; this.render() }, SENT_MS)
  }

  update(session: MiniSession): void {
    this.reason = session.state === 'needs' ? 'Answer the request above first.' : session.state === 'exited' ? 'This session has exited.' : ''
    this.render()
  }

  private render(): void {
    this.area.disabled = this.reason !== ''
    this.button.disabled = this.reason !== ''
    setText(this.note, this.sent ? 'Sent' : this.reason)
    this.note.hidden = !this.sent && this.reason === ''
  }

  dispose(): void { clearTimeout(this.timer) }
}

/** A session's detail. It stays while its session is selected, so typing and focus survive every update. */
export class DetailView {
  readonly el = h('section', { class: 'mini-detail' })
  private session: MiniSession
  private readonly tileSlot = h('span', { class: 'mini-tile-slot' })
  private readonly title = h('h1', { dir: 'auto' })
  private readonly project = h('span', { class: 'mini-project', dir: 'auto' })
  private readonly spin = spinner()
  private readonly nowText = h('span', { dir: 'auto' })
  private readonly nowLine = h('div', { class: 'mini-now mini-line', role: 'status' }, this.spin, this.nowText)
  private readonly permission: PermissionBlock
  private readonly asked = section('You asked', h('p', { class: 'mini-clamp mini-asked', dir: 'auto' }))
  private readonly reply = section('Last reply', h('p', { class: 'mini-clamp mini-reply', dir: 'auto' }))
  private readonly changesLabel = h('span', { dir: 'ltr' })
  private readonly review = h('button', { type: 'button', class: 'mini-review', onClick: () => this.host.review(this.session) }, 'Review')
  private readonly changes = h('div', { class: 'mini-changes', hidden: true }, this.changesLabel, this.review)
  private readonly progress = new ProgressBar()
  private readonly steps = h('ol', { class: 'mini-plan', 'aria-label': 'Plan', hidden: true })
  private readonly usage = h('div', { class: 'mini-usage', hidden: true })
  private readonly output = h('pre', { dir: 'auto' })
  private readonly composer: Composer
  private tiles = ''
  private stepsKey = ''

  constructor(session: MiniSession, private readonly host: MiniHost) {
    this.session = session
    this.permission = new PermissionBlock(host)
    this.composer = new Composer(() => this.session, host, session.paneId)
    this.el.dataset.paneId = session.paneId
    this.el.append(
      h('div', { class: 'mini-detail-title' }, this.tileSlot, h('div', { class: 'mini-info' }, this.title, this.project)),
      this.nowLine, this.permission.el, this.asked.el, this.reply.el, this.changes, this.progress.el, this.steps, this.usage,
      h('div', { class: 'mini-terminal' }, h('span', { class: 'mini-terminal-label' }, icon(ICONS.terminal), 'Terminal'), this.output),
      this.composer.el)
    this.update(session)
  }

  update(session: MiniSession): void {
    this.session = session
    this.el.dataset.state = session.state
    const key = tileKey(session)
    if (key !== this.tiles) { this.tiles = key; this.tileSlot.replaceChildren(tile(session, 48)) }
    setText(this.title, session.title)
    setText(this.project, session.project)
    this.project.hidden = session.project === ''
    setText(this.nowText, session.now)
    this.spin.hidden = session.state !== 'working'
    this.permission.update(session)
    this.fillBlock(this.asked, session.asked ? [session.asked] : [])
    this.fillBlock(this.reply, session.reply)
    this.changes.hidden = !session.changes
    if (session.changes) setText(this.changesLabel, changesLabel(session.changes))
    this.progress.update(session.plan)
    this.drawSteps(session)
    this.usage.hidden = session.usage === ''
    setText(this.usage, session.usage)
    setText(this.output, session.tail.join('\n') || 'No output yet')
    this.composer.update(session)
  }

  private fillBlock(part: { el: HTMLElement; body: HTMLElement }, lines: readonly string[]): void {
    part.el.hidden = lines.length === 0
    setText(part.body, lines.join('\n'))
  }

  private drawSteps(session: MiniSession): void {
    const items = session.plan?.items ?? []
    this.steps.hidden = items.length === 0
    const key = JSON.stringify(items)
    if (key === this.stepsKey) return
    this.stepsKey = key
    const phase = spinPhase()
    this.steps.replaceChildren(...items.map(item =>
      h('li', { 'data-status': item.status },
        h('span', { class: 'mini-step', role: 'img', style: `--phase:${phase}`, 'aria-label': item.status === 'completed' ? 'Done' : item.status === 'in_progress' ? 'In progress' : 'Not started' },
          item.status === 'completed' ? icon(ICONS.check) : ''),
        h('span', { dir: 'auto' }, item.text))))
  }

  dispose(): void {
    this.composer.dispose()
  }
}
