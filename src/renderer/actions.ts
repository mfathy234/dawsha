import {
  DEFAULT_FONT_SIZE,
  clampFontSize,
  type BackgroundImage,
  type AgentKind,
  type CodexSession,
  type GeminiSession,
  type Project,
  type RemoteSessionStarted,
  type QuickOpenKind,
  type ResumeSession,
  type SavedPane,
  type SessionInfoSettings,
  type GridSplits,
  type StatusInfo,
  type Settings,
  type KeptSession,
  type TabAgent
} from '../shared/types'
import { agentOf, AGENT_NAMES } from '../shared/agents'
import { folderName } from '../shared/cli'
import {
  NODE_NOTE,
  joinCommands,
  nodeProblem,
  planFor,
  taskOutcome,
  toolCommand,
  type TaskPlan
} from '../shared/agentTools'
import { decideWhatsNew, effectiveLastSeen, entriesUpTo } from '../shared/changelog'
import { showUpdatePill, type UpdateState } from '../shared/updates'
import { snapshotWorkspace } from '../shared/layouts'
import { moveById, moveItem } from '../shared/reorder'
import { CHANGELOG_ENTRIES } from './changelog'
import { forgetOutput } from './ptyActivity'
import { leaveBoard } from './sessionsLayout'
import type { OpsSnapshot } from '../shared/opsFeed'
import type { AgentPreset } from '../shared/quickPick'
import { defaultHighlightRules, describeRules, sameRules, type HighlightSettings } from '../shared/highlights'
import { sanitizeRecordings, type RecordingSettings } from '../shared/recordings'
import { api } from './api'
import { openChangesDialog } from './components/changesDialog'
import { recordApproval } from './timelineLog'
import { confirmDialog } from './components/dialogs'
import { toast } from './components/toast'
import { derivePanes, matchAll, workFolderOfPane } from './derive'
import { nextFrame } from './dom'
import {
  AGENTS_PROJECT_ID,
  mapPane,
  mapTerm,
  newId,
  paneById,
  projectById,
  store,
  type AppState,
  type PaneState,
  type TermState
} from './state'
import { nextAttentionPane } from '../shared/attention'
import { shouldRelaunchPlain } from '../shared/resumeFallback'
import { sessionDisplayName } from '../shared/sessionMatch'
import { applyTheme } from './themeManager'
import { disposeTerminal, getTerminal } from './terminals'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
import { closeCopy, confirmsClose } from '../shared/closeConfirm'

const PERMISSION_TAIL_ROWS = 24

const PERSIST_DELAY_MS = 300
let persistTimer: number | undefined
let persistPending = false

