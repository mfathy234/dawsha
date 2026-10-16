import { defaultOrchSettings, sanitizeOrchSettings } from './orch/profiles'
import { isAgent } from './agents'
import { isSessionsLayout } from './board'
import { sanitizeBaseline } from './gitStatus'
import { DEFAULT_THEME_ID, resolveThemeId } from './themes'
import { formatShortcut, parseShortcut } from './shortcuts'
import { isVersion } from './version'
import { sanitizeSplits } from './splits'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from './sidebarWidth'
import { defaultHighlights, sanitizeHighlights } from './highlights'
import { defaultRecordings, sanitizeRecordings } from './recordings'
import {
  DEFAULT_FONT_SIZE,
  clampFontSize,
  type BackgroundImage,
  type CompareLink,
  type CompareNames,
  type FullAccess,
  type KeptSession,
  type ProjectTask,
  type Project,
  type RemoteAccessSettings,
  type SavedLayout,
  type SavedPane,
  type SavedTab,
  type Settings,
  type Snippet,
  type TabAgent,
  type Workspace
} from './types'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

let idCounter = 0
const makeId = (): string => {
  idCounter += 1
  return `p-${Date.now().toString(36)}-${idCounter}`
}

export const DEFAULT_PALETTE_SHORTCUT = 'Ctrl+K'

export const defaultFullAccess = (): FullAccess => ({ claude: true, codex: true, gemini: false })
export const defaultRemoteAccess = (): RemoteAccessSettings => ({
  allowedEmail: '',
  terminalInput: false,
  sessionControl: false,
  approvals: false,
  approvalsNotify: true,
  approvalsOnlyWhenAway: false,
  approvalsAwayMinutes: 3,
  approvalsAllowConfigEdits: false
})

export const defaultImage = (): BackgroundImage => ({ enabled: false, path: null, dim: 60, blur: 0 })

export const defaultSettings = (): Settings => ({
  version: 2,
  projects: [],
  theme: { id: DEFAULT_THEME_ID, image: defaultImage() },
  sidebarCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  othersCollapsed: false,
  sessionsLayout: 'grid',
  sessionInfo: { notifications: true, sound: false },
  onboardingDismissed: false,
  workspace: { panes: [], focusedIndex: 0 },
  layouts: [],
  snippets: [],
  keptSessions: [],
  tasks: [],
  lastSeenVersion: null,
  autoUpdateCheck: true,
  paletteShortcut: DEFAULT_PALETTE_SHORTCUT,
  fullAccess: defaultFullAccess(),
  remoteAccess: defaultRemoteAccess(),
  highlights: defaultHighlights(),
  recordings: defaultRecordings(),
  experimental: { orchestrator: false },
  orchestrator: defaultOrchSettings()
})

function sanitizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const projects: Project[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const folder = asString(item.folder) ?? asString(item.path)
    if (!folder) continue
    const folderName = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folder
    let id = asString(item.id) ?? makeId()
    if (seen.has(id)) id = makeId()
    seen.add(id)
    const project: Project = {
      id,
      name: asString(item.name) ?? folderName,
      folder,
      defaultAgent: isAgent(item.defaultAgent) ? item.defaultAgent : 'claude'
    }
    if (typeof item.fontSize === 'number') project.fontSize = clampFontSize(item.fontSize)
    projects.push(project)
  }
  return projects
}

function sanitizeImage(value: unknown): BackgroundImage {
  const base = defaultImage()
  if (!isRecord(value)) return base
  const path = asString(value.path)
  return {
    enabled: value.enabled === true && path !== null,
    path,
    dim: clampNumber(value.dim, 0, 90, base.dim),
    blur: clampNumber(value.blur, 0, 20, base.blur)
  }
}

function sanitizeTab(value: unknown): SavedTab | null {
  if (!isRecord(value)) return null
  const raw = value.agent ?? value.kind
  const agent: TabAgent = raw === 'shell' ? 'shell' : isAgent(raw) ? raw : 'claude'
  const tab: SavedTab = { agent, label: asString(value.label) ?? agent }
  const titleHint = asString(value.titleHint)
  if (titleHint && agent !== 'shell') tab.titleHint = titleHint
  const sessionId = asString(value.sessionId)
  if (sessionId && agent !== 'shell') tab.sessionId = sessionId
  if (value.agentsOpen === true && agent === 'claude') tab.agentsOpen = true
  if (isAgent(value.from) && agent !== 'shell') tab.from = value.from
  const baseline = sanitizeBaseline(value.baseline)
  if (baseline) tab.baseline = baseline
  return tab
}

function sanitizeSide(value: unknown): { path: string; branch: string } | null {
  if (!isRecord(value)) return null
  const path = asString(value.path)
  const branch = asString(value.branch)
  return path && branch ? { path, branch } : null
}

function sanitizeSides(value: unknown): CompareNames | null {
  if (!isRecord(value)) return null
  const a = sanitizeSide(value.a)
  const b = sanitizeSide(value.b)
  return a && b ? { a, b } : null
}

export const COMPARE_PROMPT_LIMIT = 8000

