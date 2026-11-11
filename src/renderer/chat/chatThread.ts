import { foldLines, textDirection, type ChatItem, type ChatMessage, type ChatNotice, type ChatPhase, type ChatTool } from '../../shared/chatLog'
import type { BackgroundTask } from '../../shared/chatBackground'
import { BACKGROUND_STATUS_TEXT } from './chatBackground'
import type { AgentKind } from '../../shared/types'
import type { ToolKind } from '../../shared/chatKind'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { stateIcon } from '../components/stateIcon'
import type { FeedSnapshot } from './chatFeed'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { richText } from './chatText'
import type { AskPrompt } from '../../shared/chatAsk'
import type { AskAnswer } from '../../shared/menuAnswer'
import type { PendingLabel } from '../../shared/chatPending'
import { AskCard } from './chatAsk'
import { imageStrip } from './chatImages'
import { answersCard, markdownCard, todoCard } from './chatCards'
import { copyButton } from './chatCopy'
import { dayLabel, dayStarts, fullTimeLabel, timeLabel } from '../../shared/chatTime'
import { renderDiff } from './chatDiffView'
import { linkifyChat, openFileButton } from './chatLinks'
import type { ChatSessionRef } from './chatImageCache'
import { turnSummaries } from '../../shared/turnSummary'
import { turnSummaryCard } from './chatTurnSummary'
import { groupMembership, groupTools, type ToolGroup } from '../../shared/chatGroups'
import { groupRow, workedByReply, workedLine } from './chatGroupRow'
import { bellButton, type BellView } from './chatBell'
import { workedLabel } from '../../shared/chatTiming'
import { limitCard, type LimitActions } from './chatLimitCard'
import type { LimitSituation } from '../../shared/chatLimit'

export interface ThreadActions {
  showTerminal(): void
  continueIn(to: AgentKind, message?: string | null): void
  dismissLimit(): void
  answer(answers: AskAnswer[]): void
  reviewChanges(): void
  undoReply(summary: import('../../shared/turnSummary').TurnSummary): void
  limit: LimitActions
}

export interface PendingView {
  id: string
  text: string
  label: PendingLabel
  held?: boolean
  /** Replaces the usual line under the message, e.g. "Sends at 15:40". */
  note?: string
  edit?: () => void
  cancel?: () => void
}

export interface ThreadContext {
  agentName: string
  otherAgent: AgentKind
  otherName: string
  project: string
  branch: string
  phase: ChatPhase
  limitDismissed: boolean
  permission: HTMLElement | null
  ask: AskPrompt | null
  pending: readonly PendingView[]
  starting: boolean
  /** How long the session has been working, e.g. "3m"; empty under a minute. */
  elapsed?: string
  /** Which session the thread shows, so its pictures can be fetched. */
  session: ChatSessionRef | null
  /** The id of the pane's terminal tab, which file links resolve their folder from. */
  fileScope: string | null
  /** Checkpoint ref per user message id. */
  checkpointRefs?: Readonly<Record<string, string>>
  /** The session's background work, so the row that launched each can say whether it still runs. */
  background?: readonly BackgroundTask[]
  /** The bell on a running turn's user message. */
  bell?: BellView
  /** What a usage limit stopped, for the card at the end of the thread. */
  limit?: { situation: LimitSituation; now: number; scheduled: boolean; reminded: boolean }
  /** Quiet centred rows after the log, e.g. "Model set to Sonnet". */
  quiet?: readonly string[]
  actions: ThreadActions
}

const TOOL_ICONS: Record<ToolKind, string> = {
  agent: ICONS.toolAgent,
  shell: ICONS.toolShell,
  edit: ICONS.toolEdit,
  create: ICONS.toolCreate,
  read: ICONS.toolRead,
  search: ICONS.toolSearch,
  web: ICONS.toolWeb,
  todo: ICONS.toolTodo,
  mcp: ICONS.toolMcp,
  question: ICONS.toolQuestion,
  other: ICONS.toolOther
}