function nextLabel(tabs: TermState[], agent: TabAgent): string {
  const labels = new Set(tabs.map((t) => t.label))
  const base = agent
  if (!labels.has(base)) return base
  let index = 2
  while (labels.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

function uniqueLabel(tabs: TermState[], base: string): string {
  const labels = new Set(tabs.map((t) => t.label))
  let candidate = base
  let index = 2
  while (labels.has(candidate)) {
    candidate = `${base} ${index}`
    index += 1
  }
  return candidate
}

export function makeTerm(agent: TabAgent, existing: TermState[], sessionId?: string, label?: string): TermState {
  return {
    id: newId(),
    agent,
    sessionId,
    label: label ? uniqueLabel(existing, label) : nextLabel(existing, agent),
    startedAt: Date.now(),
    status: 'starting'
  }
}

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  return api.updateSettings(patch).then(
    () => undefined,
    (error: unknown) => toast((error as Error).message || 'Could not save settings.')
  )
}

function saveWorkspace(): Promise<void> {
  return saveSettings({ workspace: snapshotWorkspace(store.state.panes, store.state.focusedId, { splits: store.state.splits }) })
}

export function persistWorkspace(): void {
  window.clearTimeout(persistTimer)
  persistPending = true
  persistTimer = window.setTimeout(() => {
    persistPending = false
    void saveWorkspace()
  }, PERSIST_DELAY_MS)
}

export async function flushWorkspace(): Promise<void> {
  if (!persistPending) return
  window.clearTimeout(persistTimer)
  persistPending = false
  await saveWorkspace()
}

// Remember the repo as it is when a session starts, so Changes can show only what changed since.
async function recordBaseline(termId: string, cwd: string): Promise<void> {
  const result = await api.gitBaseline(cwd).catch(() => null)
  if (!result?.ok) return
  store.set((s) => mapTerm(s, termId, (t) => (t.baseline ? t : { ...t, baseline: result.baseline })))
  persistWorkspace()
}

export async function launch(paneId: string, termId: string, resume: boolean): Promise<void> {
  await nextFrame()
  await nextFrame()
  const state = store.state
  const pane = paneById(state, paneId)
  const project = pane ? projectById(state, pane.projectId) : undefined
  const term = pane?.tabs.find((t) => t.id === termId)
  if (!pane || !project || !term) return
  const view = getTerminal(termId)
  view?.fitNow()
  const startedAt = Date.now()
  const sessionId = term.agent === 'gemini' && !term.sessionId ? crypto.randomUUID() : term.sessionId
  if (sessionId !== term.sessionId) {
    store.set((s) => mapTerm(s, termId, (t) => ({ ...t, sessionId })))
    persistWorkspace()
  }
  const cwd = pane.folder ?? project.folder
  if (!term.baseline) void recordBaseline(termId, cwd)
  const result = await api.spawn({
    id: termId,
    projectId: project.id,
    agent: term.agent,
    cwd,
    resume,
    sessionId,
    command: term.command,
    prompt: term.prompt,
    title: term.titleHint,
    fullAccess: term.agent !== 'shell' && state.settings.fullAccess[term.agent],
    cols: view?.cols ?? 120,
    rows: view?.rows ?? 30
  })
  if (result.ok) {
    store.set((s) =>
      mapTerm(s, termId, (t) => ({ ...t, status: 'running', pid: result.pid, startedAt, resumed: resume, prompt: undefined }))
    )
    return
  }
  view?.writeLine(`\x1b[31m${result.error}\x1b[0m`)
  store.set((s) => mapTerm(s, termId, (t) => ({ ...t, status: 'exited', pid: undefined })))
  toast(result.error)
}

export function handleTerminalExit(termId: string, exitCode: number): void {
  const pane = store.state.panes.find((p) => p.tabs.some((t) => t.id === termId))
  const tab = pane?.tabs.find((t) => t.id === termId)
  if (!pane || !tab) return
  if (tab.task) {
    getTerminal(termId)?.writeLine(`[2m[process exited with code ${exitCode}][0m`)
    store.set((s) => mapTerm(s, termId, (t) => ({ ...t, status: 'exited', exitCode })))
    void finishAgentTask(tab, exitCode)
    return
  }
  const relaunch = shouldRelaunchPlain({
    agent: tab.agent,
    resumed: tab.resumed === true,
    alreadyRetried: tab.retried === true,
    runtimeMs: Date.now() - tab.startedAt,
    exitCode,
    output: getTerminal(termId)?.bufferText() ?? ''
  })
  if (relaunch) {
    getTerminal(termId)?.writeLine('\x1b[2m--- no earlier session, starting a new one ---\x1b[0m')
    store.set((s) =>
      mapTerm(s, termId, (t) => ({ ...t, status: 'starting', exitCode: undefined, retried: true, sessionId: undefined }))
    )
    void launch(pane.id, termId, false)
    return
  }
  getTerminal(termId)?.writeLine(`\x1b[2m[process exited with code ${exitCode}]\x1b[0m`)
  store.set((s) => mapTerm(s, termId, (t) => ({ ...t, status: 'exited', exitCode })))
}

export async function startSession(
  projectId: string,
  agent?: TabAgent,
  resumeId?: string,
  chip = false,
  titleHint?: string
): Promise<number> {
  const project = projectById(store.state, projectId)
  if (!project) return 0
  const tab: TermState = {
    ...makeTerm(agent ?? agentOf(project), [], resumeId),
    titleHint,
    resumeChipAt: chip ? Date.now() : undefined
  }
  const pane: PaneState = {
    id: newId(),
    projectId,
    tabs: [tab],
    activeTabId: tab.id,
    fontSize: clampFontSize(project.fontSize ?? DEFAULT_FONT_SIZE)
  }
  store.set((s) => ({
    ...s,
    panes: [...s.panes, pane],
    focusedId: pane.id,
    maximizedId: s.maximizedId ? pane.id : null,
    view: 'grid',
    quickPickOpen: false,
    sidebarOverride: null
  }))
  persistWorkspace()
  void refreshBranches()
  void refreshGitChanges()
  const number = store.state.panes.findIndex((p) => p.id === pane.id) + 1
  void launch(pane.id, tab.id, resumeId !== undefined)
  return number
}

export function attachRemoteSession(session: RemoteSessionStarted): void {
  if (!session || typeof session.id !== 'string' || typeof session.projectId !== 'string' || !['claude', 'codex', 'gemini'].includes(session.agent)) return
  const existingPane = store.state.panes.find((pane) => pane.tabs.some((tab) => tab.id === session.id))
  if (existingPane) return
  const project = projectById(store.state, session.projectId)
  if (!project) return
  const tab: TermState = { ...makeTerm(session.agent, []), id: session.id, sessionId: session.sessionId, resumed: session.sessionId !== undefined, status: 'running', pid: session.pid, startedAt: Date.now() }
  const pane: PaneState = {
    id: newId(),
    projectId: project.id,
    tabs: [tab],
    activeTabId: tab.id,
    fontSize: clampFontSize(project.fontSize ?? DEFAULT_FONT_SIZE)
  }
  store.set((state) => ({ ...state, panes: [...state.panes, pane], focusedId: pane.id, view: 'grid', sidebarOverride: null }))
  persistWorkspace()
  void refreshBranches()
  void refreshGitChanges()
}

export async function addTab(paneId: string, agent: TabAgent, input?: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  const tab = makeTerm(agent, pane.tabs)
  store.set((s) => mapPane(s, paneId, (p) => ({ ...p, tabs: [...p.tabs, tab], activeTabId: tab.id })))
  persistWorkspace()
  await launch(paneId, tab.id, false)
  if (input) api.write(tab.id, input)
}

function paneFolder(paneId: string): string | null {
  const pane = paneById(store.state, paneId)
  return pane ? workFolderOfPane(store.state, pane) : null
}

export async function openPaneFolder(paneId: string, kind: QuickOpenKind): Promise<void> {
  const folder = paneFolder(paneId)
  if (folder) await api.quickOpen(kind, folder)
}

export async function showPaneDiff(paneId: string): Promise<void> {
  await addTab(paneId, 'shell', 'git diff\r')
}

export async function paneSolution(paneId: string): Promise<string | null> {
  const folder = paneFolder(paneId)
  return folder ? api.findSolution(folder) : null
}

export function paneHasRepo(paneId: string): boolean {
  const folder = paneFolder(paneId)
  return folder !== null && store.state.gitChanges[folder] != null
}

export async function openChanges(paneId: string, focusPath?: string): Promise<void> {
  const folder = paneFolder(paneId)
  const view = derivePanes(store.state).find((v) => v.pane.id === paneId)
  if (!folder || !view) return
  if (!paneHasRepo(paneId)) {
    toast('This pane folder is not a git repository.')
    return
  }
  const pane = paneById(store.state, paneId)
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
  await openChangesDialog({
    folder,
    title: view.title,
    baseline: tab?.baseline,
    sessionTitle: tab?.agent === 'shell' ? undefined : view.title,
    focusPath,
    onChanged: () => void refreshGitChanges()
  })
  void refreshGitChanges()
}

export function setActiveTab(paneId: string, termId: string): void {
  store.set((s) => mapPane({ ...s, focusedId: paneId }, paneId, (p) => ({ ...p, activeTabId: termId })))
  persistWorkspace()
}

export function cycleActiveTab(delta: number): void {
  const { focusedId, panes } = store.state
  const pane = panes.find((item) => item.id === focusedId)
  if (!pane || pane.tabs.length < 2) return
  const index = pane.tabs.findIndex((tab) => tab.id === pane.activeTabId)
  setActiveTab(pane.id, pane.tabs[(index + delta + pane.tabs.length) % pane.tabs.length].id)
}

export async function restartTab(paneId: string, termId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  const tab = pane?.tabs.find((t) => t.id === termId)
  if (!pane || !tab) return
  getTerminal(termId)?.writeLine('\x1b[2m--- restarted ---\x1b[0m')
  store.set((s) => mapTerm(s, termId, (t) => ({ ...t, status: 'starting', exitCode: undefined, retried: false })))
  await launch(paneId, termId, canResume(tab))
}

export function canResume(tab: TermState): boolean {
  return tab.agent === 'claude' || ((tab.agent === 'codex' || tab.agent === 'gemini') && Boolean(tab.sessionId))
}

async function stopTerminal(termId: string): Promise<void> {
  forgetOutput(termId)
  await api.kill(termId)
  disposeTerminal(termId)
}

function keepClosedTabs(pane: PaneState, tabs: TermState[]): void {
  const state = store.state
  const view = derivePanes(state).find((item) => item.pane.id === pane.id)
  const matches = matchAll(state)
  const additions: KeptSession[] = tabs.flatMap((tab) => {
    if (tab.agent === 'shell' || !state.settings.projects.some((project) => project.id === pane.projectId)) return []
    const sessionId = tab.sessionId || (tab.agent === 'claude' ? matches.claude.get(tab.id)?.sessionId
      : tab.agent === 'codex' ? matches.codex.get(tab.id)?.sessionId
      : matches.gemini.get(tab.id)?.sessionId)
    if (!sessionId) return []
    const observed = tab.agent === 'claude' ? sessionDisplayName(matches.claude.get(tab.id))
      : tab.agent === 'codex' ? matches.codex.get(tab.id)?.name
      : matches.gemini.get(tab.id)?.name
    const title = observed?.trim() || tab.titleHint || (tab.label !== tab.agent ? tab.label : null) || (tab.id === pane.activeTabId && view?.named ? view.title : null) || tab.label
    return [{ projectId: pane.projectId, agent: tab.agent, sessionId, title, closedAt: Date.now() }]
  })
  if (additions.length === 0) return
  const keys = new Set(additions.map((item) => `${item.agent}:${item.sessionId}`))
  const keptSessions = [...state.settings.keptSessions.filter((item) => !keys.has(`${item.agent}:${item.sessionId}`)), ...additions]
  store.set((current) => ({ ...current, settings: { ...current.settings, keptSessions } }))
  void saveSettings({ keptSessions })
}

export function removeKeptSession(agent: AgentKind, sessionId: string): void {
  const keptSessions = store.state.settings.keptSessions.filter((item) => item.agent !== agent || item.sessionId !== sessionId)
  store.set((state) => ({ ...state, settings: { ...state.settings, keptSessions } }))
  void saveSettings({ keptSessions })
}

function removeTab(state: AppState, paneId: string, termId: string): AppState {
  const pane = paneById(state, paneId)
  if (!pane) return state
  const tabs = pane.tabs.filter((t) => t.id !== termId)
  if (tabs.length === 0) return removePane(state, paneId)
  const index = pane.tabs.findIndex((t) => t.id === termId)
  const activeTabId = pane.activeTabId === termId ? tabs[Math.min(index, tabs.length - 1)].id : pane.activeTabId
  return mapPane(state, paneId, (p) => ({ ...p, tabs, activeTabId }))
}

function removePane(state: AppState, paneId: string): AppState {
  const index = state.panes.findIndex((p) => p.id === paneId)
  const panes = state.panes.filter((p) => p.id !== paneId)
  const neighbour = panes[Math.min(index, panes.length - 1)]
  const closing = state.panes[index]?.compare?.id
  return {
    ...state,
    panes: closing ? panes.map((p) => (p.compare?.id === closing ? { ...p, compare: undefined } : p)) : panes,
    focusedId: state.focusedId === paneId ? (neighbour?.id ?? null) : state.focusedId,
    maximizedId: state.maximizedId === paneId ? null : state.maximizedId
  }
}

export async function closeTerminal(paneId: string, termId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  const tab = pane?.tabs.find((t) => t.id === termId)
  if (!pane || !tab) return
  if (pane.tabs.length === 1) return closePane(paneId)
  const view = derivePanes(store.state).find((v) => v.pane.id === paneId)
  if (tab.agent !== 'shell' && view?.primaryTabId === tab.id && confirmsClose(view.status)) {
    const project = view.project?.name ?? 'this project'
    const confirmed = await confirmDialog({
      ...closeCopy(tab.label),
      body: `${AGENT_NAMES[tab.agent]} is still working in this terminal in ${project}. Closing stops it. Its files stay on disk.`
    })
    if (!confirmed) return
  }
  keepClosedTabs(pane, [tab])
  await stopTerminal(termId)
  store.set((s) => removeTab(s, paneId, termId))
  persistWorkspace()
}

export async function closePane(paneId: string): Promise<void> {
  const view = derivePanes(store.state).find((v) => v.pane.id === paneId)
  if (!view) return
  if (!confirmsClose(view.status)) return discardPane(paneId)
  const project = view.project?.name ?? 'this project'
  const hasAgent = view.pane.tabs.some((t) => t.agent !== 'shell')
  const agentName = AGENT_NAMES[view.agent === 'shell' ? 'claude' : view.agent]
  const others = view.pane.tabs.length - 1
  const extra = others === 0 ? '' : others === 1 ? ' Its 1 other terminal stops too.' : ` Its ${others} other terminals stop too.`
  const body = hasAgent
    ? `${agentName} is still working on it in ${project}. Closing stops it. Its files stay on disk.${extra}`
    : `A command is still running in ${project}. Closing stops the terminal${view.pane.tabs.length === 1 ? '' : 's'}.`
  const confirmed = await confirmDialog({ ...closeCopy(view.title), body })
  if (!confirmed) return
  await discardPane(paneId)
}

export async function discardPane(paneId: string): Promise<void> {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  keepClosedTabs(pane, pane.tabs)
  await Promise.all(pane.tabs.map((t) => stopTerminal(t.id)))
  store.set((s) => removePane(s, paneId))
  persistWorkspace()
}

export function focusPane(paneId: string, keepMaximized = false): void {
  leaveBoard()
  const state = store.state
  const stays = keepMaximized && state.maximizedId !== null
  if (state.view === 'grid' && state.focusedId === paneId && (stays || state.maximizedId === null || state.maximizedId === paneId)) return
  store.set((s) => ({
    ...s,
    focusedId: paneId,
    view: 'grid',
    maximizedId: stays ? s.maximizedId : s.maximizedId ? paneId : null,
    detailsPaneId: s.detailsPaneId === paneId ? paneId : null,
    timelinePaneId: s.timelinePaneId === paneId ? paneId : null
  }))
  persistWorkspace()
}

export function focusPaneFromNotification(paneId: string): void {
  if (!store.state.panes.some((pane) => pane.id === paneId)) return
  leaveBoard()
  store.set((s) => ({
    ...s,
    focusedId: paneId,
    view: 'grid',
    maximizedId: s.maximizedId ? paneId : null,
    detailsPaneId: null,
    sidebarOverride: null,
    onboardingOpen: false,
    quickPickOpen: false,
    paletteOpen: false,
    layoutsOpen: false,
    themePickerOpen: false,
    updatePopoverOpen: false,
    whatsNew: null
  }))
  persistWorkspace()
}

export function focusRelative(delta: number): void {
  const { panes, focusedId } = store.state
  if (panes.length === 0) return
  const current = Math.max(0, panes.findIndex((p) => p.id === focusedId))
  focusPane(panes[(current + delta + panes.length) % panes.length].id)
}

export function focusNextAttention(): boolean {
  const { panes, focusedId, attention } = store.state
  const target = nextAttentionPane(panes.map((p) => p.id), focusedId, attention)
  if (target) focusPane(target)
  return target !== null
}

/**
 * Answers the permission prompt in a pane's agent tab: the tab attention polling reads, never a shell
 * tab beside it. Agents put the "allow once" choice first, so Enter accepts it and Escape declines.
 * The screen is checked again first, because attention lags the terminal and a stray Enter would
 * send whatever is in the prompt box.
 */
export function answerPermission(paneId: string, allow: boolean): boolean {
  if (store.state.attention[paneId] !== 'needs') return false
  const tabId = derivePanes(store.state).find((v) => v.pane.id === paneId)?.primaryTabId
  const tail = tabId ? (getTerminal(tabId)?.tailText(PERMISSION_TAIL_ROWS) ?? '') : ''
  if (!tabId || !detectPermissionPrompt(tail)) return false
  recordApproval(paneId, allow, tail, Date.now())
  void api.remoteAccess?.recordApproval(tabId, allow, tail).catch(() => undefined)
  api.write(tabId, allow ? '\r' : '\x1b')
  return true
}

/** The agent tab's screen tail, used to show what a permission prompt asks. */
export function permissionTail(paneId: string): string {
  const tabId = derivePanes(store.state).find((v) => v.pane.id === paneId)?.primaryTabId
  return tabId ? (getTerminal(tabId)?.tailText(PERMISSION_TAIL_ROWS) ?? '') : ''
}

export function findInPane(paneId: string): void {
  const pane = paneById(store.state, paneId)
  if (pane) getTerminal(pane.activeTabId)?.openSearch()
}

export function focusPaneAt(index: number): void {
  const pane = store.state.panes[index]
  if (pane) focusPane(pane.id)
}

export function movePane(paneId: string, toIndex: number): void {
  const panes = store.state.panes
  const from = panes.findIndex((p) => p.id === paneId)
  const to = Math.max(0, Math.min(panes.length - 1, toIndex))
  if (from < 0 || from === to) return
  store.patch({ panes: moveItem(panes, from, to), focusedId: paneId })
  persistWorkspace()
}

export function moveTab(paneId: string, termId: string, toIndex: number): void {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  const tabs = moveById(pane.tabs, termId, toIndex)
  if (tabs === pane.tabs) return
  store.set((s) => mapPane(s, paneId, (p) => ({ ...p, tabs })))
  persistWorkspace()
}

export function setPinned(paneId: string, pinned: boolean): void {
  if (!paneById(store.state, paneId)) return
  store.set((s) => ({
    ...s,
    panes: s.panes.map((p) => {
      if (p.id === paneId) return { ...p, pinned: pinned ? true : undefined }
      return pinned && p.pinned ? { ...p, pinned: undefined } : p
    })
  }))
  persistWorkspace()
}

export function togglePinned(paneId?: string): void {
  const target = paneById(store.state, paneId ?? store.state.focusedId)
  if (target) setPinned(target.id, target.pinned !== true)
}

export function setSplits(splits: GridSplits): void {
  store.patch({ splits })
  persistWorkspace()
}

export function movePaneBy(paneId: string, delta: number): void {
  const index = store.state.panes.findIndex((p) => p.id === paneId)
  if (index >= 0) movePane(paneId, index + delta)
}

export function toggleMaximize(paneId?: string): void {
  queueMicrotask(() => void refreshGitChanges())
  const target = paneId ?? store.state.focusedId
  if (!target || !paneById(store.state, target)) return
  leaveBoard()
  store.set((s) => ({
    ...s,
    focusedId: target,
    view: 'grid',
    maximizedId: s.maximizedId === target ? null : target,
    detailsPaneId: null,
    timelinePaneId: null,
    sidebarOverride: null
  }))
}

export function restoreGrid(): void {
  if (store.state.maximizedId) {
    store.set((s) => ({ ...s, maximizedId: null, detailsPaneId: null, timelinePaneId: null, sidebarOverride: null }))
  }
}

export function toggleAgents(termId: string): void {
  store.set((s) => mapTerm(s, termId, (t) => ({ ...t, agentsOpen: t.agentsOpen !== true })))
  persistWorkspace()
}

export function openDetails(paneId: string): void {
  if (!paneById(store.state, paneId)) return
  leaveBoard()
  queueMicrotask(() => void refreshGitChanges())
  store.set((s) => ({ ...s, focusedId: paneId, view: 'grid', maximizedId: paneId, detailsPaneId: paneId, timelinePaneId: null, sidebarOverride: null }))
}

export function closeDetails(): void {
  if (store.state.detailsPaneId) store.set((s) => ({ ...s, detailsPaneId: null }))
}

export function toggleDetails(paneId: string): void {
  if (store.state.detailsPaneId === paneId) closeDetails()
  else openDetails(paneId)
}

function updateProjectFont(state: AppState, projectId: string, fontSize: number): AppState {
  const projects = state.settings.projects.map((p) => (p.id === projectId ? { ...p, fontSize } : p))
  return { ...state, settings: { ...state.settings, projects } }
}

function saveProjects(): void {
  void saveSettings({ projects: store.state.settings.projects })
}

export function setPaneFont(paneId: string, size: number): void {
  const pane = paneById(store.state, paneId)
  if (!pane) return
  const fontSize = clampFontSize(size)
  store.set((s) => updateProjectFont(mapPane(s, paneId, (p) => ({ ...p, fontSize })), pane.projectId, fontSize))
  saveProjects()
  persistWorkspace()
}

export function zoomPane(paneId: string, delta: number): void {
  const pane = paneById(store.state, paneId)
  if (pane) setPaneFont(paneId, pane.fontSize + delta)
}

export function zoomAll(delta: number): void {
  store.set((s) => {
    let next = s
    for (const pane of s.panes) {
      const fontSize = clampFontSize(pane.fontSize + delta)
      next = updateProjectFont(mapPane(next, pane.id, (p) => ({ ...p, fontSize })), pane.projectId, fontSize)
    }
    return next
  })
  saveProjects()
  persistWorkspace()
}

export function toggleSidebar(): void {
  const state = store.state
  const maximized = state.view === 'grid' && state.maximizedId !== null
  const collapsed = state.sidebarOverride ?? (maximized || state.settings.sidebarCollapsed)
  if (maximized) {
    store.patch({ sidebarOverride: !collapsed })
    return
  }
  store.set((s) => ({
    ...s,
    sidebarOverride: null,
    settings: { ...s.settings, sidebarCollapsed: !collapsed }
  }))
  void saveSettings({ sidebarCollapsed: !collapsed })
}

export function toggleProjectExpanded(projectId: string): void {
  store.set((s) => ({
    ...s,
    collapsedProjects: { ...s.collapsedProjects, [projectId]: !s.collapsedProjects[projectId] }
  }))
}

export function showView(view: AppState['view']): void {
  store.patch({ view })
}

export function openSettings(section?: AppState['settingsSection']): void {
  store.set((s) => ({
    ...s,
    view: 'settings',
    settingsSection: section ?? s.settingsSection,
    themePickerOpen: false,
    updatePopoverOpen: false,
    layoutsOpen: false
  }))
}

export function showSettingsSection(settingsSection: AppState['settingsSection']): void {
  store.patch({ settingsSection })
}

export function setHighlights(highlights: HighlightSettings): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, highlights } }))
  void saveSettings({ highlights })
}

