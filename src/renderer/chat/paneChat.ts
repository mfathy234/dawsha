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
import { holdPending, holdUntil, isTracked, newPending, pendingLabel, releaseHeld, removeHeld, settlePending, type PendingMessage } from '../../shared/chatPending'
import { appendHistory, historyAt } from '../../shared/chatHistory'
import { planAnswers, type AskAnswer, type KeyStep } from '../../shared/menuAnswer'
import type { AskPrompt } from '../../shared/chatAsk'
import { ChatComplete } from './chatComplete'
import { ChatFind } from './chatFind'
import { ChatWatches } from './chatWatches'
import { doneMessage, watchableMessageId } from '../../shared/chatNotify'
import { loadCheckpoints, prepareCheckpoint, undoReply } from './chatUndo'
import type { TurnSummary } from '../../shared/turnSummary'
import { ComposerBar } from './chatComposerBar'
import { LimitReminders } from './chatLimitSchedule'
import { limitSituation, sendsAtNote } from '../../shared/chatLimit'
import { toast } from '../components/toast'

export interface ChatHost {
  showTerminal(): void
  continueIn(to: AgentKind, message?: string | null): void
  send(text: string): { flattened: boolean }
  interrupt(): void
  /** The last rows on the agent's screen. */
  screenTail(): string
  answer(steps: KeyStep[]): void
  reviewChanges(): void
  /** A desktop notification that opens this pane when clicked. */
  notify(title: string, body: string): void
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
  /** How long the session has been working, for the line under the thread. */
  elapsed?: string
  /** The pane's terminal tab: file links in the thread resolve against its folder. */
  tabId: string
  /** The session's name, for the clear confirm. */
  title: string
  /** The model as the agent reports it, e.g. "Opus 5.5". */
  model: string | null
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number | null
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
  private readonly bar: ComposerBar
  private readonly reminders = new LimitReminders()
  private quiet: readonly string[] = []
  private quietSession = ''
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
  private history: string[] = []
  private historyIndex = -1
  private historyDraft = ''
  private checkpointRefs: Readonly<Record<string, string>> = {}
  private sendChain: Promise<unknown> = Promise.resolve()
  private checkpointSession = ''
  private historySession = ''
  private readonly completion: ChatComplete
  private readonly find: ChatFind
  private readonly watches: ChatWatches

