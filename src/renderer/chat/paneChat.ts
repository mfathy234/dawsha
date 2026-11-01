import { AGENT_NAMES } from '../../shared/agents'
import { chatPhase, type ChatPhase } from '../../shared/chatLog'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { ChatFeed, LOADING, type FeedSnapshot } from './chatFeed'
import { ChatThread } from './chatThread'

export interface ChatHost {
  showTerminal(): void
  continueIn(to: AgentKind): void
  send(text: string): void
  interrupt(): void
  menuOpen(): boolean
}

export interface ChatInput {
  agent: AgentKind
  sessionId: string | null
  folder: string
  project: string
  branch: string
  working: boolean
  needsApproval: boolean
  exited: boolean
}

const NEAR_BOTTOM_PX = 96
const MENU_CHECK_MS = 400
const COMPOSER_MAX_PX = 140
const LONG_HINT_MIN_PX = 380

const other = (agent: AgentKind): AgentKind => (agent === 'claude' ? 'codex' : 'claude')

/** One pane's Chat view: the session log drawn as a conversation, with a box that types into the same terminal. */
export class PaneChat {
  readonly el: HTMLElement
  private readonly scroller = h('div', { class: 'chat-scroll' })
  private readonly feed: ChatFeed
  private readonly thread: ChatThread
  private readonly box = h('textarea', { class: 'chat-input', rows: 1, 'aria-label': 'Message', dir: 'auto', spellcheck: 'false' })
  private readonly sendButton = h('button', { class: 'chat-btn', type: 'button' }, CHAT_TEXT.send)
  private snapshot: FeedSnapshot = LOADING
  private input: ChatInput | null = null
  private phase: ChatPhase = 'empty'
  private limitDismissed = false
  private renderKey = ''
  private stickBottom = true
  private active = false
  private menuAt = 0
  private menuOpen = false

  constructor(private readonly host: ChatHost, private readonly permission: HTMLElement) {
    this.thread = new ChatThread(() => this.render(true))
    this.feed = new ChatFeed(
      (snapshot) => {
        this.snapshot = snapshot
        this.render(false)
      },
      () => this.el.offsetParent !== null
    )
    this.scroller.append(this.thread.el)
    this.el = h(
      'div',
      { class: 'chat', hidden: true, role: 'region', 'aria-label': 'Chat' },
      this.scroller,
      h('div', { class: 'chat-composer' }, h('div', { class: 'chat-box' }, this.box, this.sendButton))
    )
    this.box.addEventListener('keydown', (event) => this.onKey(event))
    this.box.addEventListener('input', () => this.growBox())
    new ResizeObserver(() => this.input && this.updateComposer(this.input, this.phase)).observe(this.box)
    this.sendButton.addEventListener('click', () => this.submit())
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.phase === 'working') {
        event.preventDefault()
        this.host.interrupt()
      }
    })
  }

  /** The approval card sits in the thread while chat is on screen and a permission is asked. */
  get holdsPermission(): boolean {
    return this.active && this.phase === 'approval'
  }

  update(input: ChatInput | null): void {
    const wasActive = this.active
    this.active = input !== null
    this.el.hidden = input === null
    if (!input) {
      this.input = null
      this.feed.stop()
      this.renderKey = ''
      return
    }
    this.input = input
    if (input.sessionId) this.feed.start({ agent: input.agent, sessionId: input.sessionId, folder: input.folder })
    else this.feed.stop()
    if (!wasActive) this.stickBottom = true
    this.render(false)
  }

  focusComposer(): void {
    if (!this.box.disabled) this.box.focus()
  }

  dispose(): void {
    this.feed.stop()
    this.el.remove()
  }

  private currentSnapshot(): FeedSnapshot {
    if (this.input?.sessionId) return this.snapshot
    return { state: 'empty', items: [], earlier: 0, reason: '' }
  }

  private render(force: boolean): void {
    const input = this.input
    if (!input) return
    const snapshot = this.currentSnapshot()
    const menuOpen = this.menuNow()
    const phase = chatPhase({ items: snapshot.items, working: input.working && !input.exited, needsApproval: input.needsApproval, menuOpen })
    const last = snapshot.items[snapshot.items.length - 1]
    if (last?.kind !== 'notice') this.limitDismissed = false
    const key = JSON.stringify([phase, this.limitDismissed, input.project, input.branch, input.exited, input.agent])
    if (!force && snapshot === this.renderedSnapshot && key === this.renderKey) return
    this.renderedSnapshot = snapshot
    this.renderKey = key
    this.phase = phase
    const wasNear = this.nearBottom()
    this.thread.render(snapshot, {
      agentName: AGENT_NAMES[input.agent],
      otherAgent: other(input.agent),
      otherName: AGENT_NAMES[other(input.agent)],
      project: input.project,
      branch: input.branch,
      phase,
      limitDismissed: this.limitDismissed,
      permission: this.permission,
      actions: { showTerminal: () => this.host.showTerminal(), continueIn: (to) => this.host.continueIn(to), dismissLimit: () => this.dismissLimit() }
    })
    this.updateComposer(input, phase)
    if (this.stickBottom || wasNear) this.toBottom()
    this.stickBottom = false
  }

  private renderedSnapshot: FeedSnapshot | null = null

  /** The screen is only read now and then: a menu stays up for seconds and reading it is not free. */
  private menuNow(): boolean {
    const now = Date.now()
    if (now - this.menuAt >= MENU_CHECK_MS) {
      this.menuAt = now
      this.menuOpen = this.host.menuOpen()
    }
    return this.menuOpen
  }

  private dismissLimit(): void {
    this.limitDismissed = true
    this.render(true)
  }

  private updateComposer(input: ChatInput, phase: ChatPhase): void {
    const name = AGENT_NAMES[input.agent]
    const blocked = input.exited ? CHAT_TEXT.composerEnded : phase === 'approval' ? CHAT_TEXT.composerApproval : phase === 'menu' ? CHAT_TEXT.composerMenu : ''
    this.box.disabled = blocked !== ''
    this.sendButton.disabled = blocked !== ''
    const roomy = this.box.clientWidth >= LONG_HINT_MIN_PX
    this.box.placeholder = blocked || (roomy ? CHAT_TEXT.messagePlaceholderLong(name) : CHAT_TEXT.messagePlaceholder(name))
    this.box.title = blocked || CHAT_TEXT.messageHint
  }

  private nearBottom(): boolean {
    const el = this.scroller
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  private toBottom(): void {
    this.scroller.scrollTop = this.scroller.scrollHeight
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    this.submit()
  }

  private submit(): void {
    const text = this.box.value
    if (text.trim() === '' || this.box.disabled) return
    this.host.send(text)
    this.box.value = ''
    this.growBox()
    this.stickBottom = true
    this.feed.nudge()
  }

  private growBox(): void {
    this.box.style.height = 'auto'
    this.box.style.height = `${Math.min(this.box.scrollHeight, COMPOSER_MAX_PX)}px`
    this.box.style.overflowY = this.box.scrollHeight > COMPOSER_MAX_PX ? 'auto' : 'hidden'
  }
}