export async function resetHighlightRules(): Promise<void> {
  const current = store.state.settings.highlights
  const defaults = defaultHighlightRules()
  if (sameRules(current.rules, defaults)) return
  const count = current.rules.length
  const names = count === 0 ? 'your empty rule list' : `your ${count} rule${count === 1 ? '' : 's'} (${describeRules(current.rules, 12)})`
  const confirmed = await confirmDialog({
    title: 'Reset highlight rules?',
    body: `This replaces ${names} with the ${defaults.length} default rules.`,
    confirmLabel: `Replace ${count} rule${count === 1 ? '' : 's'}`
  })
  if (confirmed) setHighlights({ ...current, rules: defaults })
}

export function setPaletteShortcut(paletteShortcut: string): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, paletteShortcut } }))
  void saveSettings({ paletteShortcut })
}

export function toggleOthersPanel(): void {
  const othersCollapsed = !store.state.settings.othersCollapsed
  store.set((s) => ({ ...s, settings: { ...s.settings, othersCollapsed } }))
  void saveSettings({ othersCollapsed })
}

export function setSidebarCollapsed(sidebarCollapsed: boolean): void {
  store.set((s) => ({ ...s, sidebarOverride: null, settings: { ...s.settings, sidebarCollapsed } }))
  void saveSettings({ sidebarCollapsed })
}

