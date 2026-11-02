import { AGENT_NAMES } from '../../shared/agents'
import { chatPhase, type ChatPhase } from '../../shared/chatLog'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { messageWithAttachments } from '../../shared/chatAttach'
import { hasFiles, droppedPaths } from '../fileDrop'
import { api } from '../api'
import { store } from '../state'
import { ChatAttachments } from './chatAttachments'
import { ChatFeed, LOADING, type FeedSnapshot } from './chatFeed'
import { BackgroundStrip } from './chatBackground'
import { ChatThread, type PendingView } from './chatThread'
import { askPromptFor } from '../../shared/menuPrompt'
import { detectTerminalMenu } from '../../shared/terminalMenu'
import { isStarting } from '../../shared/agentReady'
import { isTracked, newPending, pendingLabel, settlePending, type PendingMessage } from '../../shared/chatPending'
import { planAnswers, type AskAnswer, type KeyStep } from '../../shared/menuAnswer'
import type { AskPrompt } from '../../shared/chatAsk'

export interface ChatHost {
  showTerminal(): void
  continueIn(to: AgentKind): void
  send(text: string): { flattened: boolean }
  interrupt(): void
  /** The last rows on the agent's screen. */
  screenTail(): string
  answer(steps: KeyStep[]): void
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
  status: 'starting' | 'running' | 'exited'
  startedAt: number
  /** The pane's terminal tab: file links in the thread resolve against its folder. */
  tabId: string
}

