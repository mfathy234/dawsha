import type { Project } from '../../shared/types'
import type { WorktreeSetupInspectResult } from '../../shared/worktreeSetup'
import { saveSettings } from '../actions'
import { api } from '../api'
import { clear, h } from '../dom'
import { store } from '../state'
import { nextDialogId, present } from './dialogs'
import { toast } from './toast'
import './worktreeSetup.css'

async function saveChoice(projectId: string, change: Partial<NonNullable<Project['worktreeSetup']>>): Promise<void> {
  const projects = store.state.settings.projects.map((project) => project.id === projectId
    ? { ...project, worktreeSetup: { command: '', prompted: false, ...project.worktreeSetup, ...change } }
    : project)
  store.set((state) => ({ ...state, settings: { ...state.settings, projects } }))
  await saveSettings({ projects })
}

/** The project menu and New session share this editor. Commands are saved only by an explicit owner action. */
export async function editWorktreeSetup(projectId: string): Promise<void> {
  const project = store.state.settings.projects.find((entry) => entry.id === projectId)
  if (!project) return
  let found: WorktreeSetupInspectResult
  try { found = await api.worktreeSetupInspect(project.folder) } catch {
    toast('Could not read worktree setup for this project.')
    return
  }
  if (!found.ok) return toast(found.error)
  const id = nextDialogId()
  const patterns = h('textarea', { id: `wt-patterns-${id}`, class: 'text-input wt-patterns', rows: '4', dir: 'auto', spellcheck: 'false' })
  patterns.value = found.exists ? found.patterns : found.suggestions.join('\n')
  const command = h('textarea', { id: `wt-command-${id}`, class: 'text-input wt-command', rows: '3', dir: 'auto', spellcheck: 'false', maxlength: '8000' })
  command.value = project.worktreeSetup?.command ?? ''
  const suggestions = h('div', { class: 'wt-commands', role: 'group', 'aria-label': 'Suggested setup commands' },
    ...found.commands.map((choice) => h('button', { class: 'btn ghost small', type: 'button', dir: 'auto', title: choice.label, onClick: () => {
      const existing = command.value.trim()
      command.value = existing ? `${existing}\n${choice.command}` : choice.command
      command.focus()
    } }, choice.command)))
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Save setup')
  const dialog = h('div', { class: 'dialog wt-setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `wt-title-${id}` },
    h('h2', { id: `wt-title-${id}`, dir: 'auto' }, `Worktree setup for ${project.name}`),
    h('p', {}, 'New worktrees get their own copies of your local files. Setup runs in the session terminal before the agent starts.'),
    h('label', { for: patterns.id, class: 'dialog-label' }, 'Local files to copy'), patterns,
    h('p', { class: 'dialog-hint' }, 'Saved in .worktreeinclude in the main checkout. Use .gitignore patterns, # comments and ! exclusions. Only ignored files inside the repository are copied, up to 50 MB.'),
    h('label', { for: command.id, class: 'dialog-label' }, 'Setup command'), command,
    found.commands.length > 0 ? suggestions : null,
    h('p', { class: 'dialog-hint' }, `Choose a suggestion or type your commands, one per line. ${navigator.platform.toLowerCase().includes('win') ? 'Commands run in Command Prompt. ' : ''}Clear this field to skip setup. This choice stays in Dawsha for this project.`),
    error, h('div', { class: 'dialog-actions' }, cancel, save))
  const shown = present(dialog, false, command)
  cancel.addEventListener('click', () => shown.finish(false))
  save.addEventListener('click', () => {
    save.disabled = true
    void (async () => {
      const result = await api.worktreeSetupSave(project.folder, patterns.value)
      if (!result.ok) throw new Error(result.error)
      await saveChoice(projectId, { command: command.value.trim(), prompted: true })
      shown.finish(true)
    })().catch((reason: unknown) => {
      error.textContent = reason instanceof Error ? reason.message : 'Could not save worktree setup.'
      error.hidden = false
      save.disabled = false
    })
  })
  await shown.result
}

/** A short, once-per-project suggestion. It never writes local configuration without a click. */
export class WorktreeSetupSuggestion {
  readonly el = h('section', { class: 'wt-suggestion', role: 'region', 'aria-label': 'Worktree setup suggestion', hidden: true })
  private projectId = ''
  private generation = 0

  show(project: Project | undefined): void {
    const key = project ? `${project.id}:${project.folder}:${project.worktreeSetup?.prompted === true}` : ''
    if (key === this.projectId) return
    this.projectId = key
    const generation = ++this.generation
    this.el.hidden = true
    clear(this.el)
    if (!project || project.worktreeSetup?.prompted) return
    void api.worktreeSetupInspect(project.folder).then((found) => {
      if (generation !== this.generation || !found.ok || found.exists || found.suggestions.length === 0) return
      const names = found.suggestions.slice(0, 3).join(', ')
      const detail = `${names}${found.suggestions.length > 3 ? ', …' : ''}`
      const save = h('button', { class: 'btn ghost small', type: 'button' }, 'Save as .worktreeinclude')
      const dismiss = h('button', { class: 'btn ghost small', type: 'button' }, 'Not now')
      const problem = h('span', { role: 'status', class: 'wt-problem' })
      const decide = async (copy: boolean): Promise<void> => {
        save.disabled = dismiss.disabled = true
        try {
          if (copy) {
            const result = await api.worktreeSetupSave(project.folder, `${found.suggestions.join('\n')}\n`)
            if (!result.ok) throw new Error(result.error)
          }
          await saveChoice(project.id, { prompted: true })
          this.el.hidden = true
        } catch (error) {
          problem.textContent = error instanceof Error ? error.message : 'Could not save this choice.'
          save.disabled = dismiss.disabled = false
        }
      }
      save.addEventListener('click', () => void decide(true))
      dismiss.addEventListener('click', () => void decide(false))
      this.el.append(h('div', { class: 'wt-suggestion-copy' }, h('strong', {}, `Copy ${found.suggestions.length} local file${found.suggestions.length === 1 ? '' : 's'} into new worktrees?`), h('span', { dir: 'auto', title: found.suggestions.join(', ') }, detail)), h('div', { class: 'wt-suggestion-actions' }, save, dismiss), problem)
      this.el.hidden = false
    }).catch(() => { /* The setup editor can report a read failure if the owner opens it. */ })
  }
}