export function openDataFolder(): void {
  const folder = store.state.info.userData
  if (folder) void api.quickOpen('explorer', folder)
}

export function showFullChangelog(): void {
  closeWhatsNew()
  openSettings('changelog')
}

export function showProjectsTab(projectsTab: AppState['projectsTab']): void {
  store.patch({ projectsTab })
}

export function openSnippets(): void {
  store.patch({ view: 'projects', projectsTab: 'snippets' })
}

export function openQuickPick(preset: AgentPreset = 'default'): void {
  store.patch({
    quickPickOpen: true,
    quickPickPreset: preset,
    quickPickMode: 'new',
    themePickerOpen: false,
    layoutsOpen: false
  })
}

export function openResumePicker(projectId?: string): void {
  store.patch({
    quickPickOpen: true,
    quickPickMode: 'resume',
    resumeProjectId: projectId ?? null,
    themePickerOpen: false,
    layoutsOpen: false
  })
}

export function setQuickPickMode(mode: AppState['quickPickMode']): void {
  store.patch({ quickPickMode: mode })
}

export function toggleLayouts(open?: boolean): void {
  store.set((s) => ({
    ...s,
    layoutsOpen: open ?? !s.layoutsOpen,
    quickPickOpen: false,
    themePickerOpen: false,
    updatePopoverOpen: false
  }))
}

