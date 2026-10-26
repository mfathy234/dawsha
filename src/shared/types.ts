import type { OrchSettings } from './orch/profiles'
import type { SessionBaseline } from './gitStatus'
import type { SessionsLayout } from './board'
import type { HighlightSettings } from './highlights'
import type { RecordingSettings } from './recordings'
import type { SessionTag } from './sessionTags'
export type AgentKind = 'claude' | 'codex' | 'gemini'
export type TabAgent = AgentKind | 'shell'
export type SessionStatus = 'busy' | 'idle'

export interface Project {
  id: string
  name: string
  folder: string
  defaultAgent: AgentKind
  fontSize?: number
  pinned?: boolean
}

export interface BackgroundImage {
  enabled: boolean
  path: string | null
  dim: number
  blur: number
}

export interface ThemeSettings {
  id: string
  image: BackgroundImage
}

export interface CompareSide {
  path: string
  branch: string
}

export interface CompareNames {
  a: CompareSide
  b: CompareSide
}

export interface CompareLink {
  id: string
  slot: 'a' | 'b'
  prompt: string
  repo: string
  sides: CompareNames | null
}

export interface SavedTab {
  agent: TabAgent
  label: string
  titleHint?: string
  sessionId?: string
  agentsOpen?: boolean
  from?: AgentKind
  baseline?: SessionBaseline
  /** The orchestrator agent this pane runs; it reconnects with a fresh token when restored. */
  orchAgentId?: string
  /** The user's own name for this session, shown instead of the one the agent reports. */
  name?: string
  tag?: SessionTag
}

export interface SavedPane {
  projectId: string
  folder?: string
  compare?: CompareLink
  tabs: SavedTab[]
  activeIndex: number
  fontSize: number
  pinned?: boolean
}

export interface GridSplit {
  cols: number[]
  rows: number[]
}

export type GridSplits = Record<string, GridSplit>

export interface Workspace {
  panes: SavedPane[]
  focusedIndex: number
  splits?: GridSplits
}

export interface SavedLayout {
  id: string
  name: string
  createdAt: number
  focusedIndex: number
  panes: SavedPane[]
  splits?: GridSplits
}

export interface KeptSession {
  projectId: string
  agent: AgentKind
  sessionId: string
  title: string
  closedAt: number
  /** The title was typed by the user, so it stays the session's name when reopened. */
  renamed?: true
  tag?: SessionTag
}

export interface ProjectTask {
  id: string
  projectId: string
  title: string
  note: string
  createdAt: number
  sessionKeys: string[]
  events: { id: string; kind: 'note' | 'commit'; text: string; at: number }[]
}

export interface SessionInfoSettings {
  notifications: boolean
  sound: boolean
}

export interface Settings {
  version: 2
  projects: Project[]
  theme: ThemeSettings
  sidebarCollapsed: boolean
  dimOtherPanes: boolean
  showRecap: boolean
  colorSessionsByTag: boolean
  sidebarWidth: number
  othersCollapsed: boolean
  sessionsLayout: SessionsLayout
  sessionInfo: SessionInfoSettings
  onboardingDismissed: boolean
  workspace: Workspace
  layouts: SavedLayout[]
  keptSessions: KeptSession[]
  /** Ids of projects whose session list is folded in the sidebar. */
  foldedProjects: string[]
  /** Ids of projects whose "Closed sessions" group is folded in the sidebar. */
  foldedClosedSessions: string[]
  /** The user's own names and links for tickets on the Work dashboard, by ticket key. */
  ticketNotes: import('./ticketNotes').TicketNotes
  tasks: ProjectTask[]
  lastSeenVersion: string | null
  autoUpdateCheck: boolean
  paletteShortcut: string
  fullAccess: FullAccess
  remoteAccess: RemoteAccessSettings
  highlights: HighlightSettings
  recordings: RecordingSettings
  dictation: import('./dictation').DictationSettings
  experimental: ExperimentalSettings
  orchestrator: OrchSettings
}

/** Features that used to be opt-in. The orchestrator is always on since 1.5; the key stays so older settings files load. */
export interface ExperimentalSettings {
  orchestrator: boolean
}

export type FullAccess = Record<AgentKind, boolean>

export interface RemoteAccessSettings {
  allowedEmail: string
  terminalInput: boolean
  sessionControl: boolean
  approvals: boolean
  approvalsNotify: boolean
  approvalsOnlyWhenAway: boolean
  approvalsAwayMinutes: number
  approvalsAllowConfigEdits: boolean
}

