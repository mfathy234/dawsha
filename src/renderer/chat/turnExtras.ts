import type { ChatItem } from '../../shared/chatLog'
import type { CheckRunUpdate } from '../../shared/turnChecks'
import { failureMessage, failedChecks, isConfigured, isFailureMessage, shouldAutoSend, checksFinished } from '../../shared/turnChecks'
import { editedSince, parseTurnDiff } from '../../shared/turnDiff'
import type { TurnSummary } from '../../shared/turnSummary'
import { api } from '../api'
import { toast } from '../components/toast'
import { h } from '../dom'
import { openInFiles, openFolderInFiles, requestFilesCommand } from '../files/filesActions'
import { store } from '../state'
import { turnSummaryCard } from './chatTurnSummary'
import { openCommitBox, pushCommitted, submitCommit, type CommitPort } from './turnCommitFlow'
import { showFullOutput } from './turnChecks'
import { emptyCard, type CardActions, type CardState, type ChecksState, type DiffEntry } from './turnState'

const PR_TAB_DELAY_MS = 400

export interface TurnInput {
  folder: string
  sessionId: string | null
  projectId: string | null
  agentName: string
  branch: string
}

export interface TurnHost {
  input(): TurnInput | null
  /** Types a message to the agent. False when it cannot take one now. */
  send(text: string): boolean
}

/** What the thread knows about one reply that the card needs. */
export interface CardArgs {
  scope: string
  review: () => void
  undo: (summary: TurnSummary) => void
  worked?: string
  repliedAt?: number
  request: string
  reply: string
}

/** The request, the reply's text and when it was written, for a summary card. */
export function replyContext(items: readonly ChatItem[], summary: TurnSummary, reply: ChatItem): Pick<CardArgs, 'request' | 'reply' | 'repliedAt'> {
  const asked = items.find((item) => item.kind === 'message' && item.role === 'user' && item.id === summary.userMessageId)
  return {
    request: asked?.kind === 'message' ? asked.text : '',
    reply: reply.kind === 'message' ? reply.text : '',
    repliedAt: reply.at
  }
}

interface Entry {
  summary: TurnSummary
  args: CardArgs
  state: CardState
  el: HTMLElement | null
  /** The same card drawn in the Side panel, when it shows this reply. */
  panelEl: HTMLElement | null
  box: HTMLTextAreaElement
  runId: string | null
}

/**
 * The state and actions behind the summary cards of one chat: open diffs, the commit box and the checks that run
 * after a reply. Cards redraw themselves in place, so a thread redraw never loses what was typed or opened.
 */
export class TurnExtras {
  private readonly entries = new Map<string, Entry>()
  private known = new Set<string>()
  private seeded = false
  private sawWorking = false
  private trigger: string | null = null
  private streak = 0
  private sessionKey = ''
  private sessionId: string | null = null
  private readonly stop: () => void

  constructor(private readonly host: TurnHost) {
    this.stop = api.turn.onChecksUpdate((update) => this.onUpdate(update))
  }

  /** Called on every thread draw with the summaries in order. A reply that finishes after one was seen working gets its checks. */
  begin(sessionKey: string, working: boolean, ids: readonly string[]): void {
    if (sessionKey !== this.sessionKey) this.reset(sessionKey)
    if (!this.seeded) {
      this.seeded = true
      this.known = new Set(ids)
      this.sawWorking = working
      return
    }
    if (working) {
      this.sawWorking = true
      return
    }
    const last = ids[ids.length - 1]
    if (this.sawWorking && last && !this.known.has(last)) this.trigger = last
    this.sawWorking = false
    this.known = new Set(ids)
  }

  card(summary: TurnSummary, args: CardArgs): HTMLElement {
    const entry = this.entryFor(summary, args)
    if (this.trigger === summary.messageId) {
      this.trigger = null
      void this.startChecks(entry)
    }
    // Starting the checks may already have changed the entry.
    return this.build(this.entries.get(summary.messageId) ?? entry)
  }

  dispose(): void {
    this.stop()
    const sessionId = this.sessionId ?? this.host.input()?.sessionId
    if (sessionId) void api.turn.stopChecks(sessionId).catch(() => undefined)
    this.entries.clear()
  }

  private reset(sessionKey: string): void {
    if (this.sessionId) void api.turn.stopChecks(this.sessionId).catch(() => undefined)
    this.sessionId = this.host.input()?.sessionId ?? null
    this.sessionKey = sessionKey
    this.entries.clear()
    this.known = new Set()
    this.seeded = false
    this.sawWorking = false
    this.trigger = null
    this.streak = 0
  }

  private entryFor(summary: TurnSummary, args: CardArgs): Entry {
    const old = this.entries.get(summary.messageId)
    const entry: Entry = old
      ? { ...old, summary, args }
      : { summary, args, state: emptyCard(), el: null, panelEl: null, runId: null, box: this.newBox(summary.messageId) }
    this.entries.set(summary.messageId, entry)
    // The snapshot is looked up after the card first shows; diffs that were waiting for it load now.
    if (old && !old.summary.checkpointRef && summary.checkpointRef) for (const path of old.state.expanded) void this.loadDiff(summary.messageId, path)
    return entry
  }