export function openPalette(): void {
  store.patch({
    paletteOpen: true,
    quickPickOpen: false,
    themePickerOpen: false,
    updatePopoverOpen: false,
    layoutsOpen: false
  })
}

export function closePalette(): void {
  if (store.state.paletteOpen) store.patch({ paletteOpen: false })
}

export function openOnboarding(): void {
  store.patch({ onboardingOpen: true, themePickerOpen: false, quickPickOpen: false })
}

export function dismissOnboarding(): void {
  store.set((s) => ({ ...s, onboardingOpen: false, settings: { ...s.settings, onboardingDismissed: true } }))
  void saveSettings({ onboardingDismissed: true })
}

export function closeQuickPick(): void {
  store.patch({ quickPickOpen: false })
}

export function toggleThemePicker(open?: boolean): void {
  store.set((s) => ({
    ...s,
    themePickerOpen: open ?? !s.themePickerOpen,
    quickPickOpen: false,
    updatePopoverOpen: false,
    layoutsOpen: false
  }))
}

export function toggleUpdatePopover(open?: boolean): void {
  store.set((s) => ({
    ...s,
    updatePopoverOpen: open ?? !s.updatePopoverOpen,
    themePickerOpen: false,
    quickPickOpen: false,
    layoutsOpen: false
  }))
}

export function setUpdateState(update: UpdateState): void {
  store.set((s) => ({ ...s, update, updatePopoverOpen: s.updatePopoverOpen && update.mode !== 'dev' && showUpdatePill(update) }))
}

