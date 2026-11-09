import { agentLabel } from '../../shared/agents'
import { COMPARE_PROMPT_MAX, compareTitle } from '../../shared/compare'
import type { Project, QueuedPrompt } from '../../shared/types'
import { updateQueue } from '../automation/settings'
import { h } from '../dom'
import { newId, store } from '../state'
import { nextDialogId, present } from './dialogs'
import { selectMenu } from './selectMenu'

const QUEUE_AGENTS = ['claude', 'codex'] as const

/** Adds a prompt to the end of a project's queue. Resolves true once added. */
export function queueTaskDialog(project: Project): Promise<boolean> {
  const id = nextDialogId()
  const prompt = h('textarea', { class: 'text-input dialog-text', id: `queue-prompt-${id}`, rows: '5', maxlength: String(COMPARE_PROMPT_MAX), spellcheck: 'false', placeholder: 'Add tests for the date helpers' })
  const agent = h('select', { class: 'rp-project field-select', id: `queue-agent-${id}` })
  for (const kind of QUEUE_AGENTS) agent.append(h('option', { value: kind }, agentLabel(kind)))
  agent.value = store.state.settings.queueAgent
  const error = h('pre', { class: 'compare-error', role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const add = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, 'Add to queue')
  const dialog = h('div', { class: 'dialog compare-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add task to queue' },
    h('h2', {}, `Add a task to ${project.name}`),
    h('p', { class: 'dialog-hint' }, 'It runs in its own git worktree when the queue reaches it.'),
    h('div', { class: 'field' }, h('label', { for: prompt.id, class: 'dialog-label' }, 'Prompt'), prompt),
    h('div', { class: 'field' }, h('label', { for: agent.id, class: 'dialog-label' }, 'Agent'), selectMenu(agent)),
    error,
    h('div', { class: 'dialog-actions' }, cancel, add))
  const shown = present<boolean>(dialog, false, prompt)
  cancel.addEventListener('click', () => shown.finish(false))
  add.addEventListener('click', () => {
    const text = prompt.value.trim()
    if (text === '') { error.textContent = 'Enter the prompt for this task.'; error.hidden = false; return }
    const task: QueuedPrompt = {
      id: newId(), projectId: project.id, name: compareTitle(text, 60), prompt: text,
      agent: agent.value as QueuedPrompt['agent'], state: 'queued', createdAt: Date.now()
    }
    updateQueue((all) => [...all, task])
    shown.finish(true)
  })
  return shown.result
}
