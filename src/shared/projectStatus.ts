import type { SessionState } from './sessionState'

export interface ProjectStatus {
  needs: number
  working: number
  /** Sessions still running, whatever they are doing. */
  open: number
  /** Sessions that finished and have not been looked at yet. */
  unread: number
}

/** What the collapsed sidebar shows for a project: sessions that need you win over ones that are only working. */
export function projectStatus(states: readonly SessionState[], unread = 0): ProjectStatus {
  return {
    needs: states.filter((state) => state === 'needs').length,
    working: states.filter((state) => state === 'working').length,
    open: states.filter((state) => state !== 'exited').length,
    unread
  }
}

export function projectStatusText(status: Pick<ProjectStatus, 'needs' | 'working'>): string {
  if (status.needs > 0) return `${status.needs} ${status.needs === 1 ? 'needs' : 'need'} you`
  return status.working > 0 ? 'working' : ''
}

export function projectStatusLabel(name: string, status: Pick<ProjectStatus, 'needs' | 'working'>): string {
  const text = projectStatusText(status)
  return text ? `${name} · ${text}` : name
}

export interface ProjectRowState {
  text: string
  tone: 'needs' | 'working' | 'count'
}

/** What a project's row in the expanded sidebar says: how many need you, that some are working, or how many sessions are open. Nothing when none are. */
export function projectRowState(states: readonly SessionState[]): ProjectRowState | null {
  const status = projectStatus(states)
  if (status.needs > 0) return { text: projectStatusText(status), tone: 'needs' }
  if (status.working > 0) return { text: 'working', tone: 'working' }
  return status.open > 0 ? { text: String(status.open), tone: 'count' } : null
}
