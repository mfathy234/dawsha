import type { AgentKind, CompareLink, CompareNames, CompareSide } from './types'

export const COMPARE_PROMPT_MAX = 8000

const SHORT_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const SHORT_LENGTH = 6

export function shortId(random: () => number = Math.random): string {
  let id = ''
  for (let index = 0; index < SHORT_LENGTH; index += 1) {
    id += SHORT_ALPHABET[Math.floor(random() * SHORT_ALPHABET.length) % SHORT_ALPHABET.length]
  }
  return id
}

function splitFolder(folder: string): { parent: string; name: string; separator: string } {
  const trimmed = folder.replace(/[\\/]+$/, '')
  const separator = trimmed.includes('\\') || !trimmed.includes('/') ? '\\' : '/'
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (cut < 0) return { parent: '..', name: trimmed, separator }
  const parent = trimmed.slice(0, cut) || separator
  return { parent, name: trimmed.slice(cut + 1), separator }
}

export function compareNames(folder: string, short: string): CompareNames {
  const { parent, name, separator } = splitFolder(folder)
  const base = parent.endsWith(separator) ? parent : `${parent}${separator}`
  const side = (slot: 'a' | 'b'): CompareSide => ({
    path: `${base}${name}-compare-${short}-${slot}`,
    branch: `compare/${short}-${slot}`
  })
  return { a: side('a'), b: side('b') }
}

export function promptArgs(agent: AgentKind, prompt: string): string[] {
  if (prompt === '') return []
  if (agent === 'gemini') return [`--prompt-interactive=${prompt}`]
  return prompt.startsWith('-') ? ['--', prompt] : [prompt]
}

export const isShortId = (value: string): boolean => /^[a-z0-9]{4,12}$/.test(value)

export const isCompareBranch = (value: string): boolean => /^compare\/[a-z0-9]{4,12}-[ab]$/.test(value)

export const isCompareWorktree = (value: string): boolean => /-compare-[a-z0-9]{4,12}-[ab]$/.test(value)

export const slotLabel = (slot: 'a' | 'b'): string => slot.toUpperCase()

export function compareTitle(prompt: string, limit = 60): string {
  const line = prompt.replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit - 3)}...` : line
}

export interface Pair<T> {
  link: CompareLink
  a: T
  b: T
}

export function pairOf<T extends { compare?: CompareLink }>(items: T[], index: number): Pair<T> | null {
  const first = items[index]
  const second = items[index + 1]
  if (!first?.compare || !second?.compare) return null
  if (first.compare.id !== second.compare.id) return null
  if (first.compare.slot !== 'a' || second.compare.slot !== 'b') return null
  return { link: first.compare, a: first, b: second }
}

export interface WorktreeStatus {
  exists: boolean
  dirtyFiles: number
  commits: number
}

export const worktreeHasWork = (status: WorktreeStatus): boolean => status.dirtyFiles > 0 || status.commits > 0

export function diffCommand(
  link: CompareLink,
  statusA: WorktreeStatus,
  statusB: WorktreeStatus,
  quote: (path: string) => string
): string | null {
  if (!link.sides) return null
  const { a, b } = link.sides
  if (statusA.dirtyFiles > 0 || statusB.dirtyFiles > 0) {
    return `git diff --no-index -- ${quote(a.path)} ${quote(b.path)}`
  }
  return `git diff ${a.branch} ${b.branch}`
}

export function quoteForShell(path: string, shellCommand: string): string {
  const name = (shellCommand.split(/[\\/]/).pop() ?? shellCommand).toLowerCase()
  if (name === 'cmd.exe' || name === 'cmd') return `"${path}"`
  if (!name.endsWith('.exe') && name !== 'powershell' && name !== 'pwsh') return `'${path.replace(/'/g, "'\\''")}'`
  return `'${path.replace(/'/g, "''")}'`
}

export function emptyStatus(): WorktreeStatus {
  return { exists: false, dirtyFiles: 0, commits: 0 }
}
