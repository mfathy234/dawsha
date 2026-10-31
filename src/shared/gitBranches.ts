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
  | { folder: string; op: 'switch'; branch: string; mode: SwitchMode; stash?: boolean }

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

export function switchConfirmText(branch: string, changed: number): { title: string; body: string; confirmLabel: string } {
  const files = `${changed} changed ${changed === 1 ? 'file' : 'files'}`
  return {
    title: `Switch to ${branch}?`,
    body: `You have ${files}; git will carry them over or refuse if they conflict.`,
    confirmLabel: `Switch to ${branch}`
  }
}
