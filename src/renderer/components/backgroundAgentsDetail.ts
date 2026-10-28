import type { BgChange, BgFileTouch } from '../../shared/agentActivity'
import { AGENT_NAMES } from '../../shared/agents'
import { STATUS_LABELS, compactTokens, costLabel, spanLabel, type BackgroundAgent, type BgStatus } from '../../shared/backgroundAgents'
import { modelLabel } from '../../shared/sessionDetail'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { stateIcon } from './stateIcon'

const CHANGE_WORDS: Record<BgChange, string> = { A: 'Added', M: 'Modified', D: 'Deleted' }

export const statusGlyph = (status: BgStatus): Node => (status === 'running' ? stateIcon('working') : document.createTextNode(status === 'done' ? '✓' : '✕'))

const stamp = (at: number): string => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const clock = (at: number | null): string => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

export interface DetailActions {
  now: number
  canGo: boolean
  canRetry: boolean
  /** The path shown for a file: relative to the checkout when it is inside one. */
  displayPath: (file: BgFileTouch) => string
  canOpenFile: (file: BgFileTouch) => boolean
  onClose: () => void
  onGo: () => void
  onShowFile: () => void
  onCopy: () => void
  onRetry: () => void
  onOpenFile: (file: BgFileTouch) => void
}

export function emptyDetails(): HTMLElement {
  return h('aside', { class: 'bg-details bg-details-empty', id: 'bg-details', 'aria-label': 'Agent details', 'aria-live': 'polite' },
    h('p', { class: 'bg-details-hint', id: 'bg-details-hint' }, 'Select an agent to see its task, what it is doing, the files it touched and what it used.'))
}

const deltaText = (file: BgFileTouch): string => (file.added === null && file.removed === null ? '' : [file.added ? `+${file.added}` : '', file.removed ? `−${file.removed}` : ''].filter(Boolean).join(' '))

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'bg-section' }, h('h3', {}, title), ...children)
}

function feed(agent: BackgroundAgent): HTMLElement {
  return h('ol', { class: 'bg-feed', id: 'bg-feed' }, ...agent.tools.map((call) =>
    h('li', {}, h('span', { class: 'bg-feed-time' }, clock(call.at)), h('span', { class: 'bg-feed-tool' }, call.name), h('span', { class: 'bg-feed-brief' }, call.brief))))
}

function filesList(agent: BackgroundAgent, actions: DetailActions): HTMLElement {
  return h('ul', { class: 'bg-files', id: 'bg-files' }, ...agent.files.map((file) => {
    const delta = deltaText(file)
    const path = actions.displayPath(file)
    const label = `${CHANGE_WORDS[file.change]} ${path}${delta ? `, ${delta}` : ''}`
    const body = [
      h('span', { class: `bg-file-change ch-${file.change}`, 'aria-hidden': 'true', title: CHANGE_WORDS[file.change] }, file.change),
      h('span', { class: 'bg-file-path' }, path),
      h('span', { class: 'bg-file-delta', 'aria-hidden': 'true' }, delta)
    ]
    return h('li', {}, actions.canOpenFile(file)
      ? h('button', { class: 'bg-file', type: 'button', 'aria-label': `${label}. Open in Files`, title: `Open ${path} in Files`, onClick: () => actions.onOpenFile(file) }, ...body)
      : h('span', { class: 'bg-file static', title: path, 'aria-label': label }, ...body))
  }))
}