  constructor(private readonly host: ChatHost, private readonly permission: HTMLElement) {
    this.thread = new ChatThread(() => this.render(true))
    this.feed = new ChatFeed(
      (snapshot) => {
        this.snapshot = snapshot
        void this.refreshCheckpoints()
        this.render(false)
      },
      () => this.el.offsetParent !== null
    )
    this.scroller.append(this.thread.el)
    this.completion = new ChatComplete(this.box, () => this.input?.folder ?? '', () => this.input?.agent ?? 'claude', () => store.state.settings.savedPrompts)
    this.find = new ChatFind({ thread: this.thread, items: () => this.snapshot.items, closed: () => this.focusComposer() })
    this.watches = new ChatWatches(() => this.phase, (ids) => this.announce(ids))
    this.bar = new ComposerBar({ command: (text) => this.sendCommand(text), announce: (text) => this.announceChange(text) }, this.sendButton)
    this.el = h(
      'div',
      { class: 'chat', hidden: true, role: 'region', 'aria-label': 'Chat' },
      h('div', { class: 'chat-feedwrap' }, this.scroller, this.jump, this.find.el),
      this.strip.el,
      h('div', { class: 'chat-composer' }, this.note, this.bar.note, this.attachments.el, h('div', { class: 'chat-box' }, this.box, this.bar.el))
    )
    this.el.querySelector('.chat-composer')?.insertBefore(this.completion.el, this.box.parentElement)
    this.box.addEventListener('keydown', (event) => this.onKey(event))
    this.box.addEventListener('input', () => {
      this.note.hidden = true
      this.updateSendButton()
      this.growBox()
      void this.completion.refresh().catch((error) => console.error('Chat completion failed', error))
    })
    new ResizeObserver(() => this.input && this.updateComposer(this.input, this.phase)).observe(this.box)
    this.sendButton.addEventListener('click', () => this.phase === 'working' && this.box.value.trim() === '' ? this.host.interrupt() : this.submit())
    this.scroller.addEventListener('scroll', () => this.updateJump(), { passive: true })
    this.jump.addEventListener('click', () => {
      this.toBottom()
      this.updateJump()
    })
    this.box.addEventListener('paste', (event) => this.onPaste(event))
    this.watchDrops()
    this.el.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        this.find.open()
        return
      }
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
    if (this.checkpointSession !== `${input.folder}:${input.sessionId ?? ''}`) {
      this.checkpointSession = `${input.folder}:${input.sessionId ?? ''}`
      this.checkpointRefs = {}
    }
    this.loadHistory(input.sessionId)
    this.refreshBar(input)
    this.attachments.setSession(input.sessionId ? { agent: input.agent, sessionId: input.sessionId } : null)
    if (input.sessionId) this.feed.start({ agent: input.agent, sessionId: input.sessionId, folder: input.folder })
    else this.feed.stop()
    if (!wasActive) this.stickBottom = true
    this.render(false)
  }

  /** The usage limit has stopped the session: the pane header says so. */
  get limitReached(): boolean {
    return this.active && this.phase === 'limit'
  }

  focusComposer(): void {
    if (!this.box.disabled) this.box.focus()
  }

  sendCommand(text: string): void {
    if (!this.input || this.input.exited || this.phase === 'approval' || this.phase === 'menu') return
    this.host.send(text)
    this.feed.nudge()
  }

  dispose(): void {
    this.watches.dispose()
    this.reminders.dispose()
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
    const release = releaseHeld(this.pending, working || input.exited, phase === 'approval', phase === 'menu')
    this.pending = release.pending
    if (release.message) {
      void this.deliver(release.message.text)
      this.note.hidden = true
    }
    this.pending = settlePending(this.pending, snapshot.items, Date.now(), working)
    this.ask = phase === 'menu' ? askPromptFor(snapshot.items, tail) : null
    this.setWatch(this.starting || this.pending.length > 0)
    this.feed.setPace(this.pending.length > 0 ? 'sending' : working ? 'working' : 'idle')
    const views = this.pendingViews()
    const last = snapshot.items[snapshot.items.length - 1]
    if (last?.kind !== 'notice') this.limitDismissed = false
    const situation = phase === 'limit' ? limitSituation(snapshot.items) : null
    const minute = situation ? Math.floor(Date.now() / 60_000) : 0
    const key = JSON.stringify([phase, minute, this.quiet, this.reminders.size, this.limitDismissed, input.project, input.branch, input.exited, input.agent, this.starting, this.ask?.id ?? '', input.elapsed ?? '', views, [...this.watches.watched]])
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
      elapsed: input.elapsed,
      background: snapshot.background,
      limit: situation ? { situation, now: Date.now(), scheduled: this.pending.some((message) => message.sendAt !== undefined), reminded: situation.resetsAt !== null && this.reminders.has(situation.resetsAt) } : undefined,
      quiet: this.quiet,
      bell: { messageId: watchableMessageId(snapshot.items, phase), watched: this.watches.watched, toggle: (id) => this.toggleWatch(id) },
      fileScope: input.tabId,
      checkpointRefs: this.checkpointRefs,
      session: input.sessionId ? { agent: input.agent, sessionId: input.sessionId } : null,
      actions: {
        showTerminal: () => this.host.showTerminal(),
        continueIn: (to, message) => this.host.continueIn(to, message),
        dismissLimit: () => this.dismissLimit(),
        answer: (answers) => this.answerAsk(answers),
        reviewChanges: () => this.host.reviewChanges(),
        undoReply: (summary) => this.undoReply(summary),
        limit: {
          continueIn: (to, message) => this.host.continueIn(to, message),
          sendAt: (text, at) => this.scheduleSend(text, at),
          notifyAt: (at) => this.remindAt(at)
        }
      }
    })
    this.strip.update(snapshot.background)
    this.find.sync()
    this.watches.check()
    this.updateComposer(input, phase)
    if (!force && (this.stickBottom || wasNear) && !this.find.searching) this.toBottom()
    this.updateJump()
    if (!force) this.stickBottom = false
  }

  /** Looks up the checkpoint of each user message in view, by message id, and redraws when the set changed. */
  private async refreshCheckpoints(): Promise<void> {
    const input = this.input
    if (!input?.sessionId) return
    const ids = this.snapshot.items.flatMap((item) => item.kind === 'message' && item.role === 'user' ? [item.id] : [])
    const refs = await loadCheckpoints(input.folder, input.sessionId, ids)
    if (this.input?.sessionId !== input.sessionId || JSON.stringify(refs) === JSON.stringify(this.checkpointRefs)) return
    this.checkpointRefs = refs
    this.render(true)
  }

  private refreshBar(input: ChatInput): void {
    const session = `${input.agent}:${input.sessionId ?? ''}`
    if (session !== this.quietSession) {
      this.quietSession = session
      this.quiet = []
    }
    this.bar.update({ ...input, working: input.working && !input.exited })
  }

  /** A quiet row in the thread for a model or effort change the log prints no row for. */
  private announceChange(text: string): void {
    this.quiet = [...this.quiet, text].slice(-3)
    this.render(true)
  }

  /** Keeps the message the limit stopped, and sends it once the limit has reset. */
  private scheduleSend(text: string, at: number): void {
    this.pending = holdUntil(this.pending, newPending(`p${(this.counter += 1)}`, text.trim(), Date.now(), this.snapshot.items, false, true), at)
    this.setWatch(true)
    this.render(true)
  }

  private remindAt(at: number): void {
    const input = this.input
    if (!input) return
    const name = AGENT_NAMES[input.agent]
    const shown = this.reminders.set(at, name, (title, body) => this.host.notify(title, body))
    toast(`You will get a notification at ${shown}, if Dawsha is still open.`, 'info')
    this.render(true)
  }

  private undoReply(summary: TurnSummary): void {
    const input = this.input
    if (!input?.sessionId) return
    const agentName = input.agent === 'claude' ? 'Claude' : 'Codex'
    void undoReply({ folder: input.folder, sessionId: input.sessionId, agentName, working: input.working && !input.exited }, summary)
  }

  /** Snapshots the project, then types the message into the terminal; sends keep their order. */
  private deliver(text: string): Promise<{ flattened: boolean }> {
    const sent = this.sendChain.then(async () => {
      if (isTracked(text) && this.input) await prepareCheckpoint(this.input.folder, this.input.sessionId)
      return this.host.send(text)
    })
    this.sendChain = sent.catch(() => undefined)
    return sent
  }

  private renderedSnapshot: FeedSnapshot | null = null

  private toggleWatch(id: string): void {
    this.watches.toggle(id)
    this.render(true)
  }

  /** The turns someone asked about have finished: tell them, even if Dawsha is in the background. */
  private announce(ids: readonly string[]): void {
    const input = this.input
    for (const id of ids) {
      const item = this.snapshot.items.find((entry) => entry.id === id)
      const text = item?.kind === 'message' ? item.text : ''
      if (!input) continue
      const message = doneMessage(AGENT_NAMES[input.agent], input.project, text)
      this.host.notify(message.title, message.body)
    }
    this.render(true)
  }

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
    return this.pending.map((message) => ({ id: message.id, text: message.text, label: pendingLabel(message), held: message.held, ...(message.held && message.sendAt !== undefined ? { note: sendsAtNote(message.sendAt) } : {}), edit: () => this.editHeld(message.id), cancel: () => this.cancelHeld(message.id) }))
  }

  /** Messages typed while the agent was starting go in as soon as its input box is up. */
  private flushWaiting(working: boolean): void {
    if (this.starting || !this.pending.some((message) => message.waiting)) return
    this.pending = this.pending.flatMap((message) => {
      if (!message.waiting) return [message]
      void this.deliver(message.text)
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
    this.updateSendButton()
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
    this.updateSendButton()
  }

  private updateSendButton(): void {
    const stopping = this.phase === 'working' && this.box.value.trim() === '' && this.attachments.items.length === 0
    this.sendButton.textContent = stopping ? CHAT_TEXT.stop : CHAT_TEXT.send
    this.sendButton.hidden = this.box.disabled || (!stopping && this.box.value.trim() === '' && this.attachments.items.length === 0)
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
    if (this.completion.handleKey(event)) return
    if (this.handleHistoryKey(event)) return
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    this.submit()
  }

  /** History keys stay isolated here so a composer popup can own them while open. */
  private handleHistoryKey(event: KeyboardEvent): boolean {
    if (this.completion.isOpen()) return false
    if (event.key === 'Escape' && this.historyIndex >= 0) {
      event.preventDefault()
      event.stopPropagation()
      this.box.value = this.historyDraft
      this.historyIndex = -1
      this.growBox()
      return true
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    const start = this.box.selectionStart
    if (event.key === 'ArrowUp' && this.box.value.slice(0, start).includes('\n')) return false
    if (event.key === 'ArrowDown' && this.box.value.slice(start).includes('\n')) return false
    if (!this.history.length) return false
    if (this.historyIndex < 0) this.historyDraft = this.box.value
    const result = historyAt(this.history, this.historyIndex, this.historyDraft, event.key === 'ArrowUp' ? -1 : 1)
    event.preventDefault()
    this.historyIndex = result.index
    this.box.value = result.value
    this.box.setSelectionRange(result.value.length, result.value.length)
    this.growBox()
    return true
  }

  private loadHistory(sessionId: string | null): void {
    const key = sessionId ?? ''
    if (key === this.historySession) return
    this.historySession = key
    this.historyIndex = -1
    try {
      const stored: unknown = key ? JSON.parse(localStorage.getItem(`chat-history:${key}`) ?? '[]') : []
      this.history = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string').slice(-50) : []
    } catch (error) {
      this.history = []
      console.warn('Could not read chat history.', error)
    }
  }

  private saveHistory(text: string): void {
    if (!this.historySession) return
    this.history = appendHistory(this.history, text)
    try { localStorage.setItem(`chat-history:${this.historySession}`, JSON.stringify(this.history)) } catch (error) { console.warn('Could not save chat history.', error) }
    this.historyIndex = -1
  }

  private editHeld(id: string): void {
    const message = this.pending.find((entry) => entry.id === id && entry.held)
    if (!message) return
    this.pending = removeHeld(this.pending, id)
    this.box.value = message.text
    this.box.focus()
    this.growBox()
    this.render(true)
  }

  private cancelHeld(id: string): void {
    this.pending = removeHeld(this.pending, id)
    this.render(true)
  }

  private submit(): void {
    const typed = this.box.value
    if ((typed.trim() === '' && this.attachments.items.length === 0) || this.box.disabled) return
    const text = messageWithAttachments(this.input?.agent, this.attachments.items, typed, store.state.info.shellCommand)
    this.saveHistory(text)
    this.note.hidden = true
    if (this.starting) {
      this.pending = [...this.pending, newPending(`p${(this.counter += 1)}`, text.trim(), Date.now(), this.snapshot.items, true, false)]
    } else if ((this.input?.working ?? false) && !this.input?.exited) {
      if (isTracked(text)) this.pending = holdPending(this.pending, newPending(`p${(this.counter += 1)}`, text.trim(), Date.now(), this.snapshot.items, false, true))
      else this.host.send(text)
    } else {
      void this.deliver(text).then(({ flattened }) => {
        this.note.hidden = !flattened
        this.note.textContent = flattened ? CHAT_TEXT.flattened : ''
      })
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