export interface RemoteAccessDevice {
  id: string
  name: string
  pairedAt: number
  lastSeenAt: number
}

export interface RemoteAccessState {
  status: 'off' | 'setup-required' | 'connecting' | 'reconnecting' | 'available'
  enabled: boolean
  url: string | null
  message: string
  notice: string | null
  devices: RemoteAccessDevice[]
  pairing: { code: string; expiresAt: number } | null
  permissions: RemoteAccessSettings
}

export interface SettingsLoadResult {
  settings: Settings
  warning: string | null
}

export interface SessionFile {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  nameSource?: string
  status?: string
  startedAt?: number
  updatedAt?: number
  procStart?: string | number
  permissionDenied?: boolean
}

export interface CodexSession {
  sessionId: string
  cwd: string
  name?: string
  startedAt: number
  updatedAt: number
  status: SessionStatus
  model?: string
  contextPercent?: number
}

export interface GeminiSession {
  sessionId: string
  name?: string
  startedAt: number
  updatedAt: number
  model?: string
  recentTools?: { name: string; at: number }[]
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'codex' | 'gemini' | 'other'

export interface RateLimitWindow {
  key: string
  label: string
  percent: number
  resetsAt: number | null
  family?: ModelFamily
}

export interface StatusInfo {
  sessionId: string
  modelId: string | null
  modelName: string | null
  family: ModelFamily
  cwd: string | null
  costUsd: number | null
  contextPercent: number | null
  rateLimits: RateLimitWindow[]
  receivedAt: number
}

export interface GitChanges {
  files: number
  added: number
  removed: number
}

export interface ResumeEntry {
  id: string
  title: string
  modifiedAt: number
}

export interface ResumeSession {
  /** Transcript metadata reused by the work dashboard. */
  workBranch?: string | null
  lastActivityAt?: number
  /** When the session was active (from its sampled activity); work time is counted from these. */
  activeSpans?: [number, number][]
  orchestrated?: true
  agent: AgentKind
  id: string
  title: string
  projectId: string
  modifiedAt: number
  startedAt: number
  messageCount: number
  model?: string
  firstPrompt?: string
  lastAssistant?: string
  matchExcerpt?: string
}

export interface ResumeQuery {
  projectId?: string
  agent?: AgentKind
  query?: string
  searchContent?: boolean
  limit?: number
}

export type QuickOpenKind = 'vscode' | 'explorer' | 'visualstudio'

export interface BridgePreview {
  settingsPath: string
  previousCommand: string | null
  error: string | null
}

export interface BridgeStatus {
  installed: boolean
  settingsPath: string
  error: string | null
}

export type BridgeResult = { ok: true; note?: string } | { ok: false; error: string }

export interface NotifyRequest {
  paneId: string
  title: string
  body: string
  sound: boolean
}

export interface SpawnRequest {
  id: string
  projectId?: string
  agent: TabAgent
  cwd: string
  resume: boolean
  sessionId?: string
  cols: number
  rows: number
  command?: string
  prompt?: string
  title?: string
  fullAccess?: boolean
  desktopVisible?: boolean
  remoteManaged?: boolean
  /** Set for orchestrator agent panes; the main process adds the agent's launch args and token. */
  orchAgentId?: string
}

export interface RemoteSessionStarted {
  id: string
  projectId: string
  agent: AgentKind
  pid: number
  sessionId?: string
}

/** `retired`: the pane belongs to an orchestrator agent that has finished, so the pane can simply go away. */
export type SpawnResult = { ok: true; pid: number } | { ok: false; error: string; retired?: boolean }

export interface RepoProbe {
  isRepo: boolean
  hasCommits: boolean
  branch: string | null
}

export type WorktreesResult = { ok: true; sides: CompareNames } | { ok: false; error: string }

export interface WorktreeRemoval {
  repo: string
  path: string
  branch: string
  force: boolean
}

export type GitResult = { ok: true } | { ok: false; error: string }

export interface FolderCheck {
  ok: boolean
  error?: string
}

export interface AppInfo {
  claudeCommand: string
  codexCommand: string
  geminiCommand: string
  shellCommand: string
  home: string
  userData: string
  version: string
}

export const DEFAULT_FONT_SIZE = 15
export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 28

export const clampFontSize = (value: number): number =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
