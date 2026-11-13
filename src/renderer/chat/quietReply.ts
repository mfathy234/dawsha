import { AGENT_NAMES } from '../../shared/agents'
import type { ChatItem } from '../../shared/chatLog'
import { latestTodos, planProgress } from '../../shared/planProgress'
import { lastReplySummary, lastReplyWords } from '../../shared/quietReply'
import { turnSummaries, type TurnSummary } from '../../shared/turnSummary'
import type { AgentKind } from '../../shared/types'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { sessionNote, setSessionNote } from '../sessionNotes'
import { ChatFeed, LOADING, type FeedSnapshot } from './chatFeed'
import { loadCheckpoints, undoReply } from './chatUndo'
import { replyContext, TurnExtras, type TurnInput } from './turnExtras'
import './quietReply.css'

export interface QuietReplyInput {
  agent: AgentKind
  sessionId: string | null
  folder: string
  branch: string
  projectId: string | null
  /** The pane's terminal tab: file links in the commit card resolve against its folder. */
  tabId: string
  working: boolean
  exited: boolean
}

export interface QuietReplyHost {
  review(): void
  /** Types a message to the agent. False when it cannot take one now. */
  send(text: string): boolean
  /** The plan changed, so the pane header can redraw. */
  planChanged(): void
  /** Whether the pane is on screen, so a hidden pane does not read its log. */
  onScreen(): boolean
}

const lastAgentMessageId = (items: readonly ChatItem[]): string | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'message' && item.role === 'agent') return item.id
  }
  return null
}

/**
 * The Quiet pane's line under the terminal: what the last reply changed, with Review, Commit this reply and Undo.
 * It reads the same session log and uses the same summary data, commit box and undo as the Chat view's summary card.
 * The log is read only while the terminal is what the pane shows; Chat reads it itself otherwise.
 */
export class QuietReply {
  readonly el = h('div', { class: 'pane-reply', role: 'group', 'aria-label': 'Last reply', hidden: true })
  private readonly feed: ChatFeed
  private readonly turns: TurnExtras
  private readonly pop = h('div', { class: 'pane-reply-pop', role: 'dialog', 'aria-label': 'Commit this reply', hidden: true })
  private snapshot: FeedSnapshot = LOADING
  private input: QuietReplyInput | null = null
  private refs: Readonly<Record<string, string>> = {}
  private refsSession = ''
  private signature = ''

