import type { OrchSnapshot } from '../shared/orch/api'
import { defaultSettings } from '../shared/settingsSchema'
import type { AgentPreset } from '../shared/quickPick'
import type { SyncCounts } from '../shared/gitBranches'
import type { AgentsReport, ToolReport } from '../shared/agentTools'
import type { Attention } from '../shared/attention'
import { emptySnapshot, type UsageSnapshot } from '../shared/sessionCost'
import type { OpsSnapshot } from '../shared/opsFeed'
import type { ProcessActivity } from '../shared/processActivity'
import type { ChangelogEntry } from '../shared/changelog'
import { initialUpdateState, type UpdateState } from '../shared/updates'
import type {
  AgentKind,
  AppInfo,
  CompareLink,
  CodexSession,
  GeminiSession,
  GitChanges,
  GridSplits,
  Project,
  SessionFile,
  Settings,
  StatusInfo,
  TabAgent
} from '../shared/types'
import type { SessionBaseline } from '../shared/gitStatus'
import type { SessionTag } from '../shared/sessionTags'

export interface TermState {
  id: string
  agent: TabAgent
  label: string
  titleHint?: string
  sessionId?: string
  pid?: number
  startedAt: number
  status: 'starting' | 'running' | 'exited'
  exitCode?: number
  resumed?: boolean
  resumeChipAt?: number
  retried?: boolean
  command?: string
  prompt?: string
  from?: AgentKind
  baseline?: SessionBaseline
  task?: { agents: AgentKind[]; before: ToolReport[] }
  /** Orchestrator agent run in this tab. */
  orchAgentId?: string
  /** The user's own name for the session; it wins over the name the agent reports. */
  name?: string
  tag?: SessionTag
}

export interface PaneState {
  id: string
  projectId: string
  tabs: TermState[]
  activeTabId: string
  fontSize: number
  folder?: string
  compare?: CompareLink
  pinned?: boolean
}

export type QuickPickMode = 'new' | 'resume'

export type View = 'grid' | 'background' | 'projects' | 'agents' | 'skills' | 'usage' | 'work' | 'settings' | 'replay' | 'orchestrator' | 'files'

/** Tabs of the Orchestrator view. A selected run (orchRunId) shows its dashboard instead. */
export type OrchTab = 'runs' | 'boards' | 'review' | 'history' | 'new' | 'spec'

export interface ReplayRef {
  id: string
  returnView: View
}

export type SettingsSection = 'general' | 'notifications' | 'agents' | 'updates' | 'highlights' | 'changelog' | 'about' | 'remote' | 'orchestrator'

export type ProjectsTab = 'projects' | 'tasks' | 'instructions'

export interface AgentsState {
  report: AgentsReport | null
  checking: boolean
}

export const AGENTS_PROJECT_ID = '__agents__'

export interface BridgeState {
  installed: boolean
  busy: boolean
  error: string | null
  note: string | null
}

export interface WhatsNewView {
  version: string
  from: string | null
  entries: ChangelogEntry[]
}

export interface AppState {
  ready: boolean
  settings: Settings
  panes: PaneState[]
  focusedId: string | null
  maximizedId: string | null
  splits: GridSplits
  view: View
  replay: ReplayRef | null
  replayPickerOpen: boolean
  settingsSection: SettingsSection
  /** Latest orchestrator state from the main process; null until loaded or while it is off. */
  orch: OrchSnapshot | null
  orchTab: OrchTab
  orchRunId: string | null
  projectsTab: ProjectsTab
  instructionsProject: string | null
  sessions: SessionFile[]
  codexSessions: CodexSession[]
  geminiSessions: GeminiSession[]
  branches: Record<string, string | null>
  gitSync: Record<string, SyncCounts | null>
  statusInfo: Record<string, StatusInfo>
  opsInfo: Record<string, OpsSnapshot>
  processActivity: Record<string, ProcessActivity[]>
  detailsPaneId: string | null
  timelinePaneId: string | null
  boardPeekId: string | null
  gitChanges: Record<string, GitChanges | null>
  usage: UsageSnapshot
  attention: Record<string, Attention>
  waiting: Record<string, boolean>
  contextDismissed: Record<string, number>
  bridge: BridgeState
  agents: AgentsState
  windowFocused: boolean
  now: number
  sidebarOverride: boolean | null
  closedShowAll: Record<string, boolean>
  quickPickOpen: boolean
  quickPickPreset: AgentPreset
  quickPickMode: QuickPickMode
  resumeProjectId: string | null
  onboardingOpen: boolean
  paletteOpen: boolean
  layoutsOpen: boolean
  themePickerOpen: boolean
  update: UpdateState
  updatePopoverOpen: boolean
  whatsNew: WhatsNewView | null
  info: AppInfo
}

