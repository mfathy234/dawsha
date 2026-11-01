export interface BranchEntry {
  name: string
  current: boolean
  date: number
  remote?: string
}

export interface BranchList {
  current: string | null
  local: BranchEntry[]
  remote: BranchEntry[]
}

export interface SyncCounts {
  ahead: number
  behind: number
}

export interface StashEntry {
  ref: string
  subject: string
}

export type SwitchMode = 'local' | 'remote' | 'create'

export type GitQuickRequest =
  | { folder: string; op: 'pull' | 'fetch' | 'stash' | 'stashPop' }
  | { folder: string; op: 'switch'; branch: string; mode: SwitchMode; stash?: boolean; stashUntracked?: boolean }

export type GitQuickResult = { ok: true; message: string } | { ok: false; error: string; canStash?: boolean }

export type BranchListResult = { ok: true; branches: BranchList } | { ok: false; error: string }

export type PickerRow =
  | { kind: 'local'; name: string; current: boolean }
  | { kind: 'remote'; name: string; remote: string }
  | { kind: 'create'; name: string; from: string }
  | { kind: 'invalid'; name: string; problem: string }

export const BRANCH_REF_FORMAT = '%(refname)%09%(HEAD)%09%(committerdate:unix)'
export const STASH_LIST_FORMAT = '%gd%x09%gs'
export const MAX_MESSAGE_CHARS = 600

export function parseBranchRefs(output: string): BranchList {
  const local: BranchEntry[] = []
  const remote: BranchEntry[] = []
  let current: string | null = null
  for (const line of output.split('\n')) {
    const [ref, head, stamp] = line.split('\t')
    if (!ref) continue
    const date = Number(stamp) || 0
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length)
      const isCurrent = head === '*'
      if (isCurrent) current = name
      local.push({ name, current: isCurrent, date })
    } else if (ref.startsWith('refs/remotes/')) {
      const full = ref.slice('refs/remotes/'.length)
      const slash = full.indexOf('/')
      if (slash <= 0 || full.endsWith('/HEAD')) continue
      remote.push({ name: full.slice(slash + 1), remote: full, current: false, date })
    }
  }
  const taken = new Set(local.map((entry) => entry.name))
  const byDate = (a: BranchEntry, b: BranchEntry): number => b.date - a.date || a.name.localeCompare(b.name)
  return {
    current,
    local: local.sort(byDate),
    remote: remote.filter((entry) => !taken.has(entry.name)).sort(byDate)
  }
}

export function parseAheadBehind(output: string): SyncCounts | null {
  const match = /^(\d+)\s+(\d+)$/.exec(output.trim())
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : null
}

export function formatSync(sync: SyncCounts | null | undefined): string {
  if (!sync) return ''
  const parts: string[] = []
  if (sync.ahead > 0) parts.push(`↑${sync.ahead}`)
  if (sync.behind > 0) parts.push(`↓${sync.behind}`)
  return parts.join(' ')
}

export function describeSync(sync: SyncCounts): string {
  return `${sync.ahead} ahead, ${sync.behind} behind`
}

export function parseStashList(output: string): StashEntry[] {
  const entries: StashEntry[] = []
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    entries.push({ ref: line.slice(0, tab), subject: line.slice(tab + 1).trim() })
  }
  return entries
}

export function branchNameProblem(name: string): string | null {
  if (name.trim() === '') return 'Enter a branch name.'
  if (name.startsWith('-')) return 'A branch name cannot start with a dash.'
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(name)) return 'A branch name cannot contain spaces or ~ ^ : ? * [ \\.'
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return 'A branch name cannot contain .. @{ or //.'
  if (name === '@' || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    return 'That is not a valid branch name.'
  }
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) return 'That is not a valid branch name.'
  return null
}

export function pickerRows(list: BranchList, query: string): PickerRow[] {
  const needle = query.trim().toLowerCase()
  const matches = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle)
  const rows: PickerRow[] = []
  for (const entry of list.local) {
    if (matches(entry.name)) rows.push({ kind: 'local', name: entry.name, current: entry.current })
  }
  for (const entry of list.remote) {
    if (matches(entry.name) && entry.remote) rows.push({ kind: 'remote', name: entry.name, remote: entry.remote })
  }
  const typed = query.trim()
  const exists = list.local.some((entry) => entry.name === typed) || list.remote.some((entry) => entry.name === typed)
  if (typed !== '' && !exists) {
    const problem = branchNameProblem(typed)
    rows.push(
      problem
        ? { kind: 'invalid', name: typed, problem }
        : { kind: 'create', name: typed, from: list.current ?? 'HEAD' }
    )
  }
  return rows
}

export function isDirtyRefusal(message: string): boolean {
  return /would be overwritten|commit your changes or stash|local changes/i.test(message)
}

