import type { ChatItem } from '../../shared/chatLog'
import { timeLabel } from '../../shared/chatTime'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import { api } from '../api'
import { toast } from '../components/toast'
import { EditBox } from './chatEditResend'
import { previewRewind, redoRewind, rewindToMessage, type RewindDone, type RewindTarget } from './chatRewindFlow'
import { compareTries, tryAnotherWay } from './chatTryAgain'
import type { RewindView } from './chatRewindView'
import type { ChatInput } from './paneChat'

export interface RewindDeps {
  input(): ChatInput | null
  items(): readonly ChatItem[]
  refs(): Readonly<Record<string, string>>
  rerender(): void
  /** Sends text through the chat's normal send path. */
  resend(text: string): void
}

type Mark = RewindDone & { throughId: string | null }

interface Editing {
  id: string
  box: EditBox
  fresh: boolean
}

const userMessage = (items: readonly ChatItem[], id: string): (ChatItem & { kind: 'message' }) | undefined => {
  const found = items.find((item) => item.kind === 'message' && item.role === 'user' && item.id === id)
  return found?.kind === 'message' ? found : undefined
}

/** Rewind, Edit and Try another way for one pane's chat: the state they share and what each click does. */
export class ChatRewind {
  private readonly marks = new Map<string, Mark>()
  private editing: Editing | null = null
  private editingSession = ''

  constructor(private readonly deps: RewindDeps) {}

  /** Part of the thread's redraw key, so a rewind or an edit redraws it. */
  key(): string {
    const input = this.deps.input()
    const mark = this.mark()
    return JSON.stringify([mark?.messageId ?? '', mark?.count ?? 0, this.editing?.id ?? '', input?.triedFrom?.title ?? ''])
  }

  /** Called after each redraw of the thread. */
  afterRender(): void {
    const editing = this.editing
    if (!editing) return
    editing.box.settle(editing.fresh)
    editing.fresh = false
  }

  view(): RewindView | undefined {
    const input = this.deps.input()
    if (!input?.sessionId) return undefined
    this.dropStale(input.sessionId)
    const mark = this.mark()
    const items = this.deps.items()
    const at = mark ? userMessage(items, mark.messageId)?.at : undefined
    return {
      working: input.working && !input.exited,
      hasSnapshot: (id) => this.deps.refs()[id] !== undefined,
      edit: (id) => void this.startEdit(id),
      rewind: (id) => void this.rewind(id),
      tryAgain: (id) => void this.tryAgain(id),
      copy: (id) => this.copy(id),
      editing: this.editing ? { id: this.editing.id, el: this.editing.box.el } : null,
      mark: mark ? { messageId: mark.messageId, time: at === undefined ? null : timeLabel(at), count: mark.count, redo: () => void this.redo() } : null,
      tried: input.triedFrom ? { ...input.triedFrom, at: input.triedFrom.at, compare: compareTries } : null
    }
  }

  private target(): (RewindTarget & { input: ChatInput }) | null {
    const input = this.deps.input()
    if (!input?.sessionId) return null
    return { input, folder: input.folder, sessionId: input.sessionId, working: input.working && !input.exited }
  }

  private mark(): Mark | undefined {
    const session = this.deps.input()?.sessionId
    return session ? this.marks.get(session) : undefined
  }

  /** A rewind stays offered until you send something new; a conversation that moved on keeps no Redo. */
  private dropStale(session: string): void {
    if (this.editingSession !== session) {
      this.editing = null
      this.editingSession = session
    }
    const mark = this.marks.get(session)
    if (!mark) return
    const items = this.deps.items()
    const at = mark.throughId ? items.findIndex((item) => item.id === mark.throughId) : -1
    const later = at >= 0 ? items.slice(at + 1) : items
    if (userMessage(items, mark.messageId) === undefined || later.some((item) => item.kind === 'message' && item.role === 'user')) this.marks.delete(session)
  }

  private snapshotOf(id: string): string | null {
    return this.deps.refs()[id] ?? null
  }

  private async rewind(id: string): Promise<void> {
    const target = this.target()
    const ref = this.snapshotOf(id)
    if (!target || !ref) return
    if (target.working) return void toast(REWIND_TEXT.stopFirst, 'error')
    const items = this.deps.items()
    const done = await rewindToMessage(target, items, id, ref, { confirm: true })
    if (!done || done.count === 0) return
    const last = items[items.length - 1]
    this.marks.set(target.sessionId, { ...done, throughId: last?.id ?? null })
    this.deps.rerender()
  }

  private async redo(): Promise<void> {
    const target = this.target()
    const mark = this.mark()
    if (!target || !mark || !(await redoRewind(target, mark))) return
    this.marks.delete(target.sessionId)
    this.deps.rerender()
  }

  private async startEdit(id: string): Promise<void> {
    const target = this.target()
    const ref = this.snapshotOf(id)
    const item = userMessage(this.deps.items(), id)
    if (!target || !ref || !item) return
    if (target.working) return void toast(REWIND_TEXT.stopFirst, 'error')
    const preview = await previewRewind(target, this.deps.items(), id, ref)
    if (!preview) return
    const box = new EditBox({ messageId: id, text: item.text, paths: preview.put.map((row) => row.path), cancel: () => this.stopEdit(), send: (text) => void this.sendEdit(id, text) })
    this.editing = { id, box, fresh: true }
    this.editingSession = target.sessionId
    this.deps.rerender()
  }

  private stopEdit(): void {
    this.editing = null
    this.deps.rerender()
  }

  private async sendEdit(id: string, text: string): Promise<void> {
    const target = this.target()
    const ref = this.snapshotOf(id)
    if (!target || !ref) return
    if (target.working) return void toast(REWIND_TEXT.stopFirst, 'error')
    const done = await rewindToMessage(target, this.deps.items(), id, ref, { confirm: false })
    if (!done) return
    this.marks.delete(target.sessionId)
    this.editing = null
    this.deps.resend(text)
  }

  private async tryAgain(id: string): Promise<void> {
    const target = this.target()
    const ref = this.snapshotOf(id)
    if (!target || !ref) return
    await tryAnotherWay({ tabId: target.input.tabId, agent: target.input.agent, sessionId: target.sessionId }, this.deps.items(), id, ref)
  }

  private copy(id: string): void {
    const item = userMessage(this.deps.items(), id)
    if (item) api.writeClipboard(item.text).then(() => toast(REWIND_TEXT.copied, 'info'), () => toast('Could not copy.', 'error'))
  }
}