function sanitizeCompare(value: unknown): CompareLink | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const repo = asString(value.repo)
  if (!id || !repo || (value.slot !== 'a' && value.slot !== 'b')) return null
  const prompt = typeof value.prompt === 'string' ? value.prompt.slice(0, COMPARE_PROMPT_LIMIT) : ''
  return { id, slot: value.slot, prompt, repo, sides: sanitizeSides(value.sides) }
}

function sanitizePane(item: unknown): SavedPane | null {
  if (!isRecord(item)) return null
  const projectId = asString(item.projectId)
  if (!projectId) return null
  const tabs = (Array.isArray(item.tabs) ? item.tabs : [])
    .map(sanitizeTab)
    .filter((tab): tab is SavedTab => tab !== null)
  if (tabs.length === 0) return null
  const activeIndex = clampNumber(item.activeIndex, 0, tabs.length - 1, 0)
  const fontSize = clampFontSize(typeof item.fontSize === 'number' ? item.fontSize : DEFAULT_FONT_SIZE)
  const pane: SavedPane = { projectId, tabs, activeIndex: Math.round(activeIndex), fontSize }
  const folder = asString(item.folder)
  if (folder) pane.folder = folder
  const compare = sanitizeCompare(item.compare)
  if (compare) pane.compare = compare
  if (item.pinned === true) pane.pinned = true
  return pane
}

function singlePin(panes: SavedPane[]): SavedPane[] {
  const first = panes.findIndex((pane) => pane.pinned === true)
  return panes.map((pane, index) => {
    if (pane.pinned !== true || index === first) return pane
    const { pinned: _pinned, ...rest } = pane
    return rest
  })
}

function sanitizePanes(value: unknown): SavedPane[] {
  const panes = (Array.isArray(value) ? value : []).map(sanitizePane).filter((pane): pane is SavedPane => pane !== null)
  return singlePin(panes)
}

function focusedIn(value: unknown, count: number): number {
  return Math.round(clampNumber(value, 0, Math.max(0, count - 1), 0))
}

function sanitizeWorkspace(value: unknown, projectIds: Set<string>): Workspace {
  if (!isRecord(value) || !Array.isArray(value.panes)) return { panes: [], focusedIndex: 0 }
  const panes = singlePin(sanitizePanes(value.panes).filter((pane) => projectIds.has(pane.projectId)))
  const workspace: Workspace = { panes, focusedIndex: focusedIn(value.focusedIndex, panes.length) }
  const splits = sanitizeSplits(value.splits)
  if (splits) workspace.splits = splits
  return workspace
}

export const MAX_LAYOUTS = 50
export const LAYOUT_NAME_MAX = 40

function sanitizeLayouts(value: unknown): SavedLayout[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const layouts: SavedLayout[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = asString(item.name)?.trim().slice(0, LAYOUT_NAME_MAX)
    const panes = sanitizePanes(item.panes)
    if (!name || panes.length === 0) continue
    let id = asString(item.id) ?? makeId()
    if (seen.has(id)) id = makeId()
    seen.add(id)
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0
    const layout: SavedLayout = { id, name, createdAt, focusedIndex: focusedIn(item.focusedIndex, panes.length), panes }
    const splits = sanitizeSplits(item.splits)
    if (splits) layout.splits = splits
    layouts.push(layout)
  }
  return layouts.slice(0, MAX_LAYOUTS)
}

export const MAX_SNIPPETS = 100
export const SNIPPET_NAME_MAX = 60
export const SNIPPET_TEXT_MAX = 4000

function sanitizeSnippets(value: unknown, projectIds: Set<string>): Snippet[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const snippets: Snippet[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = asString(item.name)?.trim().slice(0, SNIPPET_NAME_MAX)
    const text = asString(item.text)?.slice(0, SNIPPET_TEXT_MAX)
    if (!name || !text) continue
    const scope = asString(item.projectId)
    if (scope && !projectIds.has(scope)) continue
    let id = asString(item.id) ?? makeId()
    if (seen.has(id)) id = makeId()
    seen.add(id)
    const key = item.shortcut
    const shortcut = typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= 9 ? key : null
    snippets.push({ id, name, text, projectId: scope, shortcut })
  }
  return snippets.slice(0, MAX_SNIPPETS)
}

function sanitizeFullAccess(value: unknown): FullAccess {
  const defaults = defaultFullAccess()
  if (!isRecord(value)) return defaults
  const pick = (agent: keyof FullAccess): boolean => (typeof value[agent] === 'boolean' ? (value[agent] as boolean) : defaults[agent])
  return { claude: pick('claude'), codex: pick('codex'), gemini: pick('gemini') }
}

export function clampAwayMinutes(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(60, Math.max(1, Math.round(value))) : fallback
}