function usage(agent: BackgroundAgent, now: number): HTMLElement {
  const model = modelLabel(agent.kind, agent.model ?? undefined)
  const tokens = agent.tokensIn + agent.tokensOut > 0
    ? `${agent.tokensApprox ? '~' : ''}${compactTokens(agent.tokensIn)} in · ${compactTokens(agent.tokensOut)} out`
    : `${agent.tokensApprox ? '~' : ''}${compactTokens(agent.tokens)}`
  const rows: [string, string | null][] = [
    ['Tokens', tokens],
    ['Cost', agent.costUsd === null ? null : costLabel(agent.costUsd)],
    ['Model', model ?? null],
    ['Started', `${stamp(agent.startedAt)} · ${spanLabel(now - agent.startedAt)} ago`]
  ]
  return h('dl', { class: 'bg-kv', id: 'bg-usage' }, ...rows.flatMap(([name, value]) => (value ? [h('dt', {}, name), h('dd', {}, value)] : [])))
}

export function agentDetails(agent: BackgroundAgent, actions: DetailActions): HTMLElement {
  const end = agent.status === 'running' ? actions.now : agent.endedAt ?? agent.lastActivityAt
  const kind = agent.automatic ? `${agent.type} (automatic)` : agent.type
  const running = agent.status === 'running'
  const resultBlock = agent.result ? h('p', { class: 'bg-text', id: 'bg-detail-result' }, agent.result) : null
  return h('aside', { class: 'bg-details', id: 'bg-details', 'aria-label': `Details for ${agent.description}`, 'aria-live': 'polite' },
    h('div', { class: 'bg-details-head' },
      h('h2', { id: 'bg-detail-title' }, agent.description),
      h('button', { class: 'icon-btn bg-details-close', type: 'button', id: 'bg-details-close', 'aria-label': 'Close details', onClick: actions.onClose }, icon(ICONS.close))),
    h('p', { class: 'bg-sub' },
      h('span', { class: `bg-status st-${agent.status}`, id: 'bg-detail-status' }, h('span', { class: 'bg-status-icon', 'aria-hidden': 'true' }, statusGlyph(agent.status)), STATUS_LABELS[agent.status]),
      h('span', {}, spanLabel(end - agent.startedAt)),
      h('span', {}, `${AGENT_NAMES[agent.kind]} · ${kind}`),
      h('span', { class: 'bg-sub-session' }, 'in ', h('button', { class: 'bg-link', type: 'button', id: 'bg-go-link', title: agent.parentTitle, disabled: !actions.canGo, onClick: actions.onGo }, agent.parentTitle))),
    agent.statusNote ? h('p', { class: 'bg-note', id: 'bg-detail-note' }, agent.statusNote) : null,
    h('div', { class: 'bg-actions' },
      h('button', { class: 'btn', type: 'button', id: 'bg-show-file', onClick: actions.onShowFile }, 'Open transcript'),
      h('button', { class: 'btn', type: 'button', id: 'bg-go', disabled: !actions.canGo, title: actions.canGo ? 'Open the session that started this agent' : 'This session is in a folder that is not one of your projects', onClick: actions.onGo }, 'Go to session'),
      agent.status === 'done' ? h('button', { class: 'btn', type: 'button', id: 'bg-copy', disabled: !agent.result, onClick: actions.onCopy }, 'Copy result') : null,
      agent.status === 'failed' ? h('button', { class: 'btn', type: 'button', id: 'bg-retry', disabled: !actions.canRetry, title: actions.canRetry ? 'Type a retry request into the session prompt' : 'Open the session first', onClick: actions.onRetry }, 'Ask session to retry') : null),
    agent.prompt ? section('Task', h('p', { class: 'bg-text bg-prompt', id: 'bg-prompt' }, agent.prompt)) : null,
    running
      ? section('Live activity', agent.tools.length > 0 ? feed(agent) : h('p', { class: 'bg-muted' }, agent.lastStep || 'Waiting for the first tool call.'))
      : section('Result', resultBlock ?? h('p', { class: 'bg-muted' }, 'This agent left no final message.')),
    !running && agent.status === 'failed' && agent.tools.length > 0 ? section('Last activity', feed(agent)) : null,
    agent.files.length > 0 ? section('Files touched', filesList(agent, actions)) : null,
    section('Usage', usage(agent, actions.now)))
}
