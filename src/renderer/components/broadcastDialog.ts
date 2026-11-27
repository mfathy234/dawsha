import { BROADCAST_MAX, planFor, planNote, sendCount, sendLabel, ticked, type BroadcastFilter, type BroadcastSession } from '../../shared/broadcast'
import { broadcastSessions, sendToMany } from '../broadcast'
import { h } from '../dom'
import { nextDialogId, present } from './dialogs'
import { toast } from './toast'
import './broadcast.css'

/** "Send to several…": one message to many sessions; working ones get it when their turn ends, ones that need you are skipped. */
export async function openBroadcast(firstPaneId?: string): Promise<void> {
  const sessions = broadcastSessions()
  if (sessions.length === 0) return toast('There are no sessions to send to.', 'info')
  const id = nextDialogId()
  const picked = new Set<string>(firstPaneId && sessions.some((session) => session.paneId === firstPaneId && planFor(session) !== 'skip') ? [firstPaneId] : [])
  const message = h('textarea', { class: 'text-input broadcast-text', id: `broadcast-text-${id}`, rows: 3, maxlength: BROADCAST_MAX, placeholder: 'What should they do?' })
  const count = h('span', { class: 'broadcast-count', role: 'status' })
  const list = h('div', { class: 'broadcast-list', role: 'group', 'aria-label': 'Sessions' })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const send = h('button', { class: 'btn primary', type: 'button', disabled: true }, sendLabel(0))
  const boxes = new Map<string, HTMLInputElement>()

  const refresh = (): void => {
    for (const [paneId, box] of boxes) box.checked = picked.has(paneId)
    const total = sendCount(sessions, picked)
    count.textContent = `${total} of ${sessions.length} selected`
    send.textContent = sendLabel(total)
    send.disabled = total === 0 || message.value.trim() === ''
  }
  const apply = (filter: BroadcastFilter): void => {
    picked.clear()
    for (const paneId of ticked(sessions, filter)) picked.add(paneId)
    refresh()
  }
  const row = (session: BroadcastSession): HTMLElement => {
    const skip = planFor(session) === 'skip'
    const box = h('input', { type: 'checkbox', disabled: skip, 'aria-label': session.name })
    box.addEventListener('change', () => {
      if (box.checked) picked.add(session.paneId)
      else picked.delete(session.paneId)
      refresh()
    })
    boxes.set(session.paneId, box)
    return h('label', { class: `broadcast-row${skip ? ' skipped' : ''}`, 'data-pane-id': session.paneId },
      box, h('span', { class: 'broadcast-name', dir: 'auto' }, session.name), h('span', { class: 'broadcast-project' }, session.project), h('span', { class: 'broadcast-state' }, planNote(session)))
  }
  list.append(...sessions.map(row))
  const projects = [...new Map(sessions.map((session) => [session.projectId, session.project])).entries()]
  const chip = (label: string, filter: BroadcastFilter): HTMLElement => h('button', { class: 'broadcast-chip', type: 'button', onClick: () => apply(filter) }, label)
  const filters = h('div', { class: 'broadcast-filters', role: 'group', 'aria-label': 'Quick picks' },
    chip('Idle sessions', { kind: 'idle' }), ...projects.map(([projectId, name]) => chip(name, { kind: 'project', projectId })), chip('All', { kind: 'all' }), count)
  const dialog = h('div', { class: 'dialog broadcast-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `dlg-title-${id}` },
    h('h2', { id: `dlg-title-${id}` }, 'Send to several sessions'),
    h('label', { for: `broadcast-text-${id}`, class: 'dialog-label' }, 'Message'),
    message, filters, list,
    h('p', { class: 'dialog-hint' }, 'A working session gets the message when it finishes, never in the middle of a turn. A session waiting on a question is skipped.'),
    h('div', { class: 'dialog-actions' }, cancel, send))
  const shown = present<boolean>(dialog, false, message)
  message.addEventListener('input', refresh)
  cancel.addEventListener('click', () => shown.finish(false))
  send.addEventListener('click', () => shown.finish(true))
  refresh()
  if (!(await shown.result)) return
  const text = message.value.trim()
  if (text === '') return
  const result = sendToMany(text, picked)
  const parts = [result.sent > 0 ? `Sent to ${result.sent} session${result.sent === 1 ? '' : 's'}` : '', result.waiting > 0 ? `${result.waiting} will get it when their turn ends` : ''].filter(Boolean)
  toast(parts.length > 0 ? `${parts.join('. ')}.` : 'Nothing was sent.', 'info')
}