const PRESENT: Record<string, string> = { Ran: 'Running', Edited: 'Editing', Created: 'Creating', Read: 'Reading', Searched: 'Searching', Deleted: 'Deleting', Used: 'Using' }

/** The verb of a row: present tense while it runs, so the row itself says what is happening. */
const verbOf = (item: ChatTool, running: boolean): string => (running ? (PRESENT[item.verb] ?? item.verb) : item.verb)

/** Draws the conversation. Everything from a log goes in as text, never as markup. */
export class ChatThread {
  readonly el = h('div', { class: 'chat-thread' })
  private readonly open = new Set<string>()
  private card: { id: string; card: AskCard } | null = null
  /** Which group each folded tool sits in, as of the last draw. */
  membership: ReadonlyMap<string, string> = new Map()

  constructor(private readonly rerender: () => void) {}

  render(feed: FeedSnapshot, ctx: ThreadContext): void {
    const children: (Node | null)[] =
      feed.state === 'failed' ? [this.failed(feed.reason, ctx)] : feed.state === 'loading' ? [h('p', { class: 'chat-quiet' }, CHAT_TEXT.reading)] : this.body(feed, ctx)
    this.el.replaceChildren(...children.filter((child): child is Node => child !== null))
    const scope = ctx.fileScope
    if (scope) this.el.querySelectorAll<HTMLElement>('.chat-say').forEach((reply) => linkifyChat(reply, scope))
  }

  private body(feed: FeedSnapshot, ctx: ThreadContext): (Node | null)[] {
    const bare = feed.items.length === 0 && ctx.pending.length === 0
    if (bare && ctx.phase !== 'approval' && ctx.phase !== 'menu' && !ctx.starting) return [this.empty(ctx)]
    return [feed.earlier > 0 ? h('p', { class: 'chat-quiet' }, CHAT_TEXT.earlier(feed.earlier)) : null, ...this.items(feed.items, ctx), ...ctx.pending.map((item) => this.pendingMessage(item)), ...(ctx.quiet ?? []).map((text) => h('p', { class: 'chat-quiet chat-set' }, text)), ...this.tail(ctx)]
  }

  private empty(ctx: ThreadContext): HTMLElement {
    const where = CHAT_TEXT.emptyWhere(ctx.project, ctx.branch)
    return h('div', { class: 'chat-empty' }, h('b', {}, CHAT_TEXT.emptyTitle(ctx.agentName)), where ? h('span', { dir: 'auto' }, `${where}.`) : null)
  }

  private failed(reason: string, ctx: ThreadContext): HTMLElement {
    return h(
      'div',
      { class: 'chat-notice', role: 'alert' },
      h('b', {}, CHAT_TEXT.failedTitle),
      h('span', { class: 'chat-quiet' }, reason),
      h('span', { class: 'chat-quiet' }, CHAT_TEXT.failedKept(ctx.agentName)),
      h('div', { class: 'chat-acts' }, this.button(CHAT_TEXT.showTerminal, ctx.actions.showTerminal, true))
    )
  }

