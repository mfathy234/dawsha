import { migrateSettings, MAX_LAYOUTS } from './settingsSchema'
import type { Project, SavedLayout, Settings } from './types'

export const TRANSFER_APP = 'dawsha'
export const TRANSFER_KIND = 'settings-export'
export const TRANSFER_VERSION = 1
export const TRANSFER_MAX_BYTES = 2 * 1024 * 1024

export const INCLUDED_KEYS = [
  'projects',
  'layouts',
  'highlights',
  'theme',
  'paletteShortcut',
  'sessionsLayout',
  'recordings',
  'dictation',
  'sessionInfo',
  'autoUpdateCheck',
  'sidebarCollapsed',
  'dimIdlePanes',
  'showRecap',
  'sidebarWidth',
  'othersCollapsed',
  'orchestrator'
] as const satisfies readonly (keyof Settings)[]

export const EXCLUDED_KEYS = [
  'version',
  'remoteAccess',
  'workspace',
  'keptSessions',
  // Keyed by this PC's project ids, like closed sessions.
  'foldedProjects',
  'foldedClosedSessions',
  // Keyed by this PC's project ids and branches, like closed sessions.
  'ticketNotes',
  'tasks',
  'lastSeenVersion',
  'onboardingDismissed',
  // Experimental features are switched on per PC, on purpose.
  'experimental',
  // Never carried between PCs: a shared file must not be able to switch agents to skipping permission prompts.
  'fullAccess'
] as const satisfies readonly (keyof Settings)[]

export type IncludedKey = (typeof INCLUDED_KEYS)[number]

export type TransferData = Omit<Pick<Settings, IncludedKey>, 'theme'> & { theme: { id: string } }

export interface TransferEnvelope {
  app: typeof TRANSFER_APP
  kind: typeof TRANSFER_KIND
  version: typeof TRANSFER_VERSION
  exportedAt: string
  appVersion: string
  data: TransferData
}

export type TransferMode = 'merge' | 'replace'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

export function buildTransferData(settings: Settings): TransferData {
  const data: Raw = {}
  for (const key of INCLUDED_KEYS) data[key] = settings[key]
  data.theme = { id: settings.theme.id }
  return JSON.parse(JSON.stringify(data)) as TransferData
}

export function buildEnvelope(settings: Settings, appVersion: string, now: Date): TransferEnvelope {
  return {
    app: TRANSFER_APP,
    kind: TRANSFER_KIND,
    version: TRANSFER_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    data: buildTransferData(settings)
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const transferFileName = (now: Date): string =>
  `dawsha-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`

export interface ParsedTransfer {
  data: Partial<TransferData>
  appVersion: string
  exportedAt: string
  skipped: number
}

export type ParseResult = { ok: true; transfer: ParsedTransfer } | { ok: false; error: string }

const fail = (error: string): ParseResult => ({ ok: false, error })

const LIST_KEYS = ['projects', 'layouts'] as const
const OBJECT_KEYS = ['highlights', 'theme', 'recordings', 'dictation', 'sessionInfo'] as const
const BOOLEAN_KEYS = ['autoUpdateCheck', 'sidebarCollapsed', 'dimIdlePanes', 'showRecap', 'othersCollapsed'] as const

function checkShapes(data: Raw): string | null {
  for (const key of LIST_KEYS) {
    if (data[key] === undefined) continue
    if (!Array.isArray(data[key])) return `"${key}" must be a list.`
    if (!(data[key] as unknown[]).every(isRecord)) return `"${key}" contains an entry that is not an object.`
  }
  for (const key of OBJECT_KEYS) {
    if (data[key] !== undefined && !isRecord(data[key])) return `"${key}" must be an object.`
  }
  for (const key of BOOLEAN_KEYS) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') return `"${key}" must be true or false.`
  }
  if (data.paletteShortcut !== undefined && typeof data.paletteShortcut !== 'string') return '"paletteShortcut" must be text.'
  if (data.sessionsLayout !== undefined && data.sessionsLayout !== 'grid' && data.sessionsLayout !== 'board') {
    return '"sessionsLayout" must be grid or board.'
  }
  if (data.sidebarWidth !== undefined && (typeof data.sidebarWidth !== 'number' || !Number.isFinite(data.sidebarWidth))) {
    return '"sidebarWidth" must be a number.'
  }
  if (isRecord(data.theme) && typeof data.theme.id !== 'string') return '"theme.id" must be text.'
  return null
}

function countEntries(data: Raw): number {
  return LIST_KEYS.reduce((sum, key) => sum + (Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0), 0)
}

function sanitize(data: Raw): { data: Partial<TransferData>; skipped: number } {
  const present = INCLUDED_KEYS.filter((key) => data[key] !== undefined)
  const clean = migrateSettings(Object.fromEntries(present.map((key) => [key, data[key]])))
  const out: Raw = {}
  for (const key of present) out[key] = key === 'theme' ? { id: clean.theme.id } : clean[key]
  return { data: out as Partial<TransferData>, skipped: countEntries(data) - countEntries(out) }
}

export function parseTransfer(text: string, size: number = text.length): ParseResult {
  if (size > TRANSFER_MAX_BYTES) return fail('This file is too large to be a Dawsha settings export (over 2 MB).')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('This file is not valid JSON.')
  }
  if (!isRecord(raw) || raw.app !== TRANSFER_APP) return fail('This file was not exported by Dawsha.')
  if (raw.kind !== TRANSFER_KIND) return fail('This is a Dawsha file, but not a settings export.')
  if (raw.version !== TRANSFER_VERSION) {
    return fail(`This settings export uses version ${String(raw.version)}, which this Dawsha cannot read. Update Dawsha and try again.`)
  }
  if (!isRecord(raw.data)) return fail('The settings export has no data section.')
  const problem = checkShapes(raw.data)
  if (problem) return fail(`The settings export is damaged: ${problem}`)
  const { data, skipped } = sanitize(raw.data)
  return {
    ok: true,
    transfer: {
      data,
      skipped,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion.slice(0, 40) : '',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : ''
    }
  }
}

