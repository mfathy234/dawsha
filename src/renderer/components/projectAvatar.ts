import { colorOfProject } from '../../shared/projectColor'
import { monogram } from '../../shared/sidebarModel'
import type { Project } from '../../shared/types'
import { h } from '../dom'
import { projectIconUrl } from './railTiles'
import './projectAvatar.css'

/** A project's small mark: its icon on a neutral rounded square, or its initials on a tint of its colour. The icon loads on its own and replaces the initials once it is there. */
export function projectAvatar(project: Project, size: 'small' | 'large' = 'small'): HTMLElement {
  const letters = h('span', { class: 'proj-avatar-letters', 'aria-hidden': 'true' }, monogram(project.name))
  const avatar = h('span', { class: `proj-avatar ${size}`, 'aria-hidden': 'true' }, letters)
  avatar.style.setProperty('--tile-color', colorOfProject(project).color)
  if (project.noIcon === true) return avatar
  const image = h('img', { class: 'proj-avatar-icon', alt: '', draggable: 'false', hidden: true }) as HTMLImageElement
  image.addEventListener('load', () => {
    image.hidden = false
    letters.hidden = true
    avatar.classList.add('has-image')
  })
  image.addEventListener('error', () => image.remove())
  image.src = projectIconUrl(project)
  avatar.append(image)
  return avatar
}
