import type { Project } from './types'

export type IconSource = 'initials' | 'own' | 'detected'

/** Where the icon in use comes from: the owner's own image, a file the folder ships, or the initials. */
export function iconSource(project: Pick<Project, 'iconPath' | 'noIcon'>, detected: string | null): IconSource {
  if (project.noIcon === true) return 'initials'
  if (project.iconPath) return 'own'
  return detected ? 'detected' : 'initials'
}

export function iconSourceLine(source: IconSource, detected: string | null): string {
  if (source === 'own') return 'Your image'
  return source === 'detected' && detected ? `Found in ${detected}` : 'Initials'
}