export function folderKey(folder: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return /^[a-zA-Z]:/.test(trimmed) || folder.includes('\\') ? trimmed.toLowerCase() : trimmed
}

export interface ImportSummary {
  mode: TransferMode
  projectsTotal: number
  projectsNew: number
  projectsExisting: number
  projectsMissing: number
  layoutsTotal: number
  layoutsNew: number
  skippedLayouts: number
  preferences: string[]
  removedProjects: string[]
  replacedLayouts: number
}

export interface ImportPlan {
  patch: Partial<Settings>
  summary: ImportSummary
}

export interface PlanInput {
  current: Settings
  data: Partial<TransferData>
  mode: TransferMode
  missingFolders: ReadonlySet<string>
  newId: () => string
}

const PREFERENCE_LABELS: [keyof TransferData, string][] = [
  ['theme', 'Theme'],
  ['highlights', 'Highlight rules'],
  ['paletteShortcut', 'Palette shortcut'],
  ['sessionsLayout', 'Sessions view'],
  ['recordings', 'Recording settings'],
  ['dictation', 'Dictation settings'],
  ['sessionInfo', 'Notifications'],
  ['autoUpdateCheck', 'Update checks'],
  ['sidebarCollapsed', 'Sidebar'],
  ['dimIdlePanes', 'Session dimming'],
  ['showRecap', 'Session recap'],
  ['sidebarWidth', 'Sidebar'],
  ['othersCollapsed', 'Sidebar'],
  ['orchestrator', 'Orchestrator settings']
]

export function preferenceLabels(data: Partial<TransferData>): string[] {
  const labels = PREFERENCE_LABELS.filter(([key]) => data[key] !== undefined).map(([, label]) => label)
  return [...new Set(labels)]
}

function preferencePatch(current: Settings, data: Partial<TransferData>): Partial<Settings> {
  const patch: Partial<Settings> = {}
  for (const key of INCLUDED_KEYS) {
    if (key === 'projects' || key === 'layouts' || data[key] === undefined) continue
    if (key === 'theme') patch.theme = { ...current.theme, id: data.theme!.id }
    else Object.assign(patch, { [key]: data[key] })
  }
  return patch
}

function uniqueId(wanted: string, taken: Set<string>, newId: () => string): string {
  let id = wanted
  while (taken.has(id)) id = newId()
  taken.add(id)
  return id
}

interface ProjectOutcome {
  projects: Project[]
  idMap: Map<string, string>
  added: number
  existing: number
  missing: number
}

function planProjects(input: PlanInput): ProjectOutcome {
  const { current, data, mode, missingFolders, newId } = input
  const incoming = data.projects ?? []
  const byFolder = new Map(current.projects.map((project) => [folderKey(project.folder), project]))
  const matchedIds = incoming.flatMap((project) => byFolder.get(folderKey(project.folder))?.id ?? [])
  const taken = new Set<string>(mode === 'merge' ? current.projects.map((p) => p.id) : matchedIds)
  const idMap = new Map<string, string>()
  const kept: Project[] = []
  let added = 0
  let existing = 0
  let missing = 0
  for (const project of incoming) {
    const match = byFolder.get(folderKey(project.folder))
    if (match) {
      idMap.set(project.id, match.id)
      existing += 1
      if (mode === 'replace') kept.push({ ...project, id: match.id })
      continue
    }
    const id = uniqueId(project.id, taken, newId)
    idMap.set(project.id, id)
    kept.push({ ...project, id })
    added += 1
    if (missingFolders.has(project.folder)) missing += 1
  }
  const projects = mode === 'merge' ? [...current.projects, ...kept] : kept
  return { projects, idMap, added, existing, missing }
}

const nameKey = (name: string): string => name.trim().toLowerCase()

