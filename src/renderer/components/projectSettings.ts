import { PROJECT_COLORS, colorOfProject } from '../../shared/projectColor'
import { iconSource, iconSourceLine } from '../../shared/projectIconSource'
import type { Project } from '../../shared/types'
import { changeProjectIcon, setProjectColor, useDetectedIcon, useInitials } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import { store } from '../state'
import { nextDialogId, present } from './dialogs'
import { projectAvatar } from './projectAvatar'
import './projectSettings.css'

const currentProject = (projectId: string): Project | undefined => store.state.settings.projects.find((entry) => entry.id === projectId)

function iconRow(project: Project, detected: string | null, again: () => void): HTMLElement {
  const source = iconSource(project, detected)
  const button = (label: string, run: () => void | Promise<void>, ghost = false): HTMLElement =>
    h('button', { class: `btn small${ghost ? ' ghost' : ''}`, type: 'button', onClick: () => void Promise.resolve(run()).then(again) }, label)
  return h('div', { class: 'ps-row ps-icon-row' },
    h('div', { class: 'ps-label' }, h('div', { class: 'ps-name' }, 'Icon'), h('div', { class: 'ps-sub', id: 'ps-icon-source' }, iconSourceLine(source, detected))),
    projectAvatar(project, 'large'),
    button('Choose image…', () => changeProjectIcon(project.id)),
    detected !== null && source !== 'detected' ? button('Use detected', () => useDetectedIcon(project.id), true) : null,
    source !== 'initials' ? button('Use initials', () => useInitials(project.id), true) : null
  )
}

function colourRow(project: Project, again: () => void): HTMLElement {
  const current = colorOfProject(project).color
  const swatches = PROJECT_COLORS.map((entry) => h('button', {
    class: `ps-swatch${entry.color === current ? ' current' : ''}`,
    type: 'button',
    role: 'radio',
    'aria-checked': String(entry.color === current),
    'aria-label': entry.name,
    title: entry.name,
    style: `--swatch: ${entry.color}`,
    onClick: () => { setProjectColor(project.id, entry.color); again() }
  }))
  return h('div', { class: 'ps-row' }, h('div', { class: 'ps-label' }, h('div', { class: 'ps-name' }, 'Colour')), h('div', { class: 'ps-swatches', role: 'radiogroup', 'aria-label': 'Colour' }, ...swatches))
}

/** The project's own settings: its name, the icon it shows and the colour of its ring and initials. */
export async function editProjectSettings(projectId: string): Promise<void> {
  const first = currentProject(projectId)
  if (!first) return
  const id = nextDialogId()
  const body = h('div', { class: 'ps-body' })
  const close = h('button', { class: 'btn primary', type: 'button' }, 'Done')
  const dialog = h('div', { class: 'dialog project-settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `ps-title-${id}` },
    h('h2', { id: `ps-title-${id}`, dir: 'auto' }, 'Project settings'),
    body,
    h('div', { class: 'dialog-actions' }, close))
  let detected: string | null = null
  const render = (): void => {
    const project = currentProject(projectId)
    if (!project) return
    body.replaceChildren(
      h('div', { class: 'ps-row' }, h('span', { class: 'ps-name' }, 'Name'), h('span', { class: 'ps-value', dir: 'auto' }, project.name)),
      iconRow(project, detected, render),
      colourRow(project, render)
    )
  }
  render()
  const shown = present(dialog, undefined, close)
  close.addEventListener('click', () => shown.finish(undefined))
  void api.detectedProjectIcon(first.folder).then((found) => {
    detected = found
    if (dialog.isConnected) render()
  }).catch(() => undefined)
  await shown.result
}
