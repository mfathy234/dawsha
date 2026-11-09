import { shortId } from '../../shared/compare'
import type { AgentKind } from '../../shared/types'
import { startPromptSession } from '../actions'
import { api } from '../api'
import { projectById, store } from '../state'

export interface PromptRun {
  projectId: string
  agent: AgentKind
  prompt: string
  worktree: boolean
}

export type PromptRunResult = { ok: true; paneId: string } | { ok: false; error: string }

/** Starts an agent on a prompt in the project, in a new worktree when asked, like a Compare side. */
export async function startPromptRun(run: PromptRun): Promise<PromptRunResult> {
  const project = projectById(store.state, run.projectId)
  if (!project) return { ok: false, error: 'The project no longer exists.' }
  const folder = await api.checkFolder(project.folder)
  if (!folder.ok) return { ok: false, error: folder.error ?? 'The project folder is not usable.' }
  let path: string | undefined
  if (run.worktree) {
    const made = await api.runWorktreeCreate(project.folder, shortId())
    if (!made.ok) return { ok: false, error: made.error }
    path = made.side.path
  }
  const paneId = await startPromptSession(project.id, run.agent, run.prompt, path)
  return paneId ? { ok: true, paneId } : { ok: false, error: 'The session could not be started.' }
}
