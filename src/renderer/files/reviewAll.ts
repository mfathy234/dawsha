import type { CheckoutFile, CheckoutGroup } from '../../shared/allSessions'
import { agentMark } from '../components/agentMark'
import { h } from '../dom'
import { fileIcon } from './fileIcon'

export interface AllSessionsHooks {
  openFile(folder: string, path: string): void
  jumpToSession(paneId: string): void
}

const minus = '−'
const BADGE_TITLES: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'New (untracked)', R: 'Renamed', C: 'Copied', T: 'Type changed', '!': 'Conflict' }

const split = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) }
}

function fileRow(group: CheckoutGroup, file: CheckoutFile, hooks: AllSessionsHooks): HTMLElement {
  const { name, folder } = split(file.path)
  const letter = file.letter === 'U' ? 'A' : file.letter
  return h('div', { class: 'files-review-row all-row', role: 'listitem', 'data-path': file.path },
    h('button', { class: 'files-review-open', type: 'button', title: file.path, onClick: () => hooks.openFile(group.folder, file.path) },
      fileIcon(file.path), h('span', { class: 'files-flat-name' }, name), folder ? h('span', { class: 'files-flat-dir' }, folder) : null),
    file.added !== null || file.removed !== null ? h('span', { class: 'files-review-stat' }, h('span', { class: 'plus' }, `+${file.added ?? 0}`), ' ', h('span', { class: 'minus' }, `${minus}${file.removed ?? 0}`)) : null,
    h('span', { class: `files-badge b-${letter}`, title: BADGE_TITLES[file.letter] ?? file.letter }, letter))
}

function groupBlock(group: CheckoutGroup, hooks: AllSessionsHooks): HTMLElement {
  const first = group.sessions[0]
  const tile = first ? agentMark(first.agent) : null
  const who = h('div', { class: 'all-group-who' },
    tile,
    h('span', { class: 'all-group-title', dir: 'auto' }, group.heading),
    h('span', { class: 'all-group-count' }, `${group.files.length} file${group.files.length === 1 ? '' : 's'}`),
    h('span', { class: 'files-review-stat' }, h('span', { class: 'plus' }, `+${group.added}`), ' ', h('span', { class: 'minus' }, `${minus}${group.removed}`)))
  const sessions = group.main
    ? group.sessions.map((session) => h('button', { class: 'link-quiet all-group-session', type: 'button', onClick: () => hooks.jumpToSession(session.paneId) }, session.title))
    : first ? [h('button', { class: 'link-quiet all-group-session', type: 'button', onClick: () => hooks.jumpToSession(first.paneId) }, 'Go to session')] : []
  const note = group.main ? null : h('div', { class: 'all-group-branch' }, group.branch ?? group.folder)
  return h('section', { class: 'all-group', 'data-folder': group.folder, 'aria-label': group.heading },
    h('div', { class: 'all-group-head' }, who, sessions.length > 0 ? h('div', { class: 'all-group-sessions' }, ...sessions) : null, note),
    h('div', { class: 'all-group-files', role: 'list' }, ...group.files.map((file) => fileRow(group, file, hooks))))
}

/** Every checkout's uncommitted changes, grouped by the session working there. */
export function allSessionsView(groups: readonly CheckoutGroup[], hooks: AllSessionsHooks): HTMLElement[] {
  if (groups.length === 0) return [h('p', { class: 'all-empty' }, 'Nothing to review. No session has changed any files yet.')]
  return groups.map((group) => groupBlock(group, hooks))
}