  constructor(private readonly paneId: string, private readonly host: QuietReplyHost) {
    this.turns = new TurnExtras({ input: () => this.turnInput(), send: (text) => this.host.send(text), changed: () => this.draw() })
    this.feed = new ChatFeed((snapshot) => {
      this.snapshot = snapshot
      void this.refreshRefs()
      this.draw()
    }, () => this.host.onScreen())
    this.pop.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.closePop()
    })
    document.addEventListener('pointerdown', this.outside, true)
  }

  private readonly outside = (event: Event): void => {
    if (this.pop.hidden || this.el.contains(event.target as Node)) return
    this.closePop()
  }

  /** Null when the terminal is not what the pane shows, or the agent has no chat log. */
  update(input: QuietReplyInput | null): void {
    this.input = input
    if (!input) {
      this.feed.stop()
      this.snapshot = LOADING
      this.signature = ''
      this.el.hidden = true
      this.closePop()
      return
    }
    this.turns.begin(`${input.agent}:${input.sessionId ?? ''}`, false, [])
    if (input.sessionId) this.feed.start({ agent: input.agent, sessionId: input.sessionId, folder: input.folder })
    else this.feed.stop()
    this.feed.setPace(input.working ? 'working' : 'idle')
    this.draw()
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.turns.dispose()
    this.feed.stop()
    this.el.remove()
  }

  private turnInput(): TurnInput | null {
    const input = this.input
    if (!input) return null
    return { folder: input.folder, sessionId: input.sessionId, projectId: input.projectId, agentName: AGENT_NAMES[input.agent], branch: input.branch }
  }

  private async refreshRefs(): Promise<void> {
    const input = this.input
    if (!input?.sessionId) return
    const session = `${input.folder}:${input.sessionId}`
    if (session !== this.refsSession) {
      this.refsSession = session
      this.refs = {}
    }
    const ids = this.snapshot.items.flatMap((item) => (item.kind === 'message' && item.role === 'user' ? [item.id] : []))
    const found = await loadCheckpoints(input.folder, input.sessionId, ids)
    if (this.input?.sessionId !== input.sessionId || JSON.stringify(found) === JSON.stringify(this.refs)) return
    this.refs = found
    this.draw()
  }

  private current(): { summary: TurnSummary | null; reply: ChatItem | null } {
    const items = this.snapshot.items
    const summary = lastReplySummary(turnSummaries(items, this.refs), lastAgentMessageId(items))
    return { summary, reply: summary ? (items.find((item) => item.id === summary.messageId) ?? null) : null }
  }

  private draw(): void {
    const input = this.input
    if (!input) return
    this.publishPlan()
    const { summary } = this.current()
    const commit = summary ? this.turns.commitOf(summary.messageId) : { phase: 'closed' as const }
    const signature = JSON.stringify([summary, commit.phase, commit.phase === 'done' ? commit.hash : '', input.working, input.exited, Boolean(input.sessionId)])
    this.el.hidden = false
    if (signature === this.signature) return
    this.signature = signature
    if (!summary) {
      this.closePop()
      this.el.replaceChildren(h('span', { class: 'pane-reply-none' }, 'No changes yet'))
      return
    }
    this.el.replaceChildren(this.line(summary, commit), this.actions(summary, commit), this.pop)
  }

  private line(summary: TurnSummary, commit: ReturnType<TurnExtras['commitOf']>): HTMLElement {
    return h('span', { class: 'pane-reply-line' },
      icon(ICONS.toolEdit),
      h('span', { class: 'pane-reply-words' }, lastReplyWords(summary)),
      h('span', { class: 'add' }, `+${summary.added}`),
      h('span', { class: 'del' }, `−${summary.removed}`),
      commit.phase === 'done' ? h('span', { class: 'pane-reply-done', role: 'status' }, 'Committed ', h('span', { class: 'mono' }, commit.hash)) : null)
  }

  private actions(summary: TurnSummary, commit: ReturnType<TurnExtras['commitOf']>): HTMLElement {
    const input = this.input
    const committed = commit.phase === 'done'
    const canCommit = !!input?.sessionId && input.folder !== '' && !committed
    const canUndo = !!summary.checkpointRef && !committed
    const button = (label: string, run: () => void, extra = '', aria?: string): HTMLElement =>
      h('button', { class: `pane-reply-btn${extra}`, type: 'button', onClick: run, ...(aria ? { 'aria-label': aria } : {}) }, label)
    return h('span', { class: 'pane-reply-actions' },
      button('Review', () => this.host.review()),
      canCommit ? button('Commit this reply', () => this.openCommit(summary), '', `Commit this reply: ${summary.files.length} files`) : null,
      canUndo ? button('Undo', () => this.undo(summary), '', `Undo this reply: ${summary.files.length} files`) : null)
  }

  private openCommit(summary: TurnSummary): void {
    const { reply } = this.current()
    const input = this.input
    if (!input || !reply) return
    const items = this.snapshot.items
    const card = this.turns.card(summary, { scope: input.tabId, review: () => this.host.review(), undo: (value) => this.undo(value), ...replyContext(items, summary, reply) })
    this.pop.replaceChildren(card)
    this.pop.hidden = false
    this.turns.startCommit(summary.messageId)
    window.setTimeout(() => this.pop.querySelector<HTMLElement>('.turn-commit-box')?.focus(), 0)
  }

  private closePop(): void {
    if (this.pop.hidden) return
    this.pop.hidden = true
    this.pop.replaceChildren()
  }

  private undo(summary: TurnSummary): void {
    const input = this.input
    if (!input?.sessionId) return
    void undoReply({ folder: input.folder, sessionId: input.sessionId, agentName: AGENT_NAMES[input.agent], working: input.working && !input.exited }, summary)
  }

  private publishPlan(): void {
    const input = this.input
    if (!input?.sessionId || this.snapshot.state === 'loading') return
    const plan = planProgress(latestTodos(this.snapshot.items))
    const label = plan?.label ?? ''
    const now = plan?.current ?? ''
    const known = sessionNote(this.paneId)
    if (known.plan === label && known.planNow === now) return
    setSessionNote(this.paneId, { plan: label, planNow: now })
    this.host.planChanged()
  }
}
