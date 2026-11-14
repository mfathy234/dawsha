import type { AgentKind } from './types'

export interface CheckoutFile {
  path: string
  letter: string
  added: number | null
  removed: number | null
}

export interface CheckoutSession {
  paneId: string
  title: string
  agent: AgentKind | 'shell'
}

export interface CheckoutInput {
  folder: string
  /** The project's main checkout, not a worktree. */
  main: boolean
  branch: string | null
  files: readonly CheckoutFile[]
  sessions: readonly CheckoutSession[]
}

export interface CheckoutGroup extends CheckoutInput {
  added: number
  removed: number
  /** The group's heading: the session's title, or the main checkout. */
  heading: string
}

const sum = (files: readonly CheckoutFile[], key: 'added' | 'removed'): number => files.reduce((total, file) => total + (file[key] ?? 0), 0)

/** One group per checkout that has changes: the main checkout first, then worktrees by their session's title. Checkouts with nothing changed are left out. */
export function groupCheckouts(inputs: readonly CheckoutInput[]): CheckoutGroup[] {
  const byFolder = new Map<string, CheckoutInput>()
  for (const input of inputs) {
    const known = byFolder.get(input.folder)
    if (!known) {
      byFolder.set(input.folder, { ...input, sessions: dedupe(input.sessions) })
      continue
    }
    byFolder.set(input.folder, { ...known, main: known.main || input.main, sessions: dedupe([...known.sessions, ...input.sessions]) })
  }
  const groups = [...byFolder.values()]
    .filter((input) => input.files.length > 0)
    .map((input) => ({
      ...input,
      files: input.files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      added: sum(input.files, 'added'),
      removed: sum(input.files, 'removed'),
      heading: input.main ? 'Main checkout' : (input.sessions[0]?.title ?? input.branch ?? input.folder)
    }))
  return groups.sort((a, b) => (a.main === b.main ? a.heading.localeCompare(b.heading) : a.main ? -1 : 1))
}

function dedupe(sessions: readonly CheckoutSession[]): CheckoutSession[] {
  const seen = new Set<string>()
  return sessions.filter((session) => (seen.has(session.paneId) ? false : (seen.add(session.paneId), true)))
}

export const totalFiles = (groups: readonly CheckoutGroup[]): number => groups.reduce((total, group) => total + group.files.length, 0)
