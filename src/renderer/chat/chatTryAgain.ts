import type { ChatItem } from '../../shared/chatLog'
import { timeLabel } from '../../shared/chatTime'
import { shortId } from '../../shared/compare'
import { REWIND_TEXT } from '../../shared/rewindStrings'
import { laterSameCount, nextTryNumber, triedTitle, tryPrompt } from '../../shared/tryAgain'
import type { AgentKind } from '../../shared/types'
import { persistWorkspace, startPresetSession } from '../actions'
import { api } from '../api'
import { openCompareDialog } from '../compareActions'
import { tryAgainDialog } from '../components/tryAgainDialog'
import { toast } from '../components/toast'
import { derivePanes } from '../derive'
import { mapTerm, projectById, store } from '../state'

export interface TryTarget {
  tabId: string
  agent: AgentKind
  sessionId: string
}

const paneOfTab = (tabId: string) => store.state.panes.find((pane) => pane.tabs.some((tab) => tab.id === tabId))

/** The title the source session shows, for naming the attempt and the line in the new pane. */
function titleOf(paneId: string): string {
  return derivePanes(store.state).find((view) => view.pane.id === paneId)?.title ?? 'Session'
}

async function conversationPath(target: TryTarget, projectId: string, message: string, items: readonly ChatItem[], messageId: string): Promise<string | null> {
  const saved = await api.writeHandoffTranscript({ projectId, agent: target.agent, sessionId: target.sessionId, cut: { text: message, laterSame: laterSameCount(items, messageId) } }).catch(() => null)
  return saved?.status === 'saved' ? saved.path : null
}

/** Opens the dialog and, on Start, makes a worktree from the snapshot before the message and starts a second session in it. */
export async function tryAnotherWay(target: TryTarget, items: readonly ChatItem[], messageId: string, ref: string): Promise<void> {
  const pane = paneOfTab(target.tabId)
  const project = pane ? projectById(store.state, pane.projectId) : undefined
  const item = items.find((entry) => entry.kind === 'message' && entry.id === messageId)
  if (!pane || !project || item?.kind !== 'message') return
  const title = titleOf(pane.id)
  const number = nextTryNumber(title)
  const choice = await tryAgainDialog({ agent: target.agent, message: item.text, time: item.at === undefined ? null : timeLabel(item.at), number, canBringConversation: true })
  if (!choice) return
  const made = await api.worktreeCreate(project.folder, shortId())
  if (!made.ok) return void toast(made.error || REWIND_TEXT.tryFailed, 'error')
  const copied = await api.checkpointToWorktree(project.folder, target.sessionId, ref, made.path).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (!copied.ok) return void toast(`${REWIND_TEXT.tryFilesFailed(made.path)} ${copied.error}`, 'error')
  const path = choice.bring ? await conversationPath(target, project.id, item.text, items, messageId) : null
  if (choice.bring && !path) toast(REWIND_TEXT.tryNoConversation, 'info')
  const prompt = tryPrompt({ from: target.agent, projectName: project.name, transcriptPath: path, message: choice.message })
  const opened = await startPresetSession({ projectId: project.id, agent: choice.agent, worktree: { repo: project.folder, path: made.path, branch: made.branch }, prompt })
  if (!opened) return void toast(REWIND_TEXT.tryFailed, 'error')
  markAsTry(opened, title, item.at, number)
}

function markAsTry(paneId: string, sourceTitle: string, at: number | undefined, number: number): void {
  const tab = store.state.panes.find((pane) => pane.id === paneId)?.tabs[0]
  if (!tab) return
  store.set((s) => mapTerm(s, tab.id, (term) => ({ ...term, name: triedTitle(sourceTitle), triedFrom: { title: sourceTitle, number, ...(at !== undefined ? { at } : {}) } })))
  persistWorkspace()
}

/** Compare opens the compare dialog, where both attempts can be asked the same thing side by side. */
export const compareTries = (): void => openCompareDialog()