  private items(items: readonly ChatItem[], ctx: ThreadContext): Node[] {
    const out: Node[] = []
    const summaries = new Map(turnSummaries(items, ctx.checkpointRefs).map((summary) => [summary.messageId, summary]))
    const timings = workedByReply(items)
    const lastUser = items.reduce((last, item, index) => item.kind === 'message' && item.role === 'user' ? index : last, -1)
    let tools: HTMLElement[] = []
    const flush = (): void => {
      if (tools.length === 0) return
      out.push(h('div', { class: 'chat-tools', dir: 'ltr' }, ...tools))
      tools = []
    }
    const starts = new Set(dayStarts(items.map((item) => item.at)))
    const entries = groupTools(items, starts)
    this.membership = groupMembership(entries)
    const live = ctx.phase === 'working' || ctx.phase === 'approval' || ctx.phase === 'menu'
    const now = Date.now()
    let index = 0
    for (const entry of entries) {
      const first = entry.type === 'group' ? entry.group.tools[0] : entry.item
      if (starts.has(index) && first.at !== undefined) {
        flush()
        out.push(h('div', { class: 'chat-day', role: 'separator' }, h('span', {}, dayLabel(first.at, now))))
      }
      if (entry.type === 'group') {
        tools.push(...this.group(entry.group, live, ctx))
        index += entry.group.tools.length
        continue
      }
      const item = entry.item
      index += 1
      if (item.kind === 'tool') {
        tools.push(...this.tool(item, live, ctx))
        continue
      }
      flush()
      out.push(item.kind === 'message' ? this.message(item, ctx) : this.notice(item, index === items.length, ctx))
      if (item.kind !== 'message' || item.role !== 'agent') continue
      const finished = !(index - 1 > lastUser && ctx.phase === 'working')
      const worked = finished && timings.has(item.id) ? workedLabel(timings.get(item.id)!) : undefined
      const summary = summaries.get(item.id)
      if (summary && finished && ctx.fileScope) out.push(turnSummaryCard(summary, ctx.fileScope, ctx.actions.reviewChanges, (value) => ctx.actions.undoReply(value), worked))
      else if (worked) out.push(workedLine(timings.get(item.id)!))
    }
    flush()
    return out
  }

  private group(group: ToolGroup, live: boolean, ctx: ThreadContext): HTMLElement[] {
    const opened = this.open.has(`g:${group.id}`)
    return groupRow(group, opened, opened ? group.tools.flatMap((tool) => this.tool(tool, live, ctx)) : [], (key) => this.flip(key))
  }

  /** Opens folds from outside (find in chat). Returns the keys that were closed before. */
  openKeys(keys: readonly string[]): string[] {
    const added = keys.filter((key) => !this.open.has(key))
    if (added.length === 0) return []
    added.forEach((key) => this.open.add(key))
    this.rerender()
    return added
  }

  closeKeys(keys: readonly string[]): void {
    const present = keys.filter((key) => this.open.has(key))
    if (present.length === 0) return
    present.forEach((key) => this.open.delete(key))
    this.rerender()
  }

  private message(item: ChatMessage, ctx: ThreadContext): HTMLElement {
    const folded = foldLines(item.text)
    const opened = this.open.has(`m:${item.id}`)
    const shown = opened || folded.hidden === 0 ? item.text : folded.head
    const body = h('div', { class: item.role === 'user' ? 'chat-you' : 'chat-say', dir: textDirection(item.text), 'data-role': item.role }, ...richText(shown))
    if (folded.hidden > 0) body.append(this.toggle(`m:${item.id}`, opened ? CHAT_TEXT.showLess : CHAT_TEXT.showMore(folded.hidden), 'chat-more'))
    const pictures = imageStrip(item.images, ctx.session)
    if (pictures) body.append(pictures)
    if (item.truncated) body.append(h('p', { class: 'chat-quiet' }, CHAT_TEXT.truncatedNote))
    if (item.text !== '') body.append(copyButton(() => item.text))
    const bell = item.role === 'user' ? bellButton(item.id, ctx.bell) : null
    if (bell) body.append(bell)
    if (item.at !== undefined) body.append(h('time', { class: 'chat-time', datetime: new Date(item.at).toISOString(), title: fullTimeLabel(item.at), 'data-time': timeLabel(item.at) }))
    return body
  }

  /** Opens a launch row's report. True when the row is in the thread. */
  reveal(id: string): boolean {
    if (!this.el.querySelector(`[data-tool="${CSS.escape(id)}"]`)) return false
    this.open.add(`t:${id}`)
    this.rerender()
    return true
  }