function mapLayout(layout: SavedLayout, idMap: Map<string, string>, id: string): SavedLayout | null {
  const panes = layout.panes.flatMap((pane) => {
    const projectId = idMap.get(pane.projectId)
    return projectId ? [{ ...pane, projectId }] : []
  })
  if (panes.length === 0) return null
  return { ...layout, id, panes, focusedIndex: Math.min(layout.focusedIndex, panes.length - 1) }
}

function planLayouts(input: PlanInput, idMap: Map<string, string>): { layouts: SavedLayout[]; added: number; skipped: number } {
  const incoming = input.data.layouts ?? []
  const base = input.mode === 'merge' ? input.current.layouts : []
  const taken = new Set(base.map((l) => l.id))
  const seen = new Set(base.map((l) => nameKey(l.name)))
  const added: SavedLayout[] = []
  let skipped = 0
  for (const layout of incoming) {
    if (seen.has(nameKey(layout.name))) continue
    const mapped = mapLayout(layout, idMap, layout.id)
    if (!mapped) {
      skipped += 1
      continue
    }
    seen.add(nameKey(layout.name))
    added.push({ ...mapped, id: uniqueId(mapped.id, taken, input.newId) })
  }
  return { layouts: [...base, ...added].slice(0, MAX_LAYOUTS), added: added.length, skipped }
}

export function planImport(input: PlanInput): ImportPlan {
  const { current, data, mode } = input
  const patch = preferencePatch(current, data)
  const outcome = planProjects(input)
  const layouts = planLayouts(input, outcome.idMap)
  const touchesProjects = data.projects !== undefined
  if (touchesProjects) patch.projects = outcome.projects
  if (data.layouts !== undefined || (mode === 'replace' && touchesProjects)) patch.layouts = layouts.layouts
  const keptIds = new Set(outcome.projects.map((p) => p.id))
  const removedProjects = mode === 'replace' ? current.projects.filter((p) => !keptIds.has(p.id)).map((p) => p.name) : []
  return {
    patch,
    summary: {
      mode,
      projectsTotal: data.projects?.length ?? 0,
      projectsNew: outcome.added,
      projectsExisting: outcome.existing,
      projectsMissing: outcome.missing,
      layoutsTotal: data.layouts?.length ?? 0,
      layoutsNew: layouts.added,
      skippedLayouts: layouts.skipped,
      preferences: preferenceLabels(data),
      removedProjects,
      replacedLayouts: mode === 'replace' ? current.layouts.length : 0
    }
  }
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export function previewLines(summary: ImportSummary): string[] {
  const lines: string[] = []
  if (summary.projectsTotal > 0) {
    const detail = ` (${summary.projectsNew} new, ${summary.projectsExisting} already here)`
    lines.push(`${plural(summary.projectsTotal, 'project')}${detail}`)
    if (summary.projectsMissing > 0) {
      lines.push(`${plural(summary.projectsMissing, 'folder')} not found on this PC, shown as Missing until you point them at a new folder`)
    }
  }
  if (summary.layoutsTotal > 0) lines.push(`${plural(summary.layoutsTotal, 'layout')} (${summary.layoutsNew} new)`)
  if (summary.preferences.length > 0) lines.push(`Preferences: ${summary.preferences.join(', ')}`)
  return lines
}

export function replaceWarning(summary: ImportSummary, openSessions: number): string {
  const parts = [
    plural(summary.removedProjects.length, 'project') + (summary.removedProjects.length > 0 ? ` (${summary.removedProjects.slice(0, 5).join(', ')}${summary.removedProjects.length > 5 ? ', …' : ''})` : ''),
    plural(summary.replacedLayouts, 'layout')
  ]
  const closing = openSessions > 0 ? ` ${plural(openSessions, 'open session')} in removed projects will be closed.` : ''
  return `This replaces your current projects and layouts with the ones in the file. Not in the file and removed: ${parts.join(', ')}.${closing} Folders on disk are not touched. This cannot be undone.`
}

/** The Replace button names what it removes, as the warning above it does. */
export function replaceConfirmLabel(summary: ImportSummary): string {
  return `Replace and remove ${plural(summary.removedProjects.length, 'project')}, ${plural(summary.replacedLayouts, 'layout')}`
}

export function importToastText(summary: ImportSummary): string {
  const parts: string[] = []
  if (summary.projectsTotal > 0) parts.push(plural(summary.projectsNew + (summary.mode === 'replace' ? summary.projectsExisting : 0), 'project'))
  if (summary.layoutsNew > 0) parts.push(plural(summary.layoutsNew, 'layout'))
  const preferences = summary.preferences.length > 0
  const base = parts.length > 0 ? `Imported ${parts.join(', ')}${preferences ? ' and preferences' : ''}.` : preferences ? 'Imported preferences.' : 'Nothing new to import.'
  return summary.projectsMissing > 0 ? `${base} ${plural(summary.projectsMissing, 'project folder')} not found on this PC.` : base
}

export type SettingsExportResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type SettingsImportRead =
  | { status: 'ok'; transfer: ParsedTransfer }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