const NEAR_BOTTOM_PX = 96
const MENU_CHECK_MS = 400
const WATCH_MS = 500
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
  private readonly sendButton = h('button', { class: 'chat-btn', type: 'button', hidden: true }, CHAT_TEXT.send)
  private readonly jump = h('button', { class: 'chat-jump', type: 'button', hidden: true }, CHAT_TEXT.jumpLatest)
  private readonly note = h('p', { class: 'chat-quiet', role: 'status', hidden: true })
  private readonly strip = new BackgroundStrip({ reveal: (task) => this.revealLaunch(task.launchId) })
  private readonly attachments = new ChatAttachments(() => this.showSend())
  private snapshot: FeedSnapshot = LOADING
  private input: ChatInput | null = null
  private phase: ChatPhase = 'empty'
  private limitDismissed = false
  private renderKey = ''
  private stickBottom = true
  private active = false
  private menuAt = 0
  private tail = ''
  private pending: PendingMessage[] = []
  private ask: AskPrompt | null = null
  private starting = false
  private watch = 0
  private counter = 0

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
      h('div', { class: 'chat-feedwrap' }, this.scroller, this.jump),
      this.strip.el,
      h('div', { class: 'chat-composer' }, this.note, this.attachments.el, h('div', { class: 'chat-box' }, this.box, this.sendButton))
    )
    this.box.addEventListener('keydown', (event) => this.onKey(event))
    this.box.addEventListener('input', () => {
      this.note.hidden = true
      this.growBox()
    })
    new ResizeObserver(() => this.input && this.updateComposer(this.input, this.phase)).observe(this.box)
    this.sendButton.addEventListener('click', () => this.submit())
    this.scroller.addEventListener('scroll', () => this.updateJump(), { passive: true })
    this.jump.addEventListener('click', () => {
      this.toBottom()
      this.updateJump()
    })
    this.box.addEventListener('paste', (event) => this.onPaste(event))
    this.watchDrops()
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
      this.setWatch(false)
      return
    }
    if (this.input && (this.input.agent !== input.agent || (this.input.sessionId && this.input.sessionId !== input.sessionId))) this.pending = []
    this.input = input
    this.attachments.setSession(input.sessionId ? { agent: input.agent, sessionId: input.sessionId } : null)
    if (input.sessionId) this.feed.start({ agent: input.agent, sessionId: input.sessionId, folder: input.folder })
    else this.feed.stop()
    if (!wasActive) this.stickBottom = true
    this.render(false)
  }

  focusComposer(): void {
    if (!this.box.disabled) this.box.focus()
  }

  dispose(): void {
    this.strip.dispose()
    this.setWatch(false)
    this.feed.stop()
    this.el.remove()
  }

  private currentSnapshot(): FeedSnapshot {
    if (this.input?.sessionId) return this.snapshot
    return { state: 'empty', items: [], earlier: 0, reason: '', background: [] }
  }

  private render(force: boolean): void {
    const input = this.input
    if (!input) return
    const snapshot = this.currentSnapshot()
    const tail = this.screenNow()
    const working = input.working && !input.exited
    const menuOpen = detectTerminalMenu(tail)
    const phase = chatPhase({ items: snapshot.items, working, needsApproval: input.needsApproval, menuOpen })
    this.starting = isStarting({ agent: input.agent, status: input.status, startedAt: input.startedAt, now: Date.now(), tail, working })
    this.flushWaiting(working)
    this.pending = settlePending(this.pending, snapshot.items, Date.now(), working)
    this.ask = phase === 'menu' ? askPromptFor(snapshot.items, tail) : null
    this.setWatch(this.starting || this.pending.length > 0)
    const views = this.pendingViews()
    const last = snapshot.items[snapshot.items.length - 1]
    if (last?.kind !== 'notice') this.limitDismissed = false
    const key = JSON.stringify([phase, this.limitDismissed, input.project, input.branch, input.exited, input.agent, this.starting, this.ask?.id ?? '', views])
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
      ask: this.ask,
      pending: views,
      starting: this.starting,
      background: snapshot.background,
      fileScope: input.tabId,
      session: input.sessionId ? { agent: input.agent, sessionId: input.sessionId } : null,
      actions: {
        showTerminal: () => this.host.showTerminal(),
        continueIn: (to) => this.host.continueIn(to),
        dismissLimit: () => this.dismissLimit(),
        answer: (answers) => this.answerAsk(answers)
      }
    })
    this.strip.update(snapshot.background)
    this.updateComposer(input, phase)
    if (!force && (this.stickBottom || wasNear)) this.toBottom()
    this.updateJump()
    if (!force) this.stickBottom = false
  }

  private renderedSnapshot: FeedSnapshot | null = null

  /** Opens the launch row's report and brings it into view. False when the thread no longer holds that row. */
  private revealLaunch(launchId: string): boolean {
    if (!this.thread.reveal(launchId)) return false
    const row = this.thread.el.querySelector<HTMLElement>(`[data-tool="${CSS.escape(launchId)}"]`)
    row?.scrollIntoView({ block: 'center' })
    row?.classList.add('flash')
    window.setTimeout(() => row?.classList.remove('flash'), 1200)
    return true
  }

  /** The screen is only read now and then: a menu stays up for seconds and reading it is not free. */
  private screenNow(): string {
    const now = Date.now()
    if (now - this.menuAt >= MENU_CHECK_MS) {
      this.menuAt = now
      this.tail = this.host.screenTail()
    }
    return this.tail
  }

  /** While the agent starts or a message waits to be seen in the log, nothing else triggers a redraw, so a timer does. */
  private setWatch(on: boolean): void {
    if (on === (this.watch !== 0)) return
    if (on) this.watch = window.setInterval(() => this.render(false), WATCH_MS)
    else {
      window.clearInterval(this.watch)
      this.watch = 0
    }
  }

  private pendingViews(): PendingView[] {
    return this.pending.map((message) => ({ id: message.id, text: message.text, label: pendingLabel(message) }))
  }

  /** Messages typed while the agent was starting go in as soon as its input box is up. */
  private flushWaiting(working: boolean): void {
    if (this.starting || !this.pending.some((message) => message.waiting)) return
    this.pending = this.pending.flatMap((message) => {
      if (!message.waiting) return [message]
      this.host.send(message.text)
      return isTracked(message.text) ? [{ ...message, waiting: false, queued: working, at: Date.now() }] : []
    })
  }

  private answerAsk(answers: readonly AskAnswer[]): void {
    const ask = this.ask
    if (ask) this.host.answer(planAnswers(ask.questions, answers))
  }

  private dismissLimit(): void {
    this.limitDismissed = true
    this.render(true)
  }

  private updateComposer(input: ChatInput, phase: ChatPhase): void {
    const name = AGENT_NAMES[input.agent]
    const blocked = input.exited ? CHAT_TEXT.composerEnded : phase === 'approval' ? CHAT_TEXT.composerApproval : phase === 'menu' ? (this.ask ? CHAT_TEXT.composerApproval : CHAT_TEXT.composerMenu) : ''
    const wasBlocked = this.box.disabled
    this.box.disabled = blocked !== ''
    this.sendButton.disabled = blocked !== ''
    this.showSend()
    if (wasBlocked && !this.box.disabled && this.active && this.focusIsFree()) this.focusComposer()
    const roomy = this.box.clientWidth >= LONG_HINT_MIN_PX
    this.box.placeholder = blocked || (this.starting ? CHAT_TEXT.composerStarting(name) : roomy ? CHAT_TEXT.messagePlaceholderLong(name) : CHAT_TEXT.messagePlaceholder(name))
    this.box.title = blocked || CHAT_TEXT.messageHint
  }

  /** Allow and Deny remove the button that had focus; the box takes it back unless the user has gone elsewhere. */
  private focusIsFree(): boolean {
    const focused = document.activeElement
    return !focused || focused === document.body || this.el.contains(focused)
  }

  private showSend(): void {
    this.sendButton.hidden = this.box.disabled || (this.box.value.trim() === '' && this.attachments.items.length === 0)
  }

  /** The button shows only when the thread is scrolled up and there is more below. */
  private updateJump(): void {
    this.jump.hidden = this.nearBottom() || this.scroller.scrollHeight <= this.scroller.clientHeight
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
    const typed = this.box.value
    if ((typed.trim() === '' && this.attachments.items.length === 0) || this.box.disabled) return
    const text = messageWithAttachments(this.input?.agent, this.attachments.items, typed, store.state.info.shellCommand)
    this.note.hidden = true
    if (this.starting) {
      this.pending = [...this.pending, newPending(`p${(this.counter += 1)}`, text.trim(), Date.now(), this.snapshot.items, true, false)]
    } else {
      const { flattened } = this.host.send(text)
      this.note.hidden = !flattened
      this.note.textContent = flattened ? CHAT_TEXT.flattened : ''
      if (isTracked(text)) {
        const working = (this.input?.working ?? false) && !this.input?.exited
        this.pending = [...this.pending, newPending(`p${(this.counter += 1)}`, text.trim(), Date.now(), this.snapshot.items, false, working)]
      }
    }
    this.box.value = ''
    this.attachments.clear()
    this.growBox()
    this.stickBottom = true
    this.feed.nudge()
    this.render(false)
  }

  /** A pasted picture or file becomes a chip; pasted text goes into the box as usual. */
  private onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length === 0) return
    event.preventDefault()
    const paths = files.map((file) => api.pathForFile(file)).filter((path) => path !== '')
    if (paths.length > 0) return this.attachments.add(paths)
    void api
      .readClipboard()
      .then((content) => {
        if (content.kind === 'image') this.attachments.add([content.path])
        else if (content.kind === 'text') this.box.setRangeText(content.text, this.box.selectionStart, this.box.selectionEnd, 'end')
      })
      .catch(() => {
        this.note.hidden = false
        this.note.textContent = CHAT_TEXT.pasteFailed
      })
  }

  /** Files dropped on the chat attach here and stop: the pane's own drop handler would type them into the terminal. */
  private watchDrops(): void {
    const mark = (on: boolean): void => {
      this.el.classList.toggle('file-drop', on)
    }
    this.el.addEventListener('dragover', (event) => {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      mark(true)
    })
    this.el.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !this.el.contains(event.relatedTarget as Node)) mark(false)
    })
    this.el.addEventListener('drop', (event) => {
      mark(false)
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (!this.box.disabled) this.attachments.add(droppedPaths(event.dataTransfer))
    })
  }

  private growBox(): void {
    this.box.style.height = 'auto'
    this.box.style.height = `${Math.min(this.box.scrollHeight, COMPOSER_MAX_PX)}px`
    this.box.style.overflowY = this.box.scrollHeight > COMPOSER_MAX_PX ? 'auto' : 'hidden'
    this.showSend()
  }
}