export function trimGitMessage(text: string, max = MAX_MESSAGE_CHARS): string {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
  const joined = lines.join('\n').trim()
  return joined.length > max ? `${joined.slice(0, max)}…` : joined
}

export function stashMessage(date: Date, branch?: string): string {
  const stamp = date.toISOString().slice(0, 16).replace('T', ' ')
  return branch ? `Dawsha: ${branch} ${stamp}` : `Dawsha: ${stamp}`
}

export function isDivergedPull(message: string): boolean {
  return /not possible to fast-forward|diverg|fast-forward/i.test(message)
}

export function pullSummary(output: string): string {
  const text = output.trim()
  if (/already up.to.date/i.test(text)) return 'Already up to date.'
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const summary = lines.reverse().find((line) => /changed|insertion|deletion|create mode|delete mode/.test(line))
  return summary ? `Pulled. ${summary.trim()}` : 'Pulled.'
}

export const BRANCH_FILTER_MIN = 8

export function branchAgo(stampSeconds: number, nowMs: number): string {
  if (!stampSeconds) return ''
  const minutes = Math.floor((nowMs - stampSeconds * 1000) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} d ago`
  if (days < 60) return `${Math.floor(days / 7)} w ago`
  if (days < 730) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} y ago`
}

export function filterBranches(list: BranchList, query: string): { local: BranchEntry[]; remote: BranchEntry[] } {
  const needle = query.trim().toLowerCase()
  const keep = (entry: BranchEntry): boolean => needle === '' || entry.name.toLowerCase().includes(needle)
  return { local: list.local.filter(keep), remote: list.remote.filter(keep) }
}

export function needsBranchFilter(list: BranchList): boolean {
  return list.local.length + list.remote.length > BRANCH_FILTER_MIN
}

/** What a folder holds that a branch switch could trip over: tracked changes, and new (untracked) files with their size. */
export interface DirtyReport {
  modified: number
  untracked: number
  untrackedBytes: number
  /** The count or the size stopped at a limit, so they are lower bounds. */
  capped: boolean
}

export type DirtyReportResult = { ok: true; report: DirtyReport } | { ok: false; error: string }

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${BYTE_UNITS[unit]}`
}

export function formatSize(bytes: number, capped: boolean): string {
  return capped ? `over ${formatBytes(bytes)}` : formatBytes(bytes)
}

const filesWord = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`

export interface StashDialogText {
  title: string
  body: string
  rows: Array<{ label: string; value: string }>
  /** Only when there are new files. */
  checkbox: { label: string; hint: string } | null
  confirmLabel: string
  /** Shown when new files stay behind. */
  leftBehind: string | null
  /** Tracked files stashed (plus new ones when ticked); 0 means nothing is stashed. */
  stashCount: number
}

export function stashDialogText(branch: string, report: DirtyReport, includeNew: boolean): StashDialogText {
  const newFiles = report.untracked
  const withNew = includeNew && newFiles > 0
  const stashCount = report.modified + (withNew ? newFiles : 0)
  const size = formatSize(report.untrackedBytes, report.capped)
  const more = report.capped ? '+' : ''
  const rows = [{ label: 'Modified files', value: String(report.modified) }]
  if (newFiles > 0) rows.push({ label: `New files (${size})`, value: `${newFiles}${more}` })
  return {
    title: `Stash your changes to switch to ${branch}?`,
    body: "You can't switch branches with uncommitted changes. Stash them first, and bring them back later with Apply last stash.",
    rows,
    checkbox: newFiles > 0
      ? { label: `Also stash the ${newFiles}${more} new ${newFiles === 1 && !more ? 'file' : 'files'}`, hint: 'Off by default because large new files are slow to stash. Left out, they stay in your folder.' }
      : null,
    confirmLabel: stashCount > 0 ? `Stash ${filesWord(stashCount)} and switch to ${branch}` : `Switch to ${branch}`,
    leftBehind: newFiles > 0 && !withNew ? `${newFiles === 1 ? 'The new file stays' : `The ${newFiles}${more} new files stay`} in your folder.` : null,
    stashCount
  }
}

/** The row to offer for a typed name that matches no branch: create it, or say why it cannot be a branch. */
export function typedBranchRow(list: BranchList, query: string): Extract<PickerRow, { kind: 'create' | 'invalid' }> | null {
  const row = pickerRows(list, query).find((item) => item.kind === 'create' || item.kind === 'invalid')
  return row && (row.kind === 'create' || row.kind === 'invalid') ? row : null
}

/** What a switch to this target needs from the stash guard. */
export function switchPlan(report: DirtyReport, includeNew: boolean): { stash: boolean; stashUntracked: boolean } {
  const withNew = includeNew && report.untracked > 0
  return { stash: report.modified > 0 || withNew, stashUntracked: withNew }
}