  private newBox(id: string): HTMLTextAreaElement {
    const box = h('textarea', { class: 'turn-commit-box', rows: 2, 'aria-label': 'Commit message', spellcheck: 'false', dir: 'auto' })
    box.addEventListener('input', () => this.redrawIn(id, true))
    return box
  }

  /** The card of the latest reply for the Side panel; kept in step with the one in the thread. */
  panelCard(): { id: string; el: HTMLElement; files: number } | null {
    const last = [...this.entries.values()].pop()
    if (!last) return null
    const id = last.summary.messageId
    const files = last.summary.files.length
    if (last.panelEl?.isConnected) return { id, el: last.panelEl, files }
    const el = this.draw(last)
    this.entries.set(id, { ...(this.entries.get(id) ?? last), panelEl: el })
    return { id, el, files }
  }

  latestChecks(): ChecksState | null {
    return [...this.entries.values()].pop()?.state.checks ?? null
  }

  /** Runs the checks again for the latest reply. */
  rerunChecks(): void {
    const last = [...this.entries.values()].pop()
    if (last) void this.startChecks(last)
  }

  showLatestOutput(): void {
    const checks = this.latestChecks()
    if (checks) showFullOutput(checks)
  }

  private build(entry: Entry): HTMLElement {
    const el = this.draw(entry)
    this.entries.set(entry.summary.messageId, { ...(this.entries.get(entry.summary.messageId) ?? entry), el })
    return el
  }

  private draw(entry: Entry): HTMLElement {
    const input = this.host.input()
    const id = entry.summary.messageId
    return turnSummaryCard(entry.summary, entry.args.scope, entry.args.review, entry.args.undo, entry.args.worked, {
      state: entry.state,
      actions: this.actions(id),
      agentName: input?.agentName ?? 'the agent',
      canCommit: !!input?.sessionId && !!input.folder,
      box: entry.box
    })
  }