export async function runUpdateAction(action: 'check' | 'download' | 'retry' | 'dismiss' | 'restart'): Promise<void> {
  if (action === 'dismiss') toggleUpdatePopover(false)
  if (action === 'download' || action === 'retry') store.patch({ updatePopoverOpen: true })
  const call = {
    check: api.checkForUpdate,
    download: api.downloadUpdate,
    retry: api.retryUpdate,
    dismiss: api.dismissUpdate,
    restart: api.restartToUpdate
  }[action]
  await call()
}

export function openUpdateLink(url: string): void {
  void api.openUpdateLink(url)
}

export function setFullAccess(agent: AgentKind, value: boolean): void {
  const fullAccess = { ...store.state.settings.fullAccess, [agent]: value }
  store.set((s) => ({ ...s, settings: { ...s.settings, fullAccess } }))
  void saveSettings({ fullAccess })
}

export function setAutoUpdateCheck(value: boolean): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, autoUpdateCheck: value } }))
  void saveSettings({ autoUpdateCheck: value })
}

export function openWhatsNew(): void {
  const version = store.state.info.version
  store.set((s) => ({
    ...s,
    themePickerOpen: false,
    updatePopoverOpen: false,
    whatsNew: { version, from: null, entries: entriesUpTo(CHANGELOG_ENTRIES, version) }
  }))
}

export function closeWhatsNew(): void {
  const { whatsNew } = store.state
  if (!whatsNew) return
  store.patch({ whatsNew: null })
  if (store.state.settings.lastSeenVersion !== whatsNew.version) {
    store.set((s) => ({ ...s, settings: { ...s.settings, lastSeenVersion: whatsNew.version } }))
    void saveSettings({ lastSeenVersion: whatsNew.version })
  }
}

export function initWhatsNew(): void {
  const { info, settings } = store.state
  const hasExistingData = settings.projects.length > 0
  const lastSeen = effectiveLastSeen(settings.lastSeenVersion, hasExistingData)
  const decision = decideWhatsNew(info.version, lastSeen, CHANGELOG_ENTRIES)
  if (decision.show) {
    store.patch({ whatsNew: { version: info.version, from: decision.from, entries: decision.entries } })
  } else if (decision.record || (settings.lastSeenVersion === null && hasExistingData)) {
    const record = decision.record ?? info.version
    store.set((s) => ({ ...s, settings: { ...s.settings, lastSeenVersion: record } }))
    void saveSettings({ lastSeenVersion: record })
  }
}

export async function refreshBranches(): Promise<void> {
  const state = store.state
  const folders = new Set<string>()
  const matches = matchAll(state)
  for (const pane of state.panes) {
    const folder = workFolderOfPane(state, pane, matches)
    if (folder) folders.add(folder)
  }
  const entries = await Promise.all([...folders].map(async (f) => [f, await api.gitBranch(f)] as const))
  const changed = entries.some(([folder, branch]) => store.state.branches[folder] !== branch)
  if (changed) store.set((s) => ({ ...s, branches: { ...s.branches, ...Object.fromEntries(entries) } }))
  const syncs = await Promise.all([...folders].map(async (f) => [f, await api.gitSync(f)] as const))
  const known = store.state.gitSync
  if (syncs.some(([folder, value]) => JSON.stringify(known[folder] ?? null) !== JSON.stringify(value))) {
    store.set((s) => ({ ...s, gitSync: { ...s.gitSync, ...Object.fromEntries(syncs) } }))
  }
}

export function setTheme(id: string): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, theme: { ...s.settings.theme, id } } }))
  applyTheme(store.state.settings.theme)
  void saveSettings({ theme: store.state.settings.theme })
}

export function setImage(patch: Partial<BackgroundImage>): void {
  const image = { ...store.state.settings.theme.image, ...patch }
  const enabled = image.enabled && image.path !== null
  const theme = { ...store.state.settings.theme, image: { ...image, enabled } }
  store.set((s) => ({ ...s, settings: { ...s.settings, theme } }))
  applyTheme(theme, 'path' in patch)
  void saveSettings({ theme })
}

export function createProject(folder: string, name?: string): Project {
  const project: Project = { id: newId(), name: name || folderName(folder), folder, defaultAgent: 'claude' }
  store.set((s) => ({ ...s, settings: { ...s.settings, projects: [...s.settings.projects, project] } }))
  saveProjects()
  return project
}

export async function addProject(): Promise<Project | null> {
  const folder = await api.pickFolder()
  return folder ? createProject(folder) : null
}

export function updateProject(
  projectId: string,
  change: Partial<Pick<Project, 'name' | 'folder' | 'defaultAgent'>>
): void {
  const projects = store.state.settings.projects.map((p) => (p.id === projectId ? { ...p, ...change } : p))
  store.set((s) => ({ ...s, settings: { ...s.settings, projects } }))
  saveProjects()
}

export async function removeProject(projectId: string): Promise<void> {
  const project = projectById(store.state, projectId)
  if (!project) return
  const open = store.state.panes.filter((p) => p.projectId === projectId)
  const scoped = store.state.settings.snippets.filter((s) => s.projectId === projectId).length
  const snippetNote = scoped > 0 ? ` Its ${scoped} snippet${scoped === 1 ? '' : 's'} ${scoped === 1 ? 'is' : 'are'} removed too.` : ''
  const body =
    open.length > 0
      ? `This removes ${project.name} from Dawsha and stops its ${open.length} open session${open.length === 1 ? '' : 's'}. The folder stays on disk.${snippetNote}`
      : `This removes ${project.name} from Dawsha. The folder stays on disk.${snippetNote}`
  const confirmed = await confirmDialog({
    title: `Remove ${project.name}?`,
    body,
    confirmLabel: `Remove ${project.name}`
  })
  if (!confirmed) return
  for (const pane of open) await discardPane(pane.id)
  const projects = store.state.settings.projects.filter((p) => p.id !== projectId)
  const snippets = store.state.settings.snippets.filter((s) => s.projectId !== projectId)
  const keptSessions = store.state.settings.keptSessions.filter((s) => s.projectId !== projectId)
  const tasks = store.state.settings.tasks.filter((task) => task.projectId !== projectId)
  store.set((s) => ({ ...s, settings: { ...s.settings, projects, snippets, keptSessions, tasks } }))
  void saveSettings({ projects, snippets, keptSessions, tasks })
}