  private tool(item: ChatTool, live: boolean, ctx: ThreadContext): HTMLElement[] {
    const expanded = this.open.has(`t:${item.id}`)
    const task = ctx.background?.find((entry) => entry.launchId === item.id)
    const row = h(
      'button',
      { class: `chat-tool${item.failed ? ' failed' : ''}${!item.done && live ? ' running' : ''}`, 'data-kind': item.activity, type: 'button', 'aria-expanded': String(expanded), title: item.command ?? item.target, 'data-tool': item.id, onClick: () => this.flip(`t:${item.id}`) },
      icon(!item.done && live ? ICONS.toolRunning : TOOL_ICONS[item.activity] ?? ICONS.toolOther),
      h('span', {}, verbOf(item, !item.done && live)),
      item.described ? h('bdi', { dir: 'auto' }, h('span', { class: 'chat-tool-desc' }, item.target)) : h('bdi', { dir: 'ltr' }, h('code', {}, item.target)),
      item.done && !task ? this.toolNote(item) : null,
      task ? h('span', { class: `chat-badge ${task.status}`, 'data-bg-badge': task.status }, BACKGROUND_STATUS_TEXT[task.status]) : null
    )
    const pictures = imageStrip(item.images, ctx.session)
    const line = item.path && ctx.fileScope ? h('div', { class: 'chat-toolrow' }, row, openFileButton(ctx.fileScope, { path: item.path, ...(item.line ? { line: item.line } : {}) })) : row
    const always = [item.todos ? todoCard(item.todos) : null, item.answers ? answersCard(item.answers) : null, pictures]
    return [line, ...[...always, ...(expanded ? [this.toolDetail(item, task)] : [])].filter((node): node is HTMLElement => node !== null)]
  }

  /** What an opened tool row shows: its change, its plan or report as markdown, or the plain output. */
  private toolDetail(item: ChatTool, task?: BackgroundTask): HTMLElement {
    if (task) return markdownCard(task.resultPreview ?? (task.status === 'running' ? BACKGROUND_STATUS_TEXT.running : task.summary ?? CHAT_TEXT.backgroundNoResult))
    if (item.diff) {
      const key = `d:${item.id}`
      return renderDiff(item.diff, { open: this.open.has(key), toggle: () => this.flip(key) })
    }
    if (item.plan) return markdownCard(item.plan)
    if (item.activity === 'agent' && item.output !== '') return markdownCard(item.outputTruncated ? `${item.output}\n\n${CHAT_TEXT.outputTooLarge}` : item.output)
    const out = item.output === '' ? CHAT_TEXT.noOutput : item.output
    const text = item.command ? [`$ ${item.command}`, out].join('\n\n') : out
    return h('pre', { class: 'chat-toolout', dir: 'ltr' }, item.outputTruncated ? `${text}\n${CHAT_TEXT.outputTooLarge}` : text)
  }

  private toolNote(item: ChatTool): HTMLElement | null {
    const parts: Node[] = []
    if (item.added) parts.push(h('span', { class: 'add' }, `+${item.added}`))
    if (item.removed) parts.push(h('span', { class: 'del' }, `-${item.removed}`))
    if (item.note) parts.push(document.createTextNode(item.note))
    if (parts.length === 0) return null
    return h('bdi', { class: 'n', dir: 'ltr' }, ...parts.flatMap((part, index) => (index > 0 ? [document.createTextNode(' '), part] : [part])))
  }

  private notice(item: ChatNotice, last: boolean, ctx: ThreadContext): HTMLElement {
    if (item.notice === 'interrupted') return h('p', { class: 'chat-quiet' }, item.text)
    if (item.notice === 'compact') return this.compacted(item)
    if (item.notice === 'limit' && last && ctx.phase === 'limit' && ctx.limit) return limitCard({ agentName: ctx.agentName, otherAgent: ctx.otherAgent, otherName: ctx.otherName, ...ctx.limit, actions: ctx.actions.limit })
    return h('div', { class: 'chat-notice' }, h('b', { dir: 'auto' }, item.text))
  }

