import { agentLabel } from '../../shared/agents'
import { parsePermissionDetail, permissionPromptText } from '../../shared/permissionPrompt'
import { needsAsk, sessionLine, sessionTime } from '../../shared/sessionLine'
import { compareSessionStates, countSessionStates, sessionState, type SessionState } from '../../shared/sessionState'
import { permissionTail } from '../actions'
import type { PaneView } from '../derive'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { sessionNote } from '../sessionNotes'
import { parsePlanLabel } from '../../shared/planProgress'
import { stateSince } from '../stateClock'
import type { AppState } from '../state'
import { identityMark } from './crewAvatar'
import { tagTooltip } from './sessionTagUi'
import { stateIcon } from './stateIcon'

export const viewState = (view: PaneView): SessionState => sessionState({ status: view.status, attention: view.attention })

// A session with no name yet shows its agent and number, not the project name its siblings share.
export const sessionLabel = (view: PaneView): string => (view.named ? view.title : `${view.agent === 'shell' ? 'Terminal' : agentLabel(view.agent)} session ${view.index + 1}`)

/** What a session row says besides its name. */
export interface RowFacts {
  state: SessionState
  /** Line 2: what it is doing, what it asks, or the state word. */
  line: string
  /** What a waiting session asks, empty otherwise. */
  ask: string
  /** Right side: working for, waiting for, or since done. */
  time: string
  /** Hover card: name, branch, tag and status. */
  tooltip: string
}

// The last ask read for each waiting pane. A terminal repaint (a resize, ConPTY redrawing) can clear the
// prompt from the screen while the session still waits, so the row keeps what it read until the wait ends.
const lastAsk = new Map<string, string>()

function waitingAsk(paneId: string, state: SessionState): string {
  if (state !== 'needs') {
    lastAsk.delete(paneId)
    return ''
  }
  const tail = permissionTail(paneId)
  const ask = needsAsk(parsePermissionDetail(tail), permissionPromptText(tail))
  if (ask !== '') lastAsk.set(paneId, ask)
  return ask || (lastAsk.get(paneId) ?? '')
}

export function rowFacts(app: AppState, view: PaneView): RowFacts {
  const state = viewState(view)
  const note = sessionNote(view.pane.id)
  const ask = waitingAsk(view.pane.id, state)
  const line = sessionLine({ state, ask, recap: note.recap, tool: note.tool, plan: note.plan, changed: view.info.changes?.files ?? null, agents: view.info.ops?.running.length ?? 0 })
  const time = sessionTime(state, stateSince(view.pane.id, state, app.now), app.now)
  const tooltip = [sessionLabel(view), view.fullTitle !== view.title ? view.fullTitle : '', view.branch ? `Branch ${view.branch}` : '', view.tag ? tagTooltip(view.tag, view.tagAuto) : '', line].filter(Boolean).join('\n')
  return { state, line, ask, time, tooltip }
}

/** Line 2 of a session row. "Done" is green, a working session gets its spinner, a waiting one its ask in needs colour. */
function lineTwo(facts: RowFacts, dimmed: boolean): HTMLElement {
  if (dimmed) return h('span', { class: 'sess-meta' }, h('span', { class: 'sess-state state-idle' }, h('span', { class: 'sess-state-word' }, 'Waiting, listed above')))
  const { state, line } = facts
  const split = state === 'done' ? line.indexOf(' · ') : -1
  const word = split < 0 ? line : line.slice(0, split)
  const rest = split < 0 ? '' : line.slice(split)
  return h(
    'span',
    { class: 'sess-meta' },
    h('span', { class: `sess-state state-${state}` }, state === 'working' ? stateIcon('working') : null, h('span', { class: 'sess-state-word', dir: 'auto' }, word), rest ? h('span', { class: 'sess-extra' }, rest) : null)
  )
}

export interface SessionRowOptions {
  key: string
  selected: boolean
  dimmed: boolean
  /** The project name, for a row in the Pinned group: it adds the pin glyph and names the project on hover. */
  pinnedIn?: string
  onClick: () => void
}