function sanitizeRemoteAccess(value: unknown): RemoteAccessSettings {
  const defaults = defaultRemoteAccess()
  if (!isRecord(value)) return defaults
  return {
    allowedEmail: typeof value.allowedEmail === 'string' && value.allowedEmail.length <= 254 ? value.allowedEmail : '',
    terminalInput: value.terminalInput === true,
    sessionControl: value.sessionControl === true,
    approvals: value.approvals === true,
    approvalsNotify: typeof value.approvalsNotify === 'boolean' ? value.approvalsNotify : defaults.approvalsNotify,
    approvalsOnlyWhenAway: value.approvalsOnlyWhenAway === true,
    approvalsAwayMinutes: clampAwayMinutes(value.approvalsAwayMinutes, defaults.approvalsAwayMinutes),
    approvalsAllowConfigEdits: value.approvalsAllowConfigEdits === true
  }
}

function sanitizeKeptSessions(value: unknown, projectIds: Set<string>): KeptSession[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sessions: KeptSession[] = []
  for (const item of value) {
    if (!isRecord(item) || !projectIds.has(String(item.projectId)) || !isAgent(item.agent)) continue
    const sessionId = asString(item.sessionId)
    const title = asString(item.title)
    if (!sessionId || !title) continue
    const key = `${item.agent}:${sessionId}`
    if (seen.has(key)) continue
    seen.add(key)
    sessions.push({ projectId: String(item.projectId), agent: item.agent, sessionId, title: title.slice(0, 160), closedAt: clampNumber(item.closedAt, 0, Date.now() + 86_400_000, Date.now()) })
  }
  return sessions.slice(-500)
}

function sanitizeTasks(value: unknown, projectIds: Set<string>): ProjectTask[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tasks: ProjectTask[] = []
  for (const item of value) {
    if (!isRecord(item) || !projectIds.has(String(item.projectId))) continue
    const id = asString(item.id)
    const title = asString(item.title)
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    const events = (Array.isArray(item.events) ? item.events : []).flatMap((event) => {
      if (!isRecord(event) || (event.kind !== 'note' && event.kind !== 'commit')) return []
      const eventId = asString(event.id)
      const text = asString(event.text)
      return eventId && text ? [{ id: eventId, kind: event.kind as 'note' | 'commit', text: text.slice(0, 500), at: clampNumber(event.at, 0, Date.now() + 86_400_000, Date.now()) }] : []
    }).slice(-300)
    tasks.push({ id, projectId: String(item.projectId), title: title.slice(0, 160), note: typeof item.note === 'string' ? item.note.slice(0, 4000) : '', createdAt: clampNumber(item.createdAt, 0, Date.now() + 86_400_000, Date.now()), sessionKeys: Array.isArray(item.sessionKeys) ? [...new Set(item.sessionKeys.filter((key): key is string => typeof key === 'string' && /^(claude|codex|gemini):[^:]+$/.test(key)))].slice(0, 100) : [], events })
  }
  return tasks.slice(0, 300)
}

function sanitizeShortcut(value: unknown): string {
  const binding = typeof value === 'string' ? parseShortcut(value) : null
  return binding ? formatShortcut(binding) : DEFAULT_PALETTE_SHORTCUT
}

export function migrateSettings(raw: unknown): Settings {
  const defaults = defaultSettings()
  if (!isRecord(raw)) return defaults
  const projects = sanitizeProjects(raw.projects)
  const theme = isRecord(raw.theme) ? raw.theme : {}
  const info = isRecord(raw.sessionInfo) ? raw.sessionInfo : {}
  return {
    version: 2,
    projects,
    theme: { id: resolveThemeId(asString(theme.id) ?? defaults.theme.id), image: sanitizeImage(theme.image) },
    sidebarCollapsed: raw.sidebarCollapsed === true,
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth),
    othersCollapsed: raw.othersCollapsed === true,
    sessionsLayout: isSessionsLayout(raw.sessionsLayout) ? raw.sessionsLayout : 'grid',
    sessionInfo: {
      notifications: typeof info.notifications === 'boolean' ? info.notifications : defaults.sessionInfo.notifications,
      sound: typeof info.sound === 'boolean' ? info.sound : defaults.sessionInfo.sound
    },
    onboardingDismissed: raw.onboardingDismissed === true,
    workspace: sanitizeWorkspace(raw.workspace, new Set(projects.map((p) => p.id))),
    layouts: sanitizeLayouts(raw.layouts),
    snippets: sanitizeSnippets(raw.snippets, new Set(projects.map((p) => p.id))),
    keptSessions: sanitizeKeptSessions(raw.keptSessions, new Set(projects.map((p) => p.id))),
    tasks: sanitizeTasks(raw.tasks, new Set(projects.map((p) => p.id))),
    lastSeenVersion: isVersion(raw.lastSeenVersion) ? raw.lastSeenVersion : null,
    autoUpdateCheck: raw.autoUpdateCheck !== false,
    paletteShortcut: sanitizeShortcut(raw.paletteShortcut),
    fullAccess: sanitizeFullAccess(raw.fullAccess),
    remoteAccess: sanitizeRemoteAccess(raw.remoteAccess),
    highlights: sanitizeHighlights(raw.highlights),
    recordings: sanitizeRecordings(raw.recordings),
    experimental: { orchestrator: isRecord(raw.experimental) && raw.experimental.orchestrator === true },
    orchestrator: sanitizeOrchSettings(raw.orchestrator)
  }
}