  /** A compaction: one quiet line, with the summary it left folded away. */
  private compacted(item: ChatNotice): HTMLElement {
    const key = `n:${item.id}`
    const opened = this.open.has(key)
    return h(
      'div',
      { class: 'chat-compact' },
      h('p', { class: 'chat-quiet' }, item.text),
      item.detail ? this.toggle(key, opened ? CHAT_TEXT.hideSummary : CHAT_TEXT.showSummary, 'chat-more') : null,
      item.detail && opened ? h('div', { class: 'chat-say', dir: textDirection(item.detail) }, ...richText(item.detail)) : null
    )
  }

  private tail(ctx: ThreadContext): (Node | null)[] {
    if (ctx.phase === 'approval') return [ctx.permission]
    if (ctx.phase === 'menu' && ctx.ask) return [this.askCard(ctx.ask, ctx)]
    if (ctx.phase === 'menu') {
      return [
        h(
          'div',
          { class: 'chat-notice' },
          h('b', {}, CHAT_TEXT.menuTitle(ctx.agentName)),
          h('span', { class: 'chat-quiet' }, CHAT_TEXT.menuNext),
          h('div', { class: 'chat-acts' }, this.button(CHAT_TEXT.showTerminal, ctx.actions.showTerminal, true))
        )
      ]
    }
    if (ctx.starting) {
      return [h('div', { class: 'chat-working', role: 'status' }, icon(ICONS.toolRunning), h('span', { dir: 'auto' }, `${CHAT_TEXT.starting(ctx.agentName)} ${ctx.pending.length > 0 ? CHAT_TEXT.startingWait : ''}`.trim()))]
    }
    if (ctx.phase === 'working') {
      return [h('div', { class: 'chat-working', role: 'status' }, stateIcon('working'), h('span', { dir: 'auto' }, CHAT_TEXT.workingFor(ctx.elapsed)), h('span', { class: 'chat-hint' }, CHAT_TEXT.interruptHint))]
    }
    return []
  }

  /** The card is kept while its question stays up, so a choice made in it survives the thread being drawn again. */
  private askCard(prompt: AskPrompt, ctx: ThreadContext): HTMLElement {
    if (this.card?.id !== prompt.id) {
      this.card = { id: prompt.id, card: new AskCard(prompt, ctx.agentName, { send: (answers) => ctx.actions.answer(answers), showTerminal: () => ctx.actions.showTerminal() }) }
    }
    return this.card.card.el
  }

  private pendingMessage(item: PendingView): HTMLElement {
    const note = item.note ?? (item.label === 'queued' ? CHAT_TEXT.queued : item.label === 'waiting' ? CHAT_TEXT.waitingToStart : CHAT_TEXT.sending)
    return h('div', { class: 'chat-you pending', 'data-pending': item.label, dir: textDirection(item.text) }, ...richText(item.text), h('span', { class: 'chat-pend', role: 'status' }, note), item.held ? h('span', { class: 'chat-pend-actions' }, h('button', { class: 'chat-text-btn', type: 'button', onClick: item.edit }, CHAT_TEXT.edit), h('button', { class: 'chat-text-btn', type: 'button', onClick: item.cancel }, CHAT_TEXT.cancel)) : null)
  }

  private button(label: string, onClick: () => void, primary: boolean): HTMLElement {
    return h('button', { class: `chat-btn${primary ? ' primary' : ''}`, type: 'button', onClick }, label)
  }

  private toggle(key: string, label: string, cls: string): HTMLElement {
    return h('button', { class: cls, type: 'button', onClick: () => this.flip(key) }, label)
  }

  private flip(key: string): void {
    if (this.open.has(key)) this.open.delete(key)
    else this.open.add(key)
    this.rerender()
  }
}
