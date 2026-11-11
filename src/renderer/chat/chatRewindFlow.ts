import type { ChatItem } from '../../shared/chatLog'
import { timeLabel } from '../../shared/chatTime'
import { displayPath, rewindPlan, splitRewind, type RewindPlan, type RewindRow } from '../../shared/rewind'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import { api } from '../api'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { h } from '../dom'
import './chatRewind.css'

export interface RewindTarget {
  folder: string
  sessionId: string
  working: boolean
}

/** What a finished rewind leaves behind, so the thread can say so and offer Redo. */
export interface RewindDone {
  messageId: string
  messageAt?: number
  paths: string[]
  count: number
  beforeUndo: string | null
}

export interface RewindOptions {
  /** Edit and send names the count in its own footer, so it asks nothing more. */
  confirm: boolean
}

function fail(message: string): null {
  toast(message, 'error')
  return null
}

const when = (at: number | undefined): string | null => (at === undefined ? null : timeLabel(at))

const rowLine = (row: RewindRow, folder: string): HTMLElement => {
  const shown = displayPath(folder, row.path)
  return h('div', { class: 'rewind-li' }, h('span', { class: 'rewind-path', dir: 'ltr', title: row.path }, h('span', { class: 'rewind-name' }, shown.name), shown.dir ? h('span', { class: 'rewind-dir' }, shown.dir) : null),
    row.isNew ? h('span', { class: 'rewind-tag' }, REWIND_TEXT.isNew) : row.changedSince ? h('span', { class: 'rewind-tag' }, REWIND_TEXT.keptTag) : h('span', { class: 'rewind-n' }, h('span', { class: 'add' }, `+${row.added}`), ' ', h('span', { class: 'del' }, `-${row.removed}`)))
}

function fileList(put: readonly RewindRow[], kept: readonly RewindRow[], folder: string): HTMLElement {
  return h('div', { class: 'rewind-files' },
    h('div', { class: 'rewind-list', role: 'list', 'aria-label': 'Files to put back' }, ...put.map((row) => rowLine(row, folder))),
    kept.length ? h('div', { class: 'rewind-kept' }, h('p', { class: 'rewind-kept-h' }, REWIND_TEXT.keptHeading), h('div', { class: 'rewind-list', role: 'list', 'aria-label': REWIND_TEXT.keptHeading }, ...kept.map((row) => rowLine(row, folder)))) : null)
}

async function lookUp(target: RewindTarget, ref: string, plan: RewindPlan) {
  const found = await api.rewindInfo(target.folder, target.sessionId, ref, plan.files.map((file) => ({ path: file.path, ...(file.touchedAt !== undefined ? { touchedAt: file.touchedAt } : {}) }))).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!found.ok) toast(found.error || REWIND_TEXT.rewindInfoFailed, 'error')
  return found.ok ? splitRewind(plan.files, found.files) : null
}

/** The files a message's rewind would put back, as the confirm and the edit footer list them. Null after telling the user why not. */
export async function previewRewind(target: RewindTarget, items: readonly ChatItem[], messageId: string, ref: string): Promise<{ plan: RewindPlan; put: RewindRow[]; kept: RewindRow[] } | null> {
  const plan = rewindPlan(items, messageId)
  if (!plan) return null
  if (plan.files.length === 0) return { plan, put: [], kept: [] }
  const split = await lookUp(target, ref, plan)
  return split ? { plan, ...split } : null
}

/** Puts back the files. With `confirm`, names every one first. Null when nothing was changed or the user said no. */
export async function rewindToMessage(target: RewindTarget, items: readonly ChatItem[], messageId: string, ref: string, options: RewindOptions): Promise<RewindDone | null> {
  const preview = await previewRewind(target, items, messageId, ref)
  if (!preview) return null
  const { plan, put, kept } = preview
  if (put.length === 0) {
    if (options.confirm) toast(kept.length === 0 ? REWIND_TEXT.nothingToPutBack : REWIND_TEXT.allChanged, 'info')
    return options.confirm ? null : { messageId, messageAt: plan.messageAt, paths: [], count: 0, beforeUndo: null }
  }
  if (options.confirm) {
    const ok = await confirmDialog({ title: REWIND_TEXT.confirmTitle(plan.messageText), body: REWIND_TEXT.confirmBody(put.length, when(plan.messageAt)), confirmLabel: REWIND_TEXT.putBack(put.length), danger: false, content: fileList(put, kept, target.folder) })
    if (!ok) return null
  }
  const paths = put.map((row) => row.path)
  const result = await api.restoreCheckpoint(target.folder, target.sessionId, ref, paths).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!result.ok) return fail(result.error || REWIND_TEXT.rewindFailed)
  if (kept.length || result.skipped.length) toast(REWIND_TEXT.keptNote(kept.length + result.skipped.length), 'info')
  return { messageId, messageAt: plan.messageAt, paths, count: paths.length, beforeUndo: result.beforeUndo }
}

/** Asks, then restores the files the rewind put back. True when it did. */
export async function redoRewind(target: RewindTarget, done: RewindDone): Promise<boolean> {
  if (!done.beforeUndo) return false
  if (target.working) return fail(REWIND_TEXT.stopFirst) ?? false
  const names = done.paths.map((path) => path.split(/[\\/]/).pop() ?? path)
  const ok = await confirmDialog({ title: REWIND_TEXT.redoTitle, body: REWIND_TEXT.redoBody(names), confirmLabel: REWIND_TEXT.redoButton(done.paths.length), danger: false })
  if (!ok) return false
  const result = await api.restoreCheckpoint(target.folder, target.sessionId, done.beforeUndo, done.paths).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!result.ok) return fail(result.error || REWIND_TEXT.rewindFailed) ?? false
  return true
}