export function buildPane(saved: SavedPane, project: Project): PaneState {
  const tabs: TermState[] = []
  for (const tab of saved.tabs) {
    tabs.push({ ...makeTerm(tab.agent, tabs, tab.sessionId), label: tab.label, titleHint: tab.titleHint, agentsOpen: tab.agentsOpen, from: tab.from, baseline: tab.baseline })
  }
  return {
    id: newId(),
    projectId: project.id,
    tabs,
    activeTabId: tabs[Math.min(saved.activeIndex, tabs.length - 1)].id,
    fontSize: clampFontSize(saved.fontSize),
    folder: saved.folder,
    compare: saved.compare,
    pinned: saved.pinned === true ? true : undefined
  }
}

export async function restoreWorkspace(): Promise<void> {
  const { settings } = store.state
  const restored: PaneState[] = []
  for (const saved of settings.workspace.panes) {
    const project = projectById(store.state, saved.projectId)
    if (project) restored.push(buildPane(saved, project))
  }
  if (restored.length === 0) return
  const focused = restored[Math.min(settings.workspace.focusedIndex, restored.length - 1)]
  const pinned = restored.findIndex((pane) => pane.pinned === true)
  store.patch({
    panes: restored.map((pane, index) => (pane.pinned && index !== pinned ? { ...pane, pinned: undefined } : pane)),
    focusedId: focused.id,
    splits: settings.workspace.splits ?? {}
  })
  void refreshBranches()
  void refreshGitChanges()
  await Promise.all(
    restored.flatMap((pane) => pane.tabs.map((tab) => launch(pane.id, tab.id, canResume(tab))))
  )
}

export function setGeminiSessions(geminiSessions: GeminiSession[]): void {
  store.patch({ geminiSessions })
}

export function setCodexSessions(codexSessions: CodexSession[]): void {
  store.set((state) => adoptCodexIds({ ...state, codexSessions }))
}

function adoptCodexIds(state: AppState): AppState {
  const matched = matchAll(state).codex
  const adopted = new Map<string, string>()
  for (const pane of state.panes) {
    for (const tab of pane.tabs) {
      const hit = matched.get(tab.id)
      if (tab.agent === 'codex' && !tab.sessionId && hit) adopted.set(tab.id, hit.sessionId)
    }
  }
  if (adopted.size === 0) return state
  queueMicrotask(persistWorkspace)
  return {
    ...state,
    panes: state.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => (adopted.has(tab.id) ? { ...tab, sessionId: adopted.get(tab.id) } : tab))
    }))
  }
}

export function setOpsSnapshots(snapshots: OpsSnapshot[]): void {
  store.patch({ opsInfo: Object.fromEntries(snapshots.map((snapshot) => [snapshot.sessionId, snapshot])) })
}

export function setStatusInfos(infos: StatusInfo[]): void {
  store.patch({ statusInfo: Object.fromEntries(infos.map((info) => [info.sessionId, info])) })
}

function visibleFolders(state: AppState): string[] {
  if (state.view !== 'grid' || document.visibilityState !== 'visible') return []
  const folders = new Set<string>()
  const matches = matchAll(state)
  for (const pane of state.panes) {
    if (state.maximizedId && state.maximizedId !== pane.id) continue
    const folder = workFolderOfPane(state, pane, matches)
    if (folder) folders.add(folder)
  }
  return [...folders]
}

export async function refreshGitChanges(): Promise<void> {
  const folders = visibleFolders(store.state)
  const entries = await Promise.all(folders.map(async (f) => [f, await api.gitChanges(f)] as const))
  const known = store.state.gitChanges
  const changed = entries.some(([folder, value]) => JSON.stringify(known[folder]) !== JSON.stringify(value))
  if (changed) store.set((s) => ({ ...s, gitChanges: { ...s.gitChanges, ...Object.fromEntries(entries) } }))
}

export function setSessionInfo(change: Partial<SessionInfoSettings>): void {
  const sessionInfo = { ...store.state.settings.sessionInfo, ...change }
  store.set((s) => ({ ...s, settings: { ...s.settings, sessionInfo } }))
  void saveSettings({ sessionInfo })
}

export function setRecordings(change: Partial<RecordingSettings>): void {
  const recordings = sanitizeRecordings({ ...store.state.settings.recordings, ...change })
  store.set((s) => ({ ...s, settings: { ...s.settings, recordings } }))
  void saveSettings({ recordings })
}

export async function refreshBridge(): Promise<void> {
  const status = await api.bridgeStatus()
  store.set((s) => ({ ...s, bridge: { ...s.bridge, installed: status.installed, error: status.error } }))
}

const BRIDGE_COMMAND_NOTE = 'It then runs your previous status line, if any, and prints its output unchanged.'

export async function enableBridge(): Promise<void> {
  if (store.state.bridge.busy) return
  const preview = await api.bridgePreview()
  if (preview.error) {
    store.set((s) => ({ ...s, bridge: { ...s.bridge, error: preview.error, note: null } }))
    return
  }
  const previous = preview.previousCommand
    ? `Your current status line (${preview.previousCommand}) is backed up and keeps running.`
    : 'You have no status line set today.'
  const confirmed = await confirmDialog({
    title: 'Show live session info?',
    body:
      `This edits ~/.claude/settings.json (${preview.settingsPath}): its statusLine is set to a small script that ` +
      `saves each session's status for Dawsha. ${BRIDGE_COMMAND_NOTE} ${previous} ` +
      'Turning this off puts the previous value back.',
    confirmLabel: 'Edit ~/.claude/settings.json',
    danger: false
  })
  if (!confirmed) return
  await runBridge(() => api.bridgeInstall())
}

export async function disableBridge(): Promise<void> {
  if (store.state.bridge.busy) return
  await runBridge(() => api.bridgeUninstall())
}

async function runBridge(action: () => Promise<{ ok: boolean; error?: string; note?: string }>): Promise<void> {
  store.set((s) => ({ ...s, bridge: { ...s.bridge, busy: true, error: null, note: null } }))
  const result = await action()
  const status = await api.bridgeStatus()
  store.set((s) => ({
    ...s,
    bridge: {
      installed: status.installed,
      busy: false,
      error: result.ok ? status.error : (result.error ?? 'Could not change the status line.'),
      note: result.ok ? (result.note ?? null) : null
    }
  }))
}

