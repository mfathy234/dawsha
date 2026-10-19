import { AGENT_NAMES } from '../../shared/agents'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { agentMark } from './agentMark'
import { nextDialogId, present } from './dialogs'

export interface HandoffDialogOptions {
  from: AgentKind
  to: AgentKind
  text: string
}

export function handoffDialog(options: HandoffDialogOptions): Promise<string | null> {
  const id = nextDialogId()
  const area = h('textarea', {
    class: 'text-input dialog-text handoff-text',
    id: `ho-text-${id}`,
    rows: '14',
    spellcheck: 'false',
    'aria-label': 'Handoff summary'
  })
  area.value = options.text
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const start = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, `Start ${AGENT_NAMES[options.to]} with this`)
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true })
  const dialog = h(
    'div',
    { class: 'dialog handoff-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Continue in ${AGENT_NAMES[options.to]}` },
    h('div', { class: 'handoff-head' }, h('h2', {}, `Continue in ${AGENT_NAMES[options.to]}`), h('span', { class: 'handoff-marks' }, agentMark(options.from), '→', agentMark(options.to))),
    h(
      'p',
      { class: 'dialog-hint' },
      'This summary is what Dawsha sends as the first message. Edit it freely. The pane you continue from keeps running.'
    ),
    area,
    error,
    h('div', { class: 'dialog-actions' }, cancel, start)
  )
  const shown = present<string | null>(dialog, null, area)
  area.setSelectionRange(0, 0)
  area.scrollTop = 0
  area.addEventListener('input', () => (error.hidden = true))
  cancel.addEventListener('click', () => shown.finish(null))
  start.addEventListener('click', () => {
    const text = area.value.trim()
    if (text === '') {
      error.textContent = 'The first message cannot be empty.'
      error.hidden = false
      return
    }
    shown.finish(text)
  })
  return shown.result
}
