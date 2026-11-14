import { formatDuration } from '../../shared/sessionCost'
import { formatUsd } from '../../shared/usage'
import { buildTodayRecap, formatRecapText, type RecapRow, type TodayRecap, type WorkRecapData } from '../../shared/workRecap'
import { api } from '../api'
import { h } from '../dom'
import { store } from '../state'
import { agentMark } from './agentMark'
import { toast } from './toast'

const changesText = (row: Pick<RecapRow, 'files' | 'added' | 'removed'>): string =>
  // Counted from the commits made during the session, so say so.
  row.files === 0 ? 'Nothing committed' : `${row.files} file${row.files === 1 ? '' : 's'} committed +${row.added} −${row.removed}`

function costOf(item: { session?: { id: string } }): number | null {
  const id = item.session?.id
  const cost = id ? store.state.usage.sessions[id]?.costUsd ?? null : null
  return cost !== null && cost > 0 ? cost : null
}

export const todayRecap = (data: WorkRecapData | null): TodayRecap => buildTodayRecap(data, Date.now(), costOf)

async function copyRecap(recap: TodayRecap): Promise<void> {
  try {
    await api.writeClipboard(formatRecapText(recap))
    toast('Copied', 'info')
  } catch {
    toast('Could not copy the recap. Try again.')
  }
}

function row(item: RecapRow): HTMLElement {
  return h('li', { class: 'today-row' },
    agentMark(item.agent),
    h('span', { class: 'today-main' },
      h('strong', { class: 'today-title', dir: 'auto' }, item.title),
      h('span', { class: 'today-project', dir: 'auto' }, item.project)),
    h('span', { class: 'today-time' }, formatDuration(item.activeMs)),
    h('span', { class: 'today-changes' }, changesText(item)),
    h('span', { class: 'today-cost' }, item.costUsd === null ? '' : formatUsd(item.costUsd)))
}

/** The Today card at the top of Work: what each session did today, a total, and a plain-text copy for a standup. */
export function todaySection(data: WorkRecapData | null, loading: boolean): HTMLElement {
  const recap = todayRecap(data)
  const copy = h('button', { class: 'btn ghost', type: 'button', id: 'work-today-copy', disabled: recap.rows.length === 0, onClick: () => void copyRecap(recap) }, 'Copy as text')
  const head = h('div', { class: 'usage-panel-head' }, h('h2', {}, 'Today'), h('span', { class: 'spacer' }), copy)
  if (recap.rows.length === 0) {
    return h('section', { class: 'usage-panel work-today', id: 'work-today', 'aria-label': 'Today' }, head,
      h('p', { class: 'today-empty muted', role: 'status' }, loading && !data ? 'Reading today’s work…' : 'Nothing yet today.'))
  }
  const total = [formatDuration(recap.totalMs), recap.totalFiles > 0 ? `${recap.totalFiles} file${recap.totalFiles === 1 ? '' : 's'} committed +${recap.totalAdded} −${recap.totalRemoved}` : 'Nothing committed', ...(recap.totalCostUsd !== null ? [formatUsd(recap.totalCostUsd)] : [])]
  return h('section', { class: 'usage-panel work-today', id: 'work-today', 'aria-label': 'Today' }, head,
    h('ul', { class: 'today-rows' }, ...recap.rows.map(row)),
    h('p', { class: 'today-total', id: 'work-today-total' }, h('span', {}, 'Total'), h('span', {}, total.join(' · '))))
}