export async function refreshAgentTools(force = false): Promise<void> {
  store.set((s) => ({ ...s, agents: { ...s.agents, checking: true } }))
  try {
    const report = await api.checkAgents(force)
    store.set((s) => ({ ...s, agents: { report, checking: false } }))
  } catch {
    store.set((s) => ({ ...s, agents: { ...s.agents, checking: false } }))
  }
}

async function openTaskTab(plan: TaskPlan, command: string, before: TermState['task']): Promise<void> {
  const state = store.state
  const target = paneById(state, state.focusedId)
  const base = { agent: 'shell' as const, command, task: before }
  if (target) {
    const tab: TermState = { ...makeTerm('shell', target.tabs, undefined, plan.label), ...base }
    store.set((s) => ({
      ...mapPane({ ...s, focusedId: target.id, view: 'grid' }, target.id, (p) => ({
        ...p,
        tabs: [...p.tabs, tab],
        activeTabId: tab.id
      }))
    }))
    await launch(target.id, tab.id, false)
    return
  }
  const tab: TermState = { ...makeTerm('shell', [], undefined, plan.label), ...base }
  const pane: PaneState = {
    id: newId(),
    projectId: AGENTS_PROJECT_ID,
    tabs: [tab],
    activeTabId: tab.id,
    fontSize: DEFAULT_FONT_SIZE
  }
  store.set((s) => ({ ...s, panes: [...s.panes, pane], focusedId: pane.id, view: 'grid', sidebarOverride: null }))
  await launch(pane.id, tab.id, false)
}

export async function runAgentTask(selection: AgentKind[] | 'updates'): Promise<void> {
  const { report } = store.state.agents
  if (!report) return
  const plan = planFor(report.tools, selection)
  if (!plan) return
  const needsNode = report.tools.some((tool) => plan.agents.includes(tool.agent) && toolCommand(tool).needsNode)
  if (needsNode && nodeProblem(report.node)) {
    toast(NODE_NOTE, 'info')
    return
  }
  const command = joinCommands(plan.commands, store.state.info.shellCommand)
  await openTaskTab(plan, command, { agents: plan.agents, before: report.tools })
}

async function finishAgentTask(tab: TermState, exitCode: number): Promise<void> {
  const task = tab.task
  if (!task) return
  await refreshAgentTools(false)
  const after = store.state.agents.report?.tools ?? []
  const outcomes = task.agents.flatMap((agent) => {
    const before = task.before.find((t) => t.agent === agent)
    return before ? [taskOutcome(before, after.find((t) => t.agent === agent), exitCode)] : []
  })
  if (outcomes.length === 0) return
  toast(outcomes.map((o) => o.text).join(' '), outcomes.every((o) => o.ok) ? 'info' : 'error')
}

export interface OpenSession {
  paneId: string
  termId: string
  number: number
}

export function findOpenSession(state: AppState, agent: AgentKind, sessionId: string): OpenSession | null {
  const matched = matchAll(state)[agent] as Map<string, { sessionId: string }>
  for (const [index, pane] of state.panes.entries()) {
    for (const tab of pane.tabs) {
      if (tab.agent !== agent || tab.status === 'exited') continue
      if ((tab.sessionId ?? matched.get(tab.id)?.sessionId) === sessionId) {
        return { paneId: pane.id, termId: tab.id, number: index + 1 }
      }
    }
  }
  return null
}

export function focusOpenSession(open: OpenSession): void {
  store.set((s) =>
    mapPane({ ...s, focusedId: open.paneId, view: 'grid', quickPickOpen: false }, open.paneId, (p) => ({
      ...p,
      activeTabId: open.termId
    }))
  )
  persistWorkspace()
}

export interface ResumeOutcome {
  pane: number
  alreadyOpen: boolean
}

export async function resumeInNewPane(session: ResumeSession): Promise<ResumeOutcome> {
  const open = findOpenSession(store.state, session.agent, session.id)
  if (open) {
    focusOpenSession(open)
    return { pane: open.number, alreadyOpen: true }
  }
  const pane = await startSession(session.projectId, session.agent, session.id, true, session.title)
  return { pane, alreadyOpen: false }
}

export async function resumeInFocusedPane(session: ResumeSession): Promise<ResumeOutcome> {
  const state = store.state
  const open = findOpenSession(state, session.agent, session.id)
  if (open) {
    focusOpenSession(open)
    return { pane: open.number, alreadyOpen: true }
  }
  const pane = paneById(state, state.focusedId)
  if (!pane || pane.projectId !== session.projectId) {
    if (pane) toast('The focused pane belongs to another project, so the session opened in a new pane.', 'info')
    return resumeInNewPane(session)
  }
  const active = pane.tabs.find((t) => t.id === pane.activeTabId)
  if (!active) return resumeInNewPane(session)
  if (active.agent !== 'shell' && active.status !== 'exited') {
    const project = projectById(state, pane.projectId)?.name ?? 'this project'
    const confirmed = await confirmDialog({
      title: `Replace ${active.label}?`,
      body: `This stops the ${AGENT_NAMES[active.agent]} terminal ${active.label} in ${project} and resumes '${session.title}' in its place. Its files stay on disk.`,
      confirmLabel: `Replace ${active.label}`
    })
    if (!confirmed) return { pane: 0, alreadyOpen: false }
  }
  await stopTerminal(active.id)
  const others = pane.tabs.filter((t) => t.id !== active.id)
  const tab: TermState = { ...makeTerm(session.agent, others, session.id), titleHint: session.title, resumeChipAt: Date.now() }
  store.set((s) =>
    mapPane({ ...s, focusedId: pane.id, view: 'grid', quickPickOpen: false }, pane.id, (p) => ({
      ...p,
      tabs: p.tabs.map((t) => (t.id === active.id ? tab : t)),
      activeTabId: tab.id
    }))
  )
  persistWorkspace()
  await launch(pane.id, tab.id, true)
  return { pane: store.state.panes.findIndex((p) => p.id === pane.id) + 1, alreadyOpen: false }
}

export async function startInFocusedPane(projectId: string, agent: AgentKind | undefined): Promise<number> {
  const state = store.state
  const pane = paneById(state, state.focusedId)
  const project = projectById(state, projectId)
  if (!pane || !project || pane.projectId !== projectId) return startSession(projectId, agent)
  await addTab(pane.id, agent ?? agentOf(project))
  return state.panes.findIndex((p) => p.id === pane.id) + 1
}
