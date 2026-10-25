import type { SessionState } from './sessionState'

export interface ProjectStatus {
  needs: number
  working: number
}

/** What the collapsed sidebar shows for a project: sessions that need you win over ones that are only working. */
export function projectStatus(states: readonly SessionState[]): ProjectStatus {
  return {
    needs: states.filter((state) => state === 'needs').length,
    working: states.filter((state) => state === 'working').length
  }
}

export function projectStatusText(status: ProjectStatus): string {
  if (status.needs > 0) return `${status.needs} ${status.needs === 1 ? 'needs' : 'need'} you`
  return status.working > 0 ? 'working' : ''
}

export function projectStatusLabel(name: string, status: ProjectStatus): string {
  const text = projectStatusText(status)
  return text ? `${name}, ${text}` : name
}