  private patch(id: string, change: Partial<CardState>): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.set(id, { ...entry, state: { ...entry.state, ...change } })
    this.redrawIn(id, false)
  }

  /** Swaps one card for a fresh draw, keeping the commit box's focus and caret. */
  private redrawIn(id: string, keepFocusOnly: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const surfaces = [entry.el, entry.panelEl].filter((el): el is HTMLElement => el?.isConnected === true)
    if (surfaces.length === 0) return
    if (keepFocusOnly) {
      // Typing only changes the Commit button's state; the box itself stays where it is.
      const commit = entry.state.commit
      for (const el of surfaces) {
        const button = el.querySelector<HTMLButtonElement>('.turn-commit-foot .primary')
        if (button && commit.phase === 'editing') button.disabled = entry.box.value.trim() === '' || !commit.rows.some((row) => row.ticked)
      }
      return
    }
    const focused = document.activeElement === entry.box
    const start = entry.box.selectionStart
    const end = entry.box.selectionEnd
    const redrawn = { ...entry }
    for (const el of surfaces) {
      const next = this.draw(entry)
      el.replaceWith(next)
      if (el === entry.el) redrawn.el = next
      else redrawn.panelEl = next
    }
    this.entries.set(id, { ...(this.entries.get(id) ?? entry), el: redrawn.el, panelEl: redrawn.panelEl })
    if (focused) {
      entry.box.focus()
      entry.box.setSelectionRange(start, end)
    }
  }

  private port(id: string): CommitPort | null {
    const entry = this.entries.get(id)
    const input = this.host.input()
    if (!entry || !input) return null
    return {
      summary: entry.summary, folder: input.folder, branch: input.branch, repliedAt: entry.args.repliedAt, request: entry.args.request, reply: entry.args.reply,
      box: entry.box, state: () => this.entries.get(id)?.state ?? entry.state, patch: (change) => this.patch(id, change)
    }
  }

  private actions(id: string): CardActions {
    const input = (): TurnInput | null => this.host.input()
    const guarded = (run: (port: CommitPort) => void | Promise<void>) => (): void => {
      const port = this.port(id)
      if (port) void run(port)
    }
    return {
      toggleFile: (path) => this.toggleFile(id, path),
      showAll: (path) => this.setDiff(id, path, (entry) => (entry.status === 'ready' ? { ...entry, open: true } : entry)),
      openFile: (path) => this.openFile(path),
      review: () => this.entries.get(id)?.args.review(),
      startCommit: guarded((port) => openCommitBox(port)),
      cancelCommit: () => this.patch(id, { commit: { phase: 'closed' } }),
      tick: (path, on) => this.tick(id, path, on),
      submitCommit: guarded((port) => submitCommit(port)),
      push: () => {
        const state = this.entries.get(id)?.state.commit
        const now = input()
        if (now && state?.phase === 'done') void pushCommitted(now.folder, state.branch)
      },
      openPullRequest: () => this.openPullRequest(),
      sendFailures: () => this.sendFailures(id),
      showOutput: () => {
        const checks = this.entries.get(id)?.state.checks
        if (checks) showFullOutput(checks)
      }
    }
  }

  private tick(id: string, path: string, on: boolean): void {
    const commit = this.entries.get(id)?.state.commit
    if (commit?.phase !== 'editing') return
    this.patch(id, { commit: { ...commit, rows: commit.rows.map((row) => (row.path === path ? { ...row, ticked: on } : row)) } })
  }

  private setDiff(id: string, path: string, change: (entry: DiffEntry) => DiffEntry): void {
    const state = this.entries.get(id)?.state
    const current = state?.diffs.get(path)
    if (!state || !current) return
    this.patch(id, { diffs: new Map(state.diffs).set(path, change(current)) })
  }

  private toggleFile(id: string, path: string): void {
    const state = this.entries.get(id)?.state
    if (!state) return
    const expanded = new Set(state.expanded)
    if (expanded.delete(path)) return this.patch(id, { expanded })
    expanded.add(path)
    this.patch(id, { expanded })
    // Opened again, a file is read again: it may have changed since.
    void this.loadDiff(id, path)
  }

  private async loadDiff(id: string, path: string): Promise<void> {
    const entry = this.entries.get(id)
    const input = this.host.input()
    const put = (value: DiffEntry): void => {
      const state = this.entries.get(id)?.state
      if (state) this.patch(id, { diffs: new Map(state.diffs).set(path, value) })
    }
    if (!entry || !input?.sessionId) return
    if (!entry.summary.checkpointRef) return put({ status: 'error', error: 'This reply has no snapshot to compare with.' })
    if (entry.state.diffs.get(path)?.status !== 'ready') put({ status: 'loading' })
    const result = await api.turn.fileDiff({ folder: input.folder, sessionId: input.sessionId, ref: entry.summary.checkpointRef, path }).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) return put({ status: 'error', error: result.error })
    const before = this.entries.get(id)?.state.diffs.get(path)
    put({ status: 'ready', diff: parseTurnDiff(result.text), changedSince: editedSince(result.mtimeMs, entry.args.repliedAt), open: before?.status === 'ready' && before.open })
  }

  private openFile(path: string): void {
    const input = this.host.input()
    if (input?.projectId) openInFiles({ projectId: input.projectId, folder: input.folder }, path, { pin: true })
  }

  private openPullRequest(): void {
    const input = this.host.input()
    if (!input?.projectId) return
    openFolderInFiles({ projectId: input.projectId, folder: input.folder })
    window.setTimeout(() => requestFilesCommand('show-pr'), PR_TAB_DELAY_MS)
  }

  private async startChecks(entry: Entry): Promise<void> {
    const input = this.host.input()
    const config = input?.projectId ? store.state.settings.turnChecks?.[input.projectId] : undefined
    if (!input?.sessionId || !input.projectId || !isConfigured(config)) return
    const id = entry.summary.messageId
    if (!isFailureMessage(entry.args.request)) this.streak = 0
    this.patch(id, { checks: { results: [], done: false, sent: false } })
    const result = await api.turn.runChecks({ folder: input.folder, projectId: input.projectId, sessionId: input.sessionId, commandIds: config.commandIds }).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) {
      this.patch(id, { checks: null })
      return void toast(result.error, 'error')
    }
    const now = this.entries.get(id)
    if (now) this.entries.set(id, { ...now, runId: result.runId })
  }

  private onUpdate(update: CheckRunUpdate): void {
    const found = [...this.entries.entries()].find(([, entry]) => entry.runId === update.runId)
    if (!found) return
    const [id, entry] = found
    this.patch(id, { checks: { results: update.results, done: update.done, sent: entry.state.checks?.sent ?? false } })
    if (update.done && checksFinished(update.results)) this.finished(id, update)
  }

  private finished(id: string, update: CheckRunUpdate): void {
    const failed = failedChecks(update.results)
    if (failed.length === 0) {
      this.streak = 0
      return
    }
    const input = this.host.input()
    const config = input?.projectId ? store.state.settings.turnChecks?.[input.projectId] : undefined
    if (!shouldAutoSend(config, failed.length, this.streak)) return
    this.streak += 1
    this.sendFailures(id)
  }

  private sendFailures(id: string): void {
    const checks = this.entries.get(id)?.state.checks
    if (!checks || failedChecks(checks.results).length === 0) return
    const name = this.host.input()?.agentName ?? 'The agent'
    if (!this.host.send(failureMessage(checks.results))) return void toast(`${name} cannot take a message right now.`, 'error')
    this.patch(id, { checks: { ...checks, sent: true } })
  }
}
