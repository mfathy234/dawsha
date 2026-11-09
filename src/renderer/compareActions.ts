import { AGENT_NAMES } from '../shared/agents'
import {
  diffCommand,
  quoteForShell,
  slotLabel,
  worktreeHasWork,
  type WorktreeStatus
} from '../shared/compare'
import { DEFAULT_FONT_SIZE, clampFontSize, type AgentKind, type CompareNames } from '../shared/types'
import {
  addTab,
  discardPane,
  launch,
  makeTerm,
  persistWorkspace,
  refreshBranches,
  refreshGitChanges
} from './actions'
import { api } from './api'
import { compareDialog } from './components/compareDialog'
import { confirmDialog } from './components/dialogs'
import { toast } from './components/toast'
import { derivePanes } from './derive'
import { newId, projectById, store, type PaneState, type TermState } from './state'

export interface CompareRequest {
  projectId: string
  agentA: AgentKind
  agentB: AgentKind
  prompt: string
  worktrees: boolean
  short: string
}

export type CompareResult = { ok: true } | { ok: false; error: string }

export function openCompareDialog(): void {
  const { settings, focusedId, panes } = store.state
  if (settings.projects.length === 0) {
    toast('Add a project first, then ask two agents.', 'info')
    return
  }
  const focused = panes.find((pane) => pane.id === focusedId)
  void compareDialog({ projects: settings.projects, projectId: focused?.projectId ?? settings.projects[0].id })
}

export async function startCompare(request: CompareRequest): Promise<CompareResult> {
  const project = projectById(store.state, request.projectId)
  if (!project) return { ok: false, error: 'That project no longer exists.' }
  const folder = await api.checkFolder(project.folder)
  if (!folder.ok) return { ok: false, error: folder.error ?? 'The project folder is not usable.' }
  let sides: CompareNames | null = null
  if (request.worktrees) {
    const made = await api.compareCreate(project.folder, request.short)
    if (!made.ok) return made
    sides = made.sides
  }
  const link = newId()
  const make = (slot: 'a' | 'b', agent: AgentKind): PaneState => {
    const tab: TermState = { ...makeTerm(agent, []), prompt: request.prompt }
    return {
      id: newId(),
      projectId: project.id,
      tabs: [tab],
      activeTabId: tab.id,
      fontSize: clampFontSize(project.fontSize ?? DEFAULT_FONT_SIZE),
      folder: sides?.[slot].path,
      worktree: sides ? { repo: project.folder, path: sides[slot].path, branch: sides[slot].branch } : undefined,
      compare: { id: link, slot, prompt: request.prompt, repo: project.folder, sides }
    }
  }
  const panes = [make('a', request.agentA), make('b', request.agentB)]
  store.set((s) => ({
    ...s,
    panes: [...s.panes, ...panes],
    focusedId: panes[0].id,
    maximizedId: null,
    detailsPaneId: null,
    view: 'grid',
    quickPickOpen: false,
    sidebarOverride: null
  }))
  persistWorkspace()
  void refreshBranches()
  void refreshGitChanges()
  for (const pane of panes) void launch(pane.id, pane.tabs[0].id, false)
  return { ok: true }
}

function pairPanes(linkId: string): { a?: PaneState; b?: PaneState } {
  const { panes } = store.state
  return {
    a: panes.find((pane) => pane.compare?.id === linkId && pane.compare.slot === 'a'),
    b: panes.find((pane) => pane.compare?.id === linkId && pane.compare.slot === 'b')
  }
}

function unlink(linkId: string): void {
  store.set((s) => ({ ...s, panes: s.panes.map((p) => (p.compare?.id === linkId ? { ...p, compare: undefined } : p)) }))
  persistWorkspace()
}

export function keepBoth(linkId: string): void {
  const { a } = pairPanes(linkId)
  unlink(linkId)
  if (a?.compare?.sides) toast('Kept both panes. Their worktrees stay until you remove them yourself.', 'info')
}

async function offerWorktreeRemoval(other: PaneState): Promise<void> {
  const link = other.compare
  const side = link?.sides?.[link.slot]
  if (!link || !side) return
  const status = await api.compareStatus(link.repo, side.path, side.branch)
  if (!status.exists) {
    toast(`The worktree ${side.path} is already gone.`, 'info')
    return
  }
  const slot = slotLabel(link.slot)
  const work = worktreeHasWork(status)
  const confirmed = await confirmDialog(
    work
      ? {
          title: `${slot} has work that is not saved elsewhere`,
          body:
            `${side.path} has ${status.dirtyFiles} uncommitted file${status.dirtyFiles === 1 ? '' : 's'} and ` +
            `${side.branch} has ${status.commits} commit${status.commits === 1 ? '' : 's'} of its own. ` +
            'Deleting them loses that work. They are kept unless you confirm.',
          confirmLabel: `Delete ${side.branch} and its changes`,
          cancelLabel: 'Keep worktree and branch'
        }
      : {
          title: `Remove the worktree of ${slot}?`,
          body: `${side.path} has no uncommitted files and ${side.branch} has no commits of its own. Removing deletes that folder and the branch.`,
          confirmLabel: `Remove ${side.branch}`,
          cancelLabel: 'Keep worktree and branch'
        }
  )
  if (!confirmed) return
  const result = await api.compareRemove({ repo: link.repo, path: side.path, branch: side.branch, force: work })
  if (result.ok) toast(`Removed ${side.branch} and its worktree.`, 'info')
  else toast(result.error)
}

export async function keepSide(linkId: string, keep: 'a' | 'b'): Promise<void> {
  const panes = pairPanes(linkId)
  const mine = panes[keep]
  const other = panes[keep === 'a' ? 'b' : 'a']
  if (!mine || !other) return
  const view = derivePanes(store.state).find((v) => v.pane.id === other.id)
  const title = (view?.title ?? 'session').toUpperCase()
  const project = view?.project?.name ?? 'this project'
  const agent = view && view.agent !== 'shell' ? AGENT_NAMES[view.agent] : 'agent'
  const slot = slotLabel(other.compare?.slot ?? 'b')
  const confirmed = await confirmDialog({
    title: `Close ${slot}: ${title}?`,
    body: `Keeping ${slotLabel(keep)} stops the ${agent} session ${title} in ${project}. Its files stay on disk.`,
    confirmLabel: `Close ${slot}: ${title}`
  })
  if (!confirmed) return
  await discardPane(other.id)
  await offerWorktreeRemoval(other)
}

function statusOf(link: { repo: string }, side: { path: string; branch: string }): Promise<WorktreeStatus> {
  return api.compareStatus(link.repo, side.path, side.branch)
}

export async function diffPair(linkId: string): Promise<void> {
  const { a, b } = pairPanes(linkId)
  const link = a?.compare
  if (!a || !b || !link) return
  if (!link.sides) {
    toast('This pair shares one folder, so there is nothing to diff.', 'info')
    return
  }
  const [statusA, statusB] = await Promise.all([statusOf(link, link.sides.a), statusOf(link, link.sides.b)])
  if (!statusA.exists || !statusB.exists) {
    toast('One of the worktrees is gone, so the two sides cannot be compared.')
    return
  }
  const shell = store.state.info.shellCommand
  const command = diffCommand(link, statusA, statusB, (path) => quoteForShell(path, shell))
  if (command) await addTab(a.id, 'shell', `${command}\r`)
}
