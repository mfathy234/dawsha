import type { Project } from './types'

export type MoveDirection = -1 | 1

const isPinned = (project: Project): boolean => project.pinned === true

/** Pinned projects first; each group keeps the order of the stored list. */
export function orderProjects(projects: readonly Project[]): Project[] {
  return [...projects.filter(isPinned), ...projects.filter((project) => !isPinned(project))]
}

// Index (in the stored list) of the nearest project of the same group in that direction, or -1.
function neighbourIndex(projects: readonly Project[], id: string, direction: MoveDirection): number {
  const index = projects.findIndex((project) => project.id === id)
  if (index < 0) return -1
  const pinned = isPinned(projects[index])
  for (let i = index + direction; i >= 0 && i < projects.length; i += direction) {
    if (isPinned(projects[i]) === pinned) return i
  }
  return -1
}

export const canMoveProject = (projects: readonly Project[], id: string, direction: MoveDirection): boolean =>
  neighbourIndex(projects, id, direction) >= 0

/** Swaps the project with its neighbour inside its pinned/unpinned group; the list comes back unchanged when it cannot move. */
export function moveProject(projects: readonly Project[], id: string, direction: MoveDirection): Project[] {
  const target = neighbourIndex(projects, id, direction)
  if (target < 0) return [...projects]
  const index = projects.findIndex((project) => project.id === id)
  return projects.map((project, i) => (i === index ? projects[target] : i === target ? projects[index] : project))
}

export function setProjectPinned(projects: readonly Project[], id: string, pinned: boolean): Project[] {
  return projects.map((project) => {
    if (project.id !== id) return project
    if (pinned) return { ...project, pinned: true }
    const { pinned: _pinned, ...rest } = project
    return rest
  })
}

/** Puts the project in the place of `targetId`, shifting the ones between; both must be in the same pinned/unpinned group, otherwise the list comes back unchanged. */
export function moveProjectTo(projects: readonly Project[], id: string, targetId: string): Project[] {
  const from = projects.findIndex((project) => project.id === id)
  const to = projects.findIndex((project) => project.id === targetId)
  if (from < 0 || to < 0 || from === to || isPinned(projects[from]) !== isPinned(projects[to])) return [...projects]
  const rest = projects.filter((project) => project.id !== id)
  return [...rest.slice(0, to), projects[from], ...rest.slice(to)]
}

export const canDropProject = (projects: readonly Project[], id: string, targetId: string): boolean => {
  const from = projects.find((project) => project.id === id)
  const target = projects.find((project) => project.id === targetId)
  return from !== undefined && target !== undefined && from !== target && isPinned(from) === isPinned(target)
}

/** The stored projects in the order the sidebar shows them (pinned first); any it does not show follow in stored order. */
export function seedOrder(projects: readonly Project[], displayedIds: readonly string[]): Project[] {
  const shown = displayedIds.map((id) => projects.find((project) => project.id === id)).filter((project): project is Project => project !== undefined)
  const shownIds = new Set(shown.map((project) => project.id))
  return orderProjects([...shown, ...projects.filter((project) => !shownIds.has(project.id))])
}

/** A drag in any sort mode: the manual order starts from what is displayed, then the project takes the target's place. */
export function reorderFromDisplay(projects: readonly Project[], displayedIds: readonly string[], id: string, targetId: string): Project[] {
  return moveProjectTo(seedOrder(projects, displayedIds), id, targetId)
}

/** An Alt+Arrow step in any sort mode, on top of the displayed order. */
export function moveFromDisplay(projects: readonly Project[], displayedIds: readonly string[], id: string, direction: MoveDirection): Project[] {
  return moveProject(seedOrder(projects, displayedIds), id, direction)
}
