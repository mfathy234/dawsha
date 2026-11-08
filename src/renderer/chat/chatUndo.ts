import { CHAT_TEXT } from '../../shared/chatStrings'
import type { TurnSummary } from '../../shared/turnSummary'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { api } from '../api'

const PREPARE_WAIT_MS = 2500

export interface UndoTarget {
  folder: string
  sessionId: string
  agentName: string
  working: boolean
}

/** Snapshots the project before a chat message is typed into the terminal. Waits briefly; a slow repository never blocks the message. */
export async function prepareCheckpoint(folder: string, sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return
  const wait = new Promise<void>((resolve) => setTimeout(resolve, PREPARE_WAIT_MS))
  await Promise.race([api.checkpointPrepare(folder, sessionId).then(() => undefined, () => undefined), wait])
}

/** The checkpoint of each user message id that has one; a refused or failed lookup gives none. */
export async function loadCheckpoints(folder: string, sessionId: string, messageIds: string[]): Promise<Record<string, string>> {
  const found = await api.listCheckpoints(folder, sessionId, messageIds).catch(() => ({}))
  return Object.fromEntries(Object.entries(found).filter(([, ref]) => typeof ref === 'string'))
}

const names = (summary: TurnSummary): string[] => summary.files.map((file) => file.path.split(/[\\/]/).pop() ?? file.path)

async function redo(target: UndoTarget, summary: TurnSummary, beforeUndo: string): Promise<void> {
  const ok = await confirmDialog({ title: CHAT_TEXT.redo, body: CHAT_TEXT.redoQuestion(target.agentName, names(summary)), confirmLabel: CHAT_TEXT.redoButton(summary.files.length), danger: false })
  if (!ok) return
  const result = await api.restoreCheckpoint(target.folder, target.sessionId, beforeUndo, summary.files.map((file) => file.path)).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!result.ok) toast(result.error || CHAT_TEXT.undoFailed, 'error')
}

/** Confirms, then puts back only the files this reply changed. The toast offers Redo for the same files. */
export async function undoReply(target: UndoTarget, summary: TurnSummary): Promise<void> {
  if (!summary.checkpointRef) return
  if (target.working) return void toast(CHAT_TEXT.undoWhileWorking(target.agentName), 'error')
  const confirmed = await confirmDialog({ title: CHAT_TEXT.undoReply, body: CHAT_TEXT.undoQuestion(target.agentName, names(summary)), confirmLabel: CHAT_TEXT.undoButton(summary.files.length) })
  if (!confirmed) return
  const paths = summary.files.map((file) => file.path)
  const result = await api.restoreCheckpoint(target.folder, target.sessionId, summary.checkpointRef, paths).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!result.ok) return void toast(result.error || CHAT_TEXT.undoFailed, 'error')
  const beforeUndo = result.beforeUndo
  const note = result.skipped.length ? `${CHAT_TEXT.undoDone} ${CHAT_TEXT.undoSkipped(result.skipped.length)}` : CHAT_TEXT.undoDone
  toast(note, 'info', beforeUndo ? { label: CHAT_TEXT.redo, run: () => { void redo(target, summary, beforeUndo) } } : undefined)
}
