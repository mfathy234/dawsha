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
