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