/** An open session in its project: agent mark, title (wraps), what it is doing, and the time on the right. */
export function sessionRowButton(view: PaneView, facts: RowFacts, options: SessionRowOptions): HTMLElement {
  const { key, selected, dimmed, onClick, pinnedIn } = options
  return h(
    'button',
    {
      class: `sess-row${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`,
      type: 'button',
      title: pinnedIn ? `${facts.tooltip}
Pinned in ${pinnedIn}` : facts.tooltip,
      'aria-current': selected ? 'true' : undefined,
      'data-nav': key,
      onClick
    },
    identityMark(view),
    h('span', { class: 'sess-body' }, h('span', { class: 'sess-name', dir: 'auto' }, sessionLabel(view)), lineTwo(facts, dimmed), dimmed ? null : planLine(view)),
    facts.time && !dimmed ? h('span', { class: 'sess-age', 'aria-label': timeLabel(facts) }, facts.time) : null,
    pinnedIn ? h('span', { class: 'sess-pin', role: 'img', 'aria-label': 'Pinned' }, icon(ICONS.pin)) : null
  )
}

/** "5/7" in accent and a thin bar, for a session that has a plan; nothing otherwise. */
function planLine(view: PaneView): HTMLElement | null {
  const plan = parsePlanLabel(sessionNote(view.pane.id).plan)
  if (!plan) return null
  return h(
    'span',
    { class: 'sess-plan', role: 'img', 'aria-label': `Plan, ${plan.done} of ${plan.total} done` },
    h('span', { class: 'sess-plan-n' }, `${plan.done}/${plan.total}`),
    h('span', { class: 'sess-plan-bar' }, h('i', { style: `width: ${plan.percent}%` }))
  )
}

const timeLabel = (facts: RowFacts): string => {
  const verb = facts.state === 'working' ? 'working for' : facts.state === 'needs' ? 'waiting for' : 'done'
  return facts.state === 'done' ? `done ${facts.time} ago` : `${verb} ${facts.time}`
}

/** A waiting session in the Needs you section: title, then what it asks in needs colour and its project, and how long it has waited. */
export function waitingRowButton(view: PaneView, facts: RowFacts, projectName: string | null, selected: boolean, onClick: () => void): HTMLElement {
  const ask = facts.ask || 'Needs you'
  return h(
    'button',
    {
      class: `sess-row needs-row${selected ? ' selected' : ''}`,
      type: 'button',
      title: facts.tooltip,
      'aria-label': `${sessionLabel(view)}${projectName ? ` in ${projectName}` : ''}, needs you: ${ask}`,
      'data-nav': `n:${view.pane.id}`,
      onClick
    },
    identityMark(view),
    h(
      'span',
      { class: 'sess-body' },
      h('span', { class: 'sess-name', dir: 'auto' }, sessionLabel(view)),
      h('span', { class: 'sess-meta' }, h('span', { class: 'needs-t', dir: 'auto' }, ask), projectName ? h('span', { class: 'needs-project' }, projectName) : null)
    ),
    facts.time ? h('span', { class: 'sess-age', 'aria-label': `waiting for ${facts.time}` }, facts.time) : null
  )
}

const DOT_CLASS: Partial<Record<SessionState, string>> = { working: 'w', needs: 'n', done: 'd' }

/** One small dot per live session, coloured by state: working blue, needs you orange, done green. Idle sessions have none. */
export function projectDots(states: readonly SessionState[]): HTMLElement | null {
  const live = [...states].filter((state) => DOT_CLASS[state]).sort(compareSessionStates)
  if (live.length === 0) return null
  const counts = countSessionStates(states)
  const words = [counts.working ? `${counts.working} working` : '', counts.needs ? `${counts.needs} need${counts.needs === 1 ? 's' : ''} you` : '', counts.done ? `${counts.done} done` : ''].filter(Boolean)
  return h('span', { class: 'proj-dots', role: 'img', 'aria-label': words.join(', ') }, ...live.map((state) => h('i', { class: `dot-${DOT_CLASS[state]}` })))
}
