import type { TabAgent } from './types'

export interface PauseCandidate {
  tabId: string
  projectId: string | null | undefined
  agent: TabAgent
  status: string
}

export interface PauseConfirm {
  title: string
  body: string
  confirmLabel: string
}

/** Agent sessions that are working right now. Shells and idle agents are left alone. */
export function pauseTargets(views: readonly PauseCandidate[], projectId?: string): string[] {
  return views
    .filter((view) => view.agent !== 'shell' && view.status === 'busy' && (projectId === undefined || view.projectId === projectId))
    .map((view) => view.tabId)
}

const plural = (count: number): string => (count === 1 ? 'session' : 'sessions')

export function pauseConfirm(count: number, projectName?: string): PauseConfirm {
  const where = projectName ? ` in ${projectName}` : ''
  return {
    title: `Interrupt ${count} working ${plural(count)}?`,
    body: `Each working agent${where} gets Esc and stops its current turn. The sessions stay open, so you can send a new message to carry on.`,
    confirmLabel: `Interrupt ${count} ${plural(count)}`
  }
}
