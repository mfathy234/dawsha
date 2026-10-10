import {
  findLayout,
  openedText,
  paneCountText,
  planOpen,
  snapshotWorkspace,
  validateLayoutName,
  type SnapshotTab
} from '../shared/layouts'
import type { SavedLayout } from '../shared/types'
import {
  buildPane,
  canResume,
  discardPane,
  findOpenSession,
  launch,
  persistWorkspace,
  refreshBranches,
  refreshGitChanges,
  saveSettings
} from './actions'
import { choiceDialog, confirmDialog, promptDialog } from './components/dialogs'
import { toast } from './components/toast'
import { matchAll } from './derive'
import { newId, projectById, store, type PaneState } from './state'

export type OpenMode = 'replace' | 'add'

export interface LayoutOutcome {
  ok: boolean
  text: string
  cancelled?: boolean
}

function setLayouts(layouts: SavedLayout[]): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, layouts } }))
  void saveSettings({ layouts })
}

function savablePanes(): PaneState[] {
  return store.state.panes.filter((pane) => store.state.settings.projects.some((p) => p.id === pane.projectId))
}

function sessionResolver(): (tab: SnapshotTab) => string | undefined {
  const matches = matchAll(store.state)
  const byAgent: Record<string, Map<string, { sessionId: string }> | undefined> = {
    claude: matches.claude,
    codex: matches.codex,
    gemini: matches.gemini
  }
  return (tab) => tab.sessionId ?? byAgent[tab.agent]?.get(tab.id)?.sessionId
}

export async function saveCurrentLayout(): Promise<SavedLayout | null> {
  const panes = savablePanes()
  const workspace = snapshotWorkspace(panes, store.state.focusedId, {
    sessionFor: sessionResolver(),
    portable: true,
    splits: store.state.splits
  })
  if (workspace.panes.length === 0) {
    toast('Open a session first, then save the layout.', 'info')
    return null
  }
  const name = await promptDialog({
    title: 'Save current layout',
    label: 'Layout name',
    hint: `Saves ${paneCountText(workspace.panes.length)}: the project, agents and session ids in each slot. Opening it resumes the sessions that have an id.`,
    confirmLabel: 'Save layout',
    validate: (value) => validateLayoutName(value, store.state.settings.layouts)
  })
  if (!name) return null
  const layout: SavedLayout = {
    id: newId(),
    name,
    createdAt: Date.now(),
    focusedIndex: workspace.focusedIndex,
    panes: workspace.panes,
    ...(workspace.splits ? { splits: workspace.splits } : {})
  }
  setLayouts([...store.state.settings.layouts, layout])
  return layout
}

export async function renameLayout(layoutId: string): Promise<void> {
  const layout = store.state.settings.layouts.find((l) => l.id === layoutId)
  if (!layout) return
  const name = await promptDialog({
    title: `Rename layout "${layout.name}"`,
    label: 'New name',
    initial: layout.name,
    confirmLabel: 'Rename layout',
    validate: (value) => validateLayoutName(value, store.state.settings.layouts, layout.id)
  })
  if (!name || name === layout.name) return
  setLayouts(store.state.settings.layouts.map((l) => (l.id === layout.id ? { ...l, name } : l)))
}

export async function deleteLayout(layoutId: string): Promise<void> {
  const layout = store.state.settings.layouts.find((l) => l.id === layoutId)
  if (!layout) return
  const confirmed = await confirmDialog({
    title: `Delete layout "${layout.name}"?`,
    body: `The layout with ${paneCountText(layout.panes.length)} will be removed. Your sessions and projects are not affected.`,
    confirmLabel: `Delete "${layout.name}"`
  })
  if (!confirmed) return
  setLayouts(store.state.settings.layouts.filter((l) => l.id !== layout.id))
}

async function chooseMode(layout: SavedLayout): Promise<OpenMode | null> {
  const open = store.state.panes.length
  return choiceDialog<OpenMode>({
    title: 'Replace the current panes?',
    body:
      `Opening '${layout.name}' while ${paneCountText(open)} ${open === 1 ? 'is' : 'are'} open. ` +
      'Replace stops the open sessions (their files stay on disk). Add alongside keeps them running.',
    choices: [
      { label: `Replace with ${layout.name}`, value: 'replace', kind: 'danger' },
      { label: 'Add alongside', value: 'add', kind: 'primary' }
    ]
  })
}

function layoutPane(saved: SavedLayout['panes'][number]): PaneState | null {
  const project = projectById(store.state, saved.projectId)
  if (!project) return null
  const pane = buildPane(saved, project)
  const tabs = pane.tabs.map((tab) => {
    if (!tab.sessionId || tab.agent === 'shell') return tab
    if (findOpenSession(store.state, tab.agent, tab.sessionId)) return { ...tab, sessionId: undefined }
    return { ...tab, resumeChipAt: Date.now() }
  })
  return { ...pane, tabs }
}

export async function openLayout(layout: SavedLayout, mode?: OpenMode): Promise<LayoutOutcome> {
  const plan = planOpen(layout, store.state.settings.projects)
  if (plan.openable.length === 0) {
    return { ok: false, text: `Layout '${layout.name}' has no pane whose project still exists.` }
  }
  let chosen = mode
  if (!chosen && store.state.panes.length > 0) {
    chosen = (await chooseMode(layout)) ?? undefined
    if (!chosen) return { ok: false, text: `Did not open layout '${layout.name}'.`, cancelled: true }
  }
  if (chosen === 'replace') await Promise.all(store.state.panes.map((pane) => discardPane(pane.id)))
  const kept = chosen === 'replace' ? [] : store.state.panes
  const holdsPin = kept.some((pane) => pane.pinned)
  let pinTaken = holdsPin
  const panes = plan.openable
    .map(layoutPane)
    .filter((pane): pane is PaneState => pane !== null)
    .map((pane) => {
      if (!pane.pinned) return pane
      if (pinTaken) return { ...pane, pinned: undefined }
      pinTaken = true
      return pane
    })
  const focused = panes[Math.min(plan.focusedIndex, panes.length - 1)]
  store.set((s) => ({
    ...s,
    panes: [...s.panes, ...panes],
    splits: layout.splits ? { ...s.splits, ...layout.splits } : s.splits,
    focusedId: focused.id,
    maximizedId: null,
    detailsPaneId: null,
    view: 'grid',
    layoutsOpen: false,
    quickPickOpen: false,
    sidebarOverride: null
  }))
  persistWorkspace()
  void refreshBranches()
  void refreshGitChanges()
  for (const pane of panes) {
    for (const tab of pane.tabs) void launch(pane.id, tab.id, tab.sessionId !== undefined && canResume(tab))
  }
  const text = openedText(layout, plan)
  if (plan.missingProjects.length > 0) toast(text, 'info')
  return { ok: true, text }
}

export async function openLayoutByName(query: string, mode?: OpenMode): Promise<LayoutOutcome> {
  const layout = findLayout(store.state.settings.layouts, query)
  if (!layout) return { ok: false, text: `No layout named '${query}'. Run dawsha layouts.` }
  return openLayout(layout, mode)
}

export async function openLayoutFromUi(layout: SavedLayout): Promise<void> {
  const outcome = await openLayout(layout)
  if (!outcome.ok && outcome.cancelled !== true) toast(outcome.text)
}
