import type { TurnSummary } from '../../shared/turnSummary'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h } from '../dom'
import { fileLinkHost } from '../terminalExtras'
import { commitSection } from './turnCommit'
import { diffSection } from './turnDiff'
import { checksSection, hasFailures, hasOutput } from './turnChecks'
import type { CardView } from './turnState'

function fileRow(file: TurnSummary['files'][number], open: () => void, view?: CardView): HTMLElement {
  const parts = file.path.split(/[\\/]/)
  const name = parts.pop() ?? file.path
  const folder = parts.length ? `${parts.join('/')}/` : ''
  const expanded = view?.state.expanded.has(file.path) ?? false
  const row = h('button', { class: 'chat-turn-file', type: 'button', title: file.path, dir: 'ltr', ...(view ? { 'aria-expanded': expanded ? 'true' : 'false' } : {}) },
    view ? h('span', { class: 'turn-chev', 'aria-hidden': 'true' }, expanded ? '▾' : '▸') : null,
    h('span', { class: file.status === 'A' ? 'add' : file.status === 'D' ? 'warn' : 'chat-quiet' }, file.status),
    h('span', { class: 'chat-quiet' }, folder), h('b', {}, name),
    h('span', { class: 'add' }, `+${file.added}`), h('span', { class: 'del' }, `−${file.removed}`))
  row.addEventListener('click', open)
  return row
}

function files(summary: TurnSummary, scope: string, view?: CardView): Node[] {
  const host = fileLinkHost(scope)
  return summary.files.flatMap((file) => {
    const open = view ? () => view.actions.toggleFile(file.path) : () => host.open({ path: file.path }, { ctrlKey: true, metaKey: false, shiftKey: false })
    const row = fileRow(file, open, view)
    return view?.state.expanded.has(file.path) ? [row, diffSection(file.path, view.state.diffs.get(file.path), view.actions)] : [row]
  })
}

const button = (label: string, run: () => void, extra = '', aria?: string): HTMLElement =>
  h('button', { class: `link-quiet${extra}`, type: 'button', onClick: run, ...(aria ? { 'aria-label': aria } : {}) }, label)

function actions(summary: TurnSummary, review: () => void, undo: (summary: TurnSummary) => void, view?: CardView): HTMLElement {
  const state = view?.state
  const committed = state?.commit.phase === 'done'
  const undoable = summary.checkpointRef && !committed
  const busy = state?.commit.phase === 'loading' || state?.commit.phase === 'editing' || state?.commit.phase === 'busy'
  const sendable = view && hasFailures(state?.checks ?? null) && !state?.checks?.sent
  return h('div', { class: 'chat-turn-actions' },
    sendable ? button(`Send failures to ${view.agentName}`, view.actions.sendFailures, ' turn-ink') : null,
    view && hasOutput(state?.checks ?? null) && state?.checks?.done ? button('Show full output', view.actions.showOutput) : null,
    committed && view ? button('Push', view.actions.push) : null,
    committed && view ? button('Open pull request', view.actions.openPullRequest) : null,
    button(CHAT_TEXT.reviewChanges, review),
    view && view.canCommit && !committed && !busy ? button('Commit', view.actions.startCommit) : null,
    undoable ? button(CHAT_TEXT.undoReply, () => undo(summary), '', `${CHAT_TEXT.undoReply}: ${summary.files.length} files`) : null)
}

function head(summary: TurnSummary, view?: CardView): HTMLElement {
  const commit = view?.state.commit
  return h('div', { class: 'chat-turn-head' },
    h('b', {}, CHAT_TEXT.turnChanged(summary.files.length)), h('span', { class: 'add' }, `+${summary.added}`), h('span', { class: 'del' }, `−${summary.removed}`),
    commit?.phase === 'done' ? h('span', { class: 'turn-spacer' }) : null,
    commit?.phase === 'done' ? h('span', { class: 'chat-quiet', role: 'status' }, 'Committed ', h('span', { class: 'mono' }, commit.hash)) : null)
}

/** The card under a finished reply: what it changed (each file opens its diff), its checks, and what to do next. */
export function turnSummaryCard(summary: TurnSummary, scope: string, review: () => void, undo: (summary: TurnSummary) => void, worked?: string, view?: CardView): HTMLElement {
  const committed = view?.state.commit.phase === 'done'
  return h('section', { class: 'chat-turn-summary', 'aria-label': CHAT_TEXT.turnSummary },
    head(summary, view),
    ...(committed ? [] : files(summary, scope, view)),
    view && !committed ? commitSection(view) : null,
    view ? checksSection(view.state.checks) : null,
    actions(summary, review, undo, view),
    committed ? h('span', { class: 'chat-quiet' }, 'To take this back, use Revert in Files.') : null,
    worked ? h('span', { class: 'chat-quiet chat-worked', 'data-worked': '' }, worked) : null)
}