export const initialState = (): AppState => ({
  ready: false,
  settings: defaultSettings(),
  panes: [],
  focusedId: null,
  maximizedId: null,
  splits: {},
  view: 'grid',
  replay: null,
  replayPickerOpen: false,
  settingsSection: 'general',
  orch: null,
  orchTab: 'runs',
  orchRunId: null,
  projectsTab: 'projects',
  instructionsProject: null,
  sessions: [],
  codexSessions: [],
  geminiSessions: [],
  branches: {},
  gitSync: {},
  statusInfo: {},
  opsInfo: {},
  processActivity: {},
  detailsPaneId: null,
  timelinePaneId: null,
  boardPeekId: null,
  gitChanges: {},
  usage: emptySnapshot(),
  attention: {},
  waiting: {},
  contextDismissed: {},
  bridge: { installed: false, busy: false, error: null, note: null },
  agents: { report: null, checking: false },
  windowFocused: true,
  now: Date.now(),
  sidebarOverride: null,
  closedShowAll: {},
  quickPickOpen: false,
  quickPickPreset: 'default',
  quickPickMode: 'new',
  resumeProjectId: null,
  onboardingOpen: false,
  paletteOpen: false,
  layoutsOpen: false,
  themePickerOpen: false,
  update: initialUpdateState(),
  updatePopoverOpen: false,
  whatsNew: null,
  info: { claudeCommand: 'claude.exe', codexCommand: 'codex', geminiCommand: 'gemini', shellCommand: 'powershell.exe', home: '', userData: '', version: '' }
})

type Listener = (state: AppState) => void

class Store {
  private current: AppState = initialState()
  private readonly listeners = new Set<Listener>()
  private scheduled = false

  get state(): AppState {
    return this.current
  }

  set(update: (state: AppState) => AppState): void {
    this.current = update(this.current)
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => {
      this.scheduled = false
      for (const listener of this.listeners) listener(this.current)
    })
  }

  patch(partial: Partial<AppState>): void {
    this.set((state) => ({ ...state, ...partial }))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const store = new Store()

export const projectById = (state: AppState, id: string): Project | undefined =>
  state.settings.projects.find((p) => p.id === id) ??
  (id === AGENTS_PROJECT_ID ? { id, name: 'Agent tools', folder: state.info.home, defaultAgent: 'claude' } : undefined)

export const folderOfPane = (state: AppState, pane: PaneState): string | null =>
  pane.folder ?? projectById(state, pane.projectId)?.folder ?? null

export const paneById = (state: AppState, id: string | null): PaneState | undefined =>
  id ? state.panes.find((p) => p.id === id) : undefined

export const mapPane = (state: AppState, id: string, change: (pane: PaneState) => PaneState): AppState => ({
  ...state,
  panes: state.panes.map((pane) => (pane.id === id ? change(pane) : pane))
})

export const mapTerm = (
  state: AppState,
  termId: string,
  change: (term: TermState) => TermState
): AppState => ({
  ...state,
  panes: state.panes.map((pane) =>
    pane.tabs.some((t) => t.id === termId)
      ? { ...pane, tabs: pane.tabs.map((t) => (t.id === termId ? change(t) : t)) }
      : pane
  )
})

export const newId = (): string => crypto.randomUUID()
