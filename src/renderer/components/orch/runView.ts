import type { OrchAgentRow, OrchRunDetail } from '../../../shared/orch/api'
import { boardCards, DEFAULT_BOARD_FILTER, isFinishedRun, timelineEvents, usageRows } from '../../../shared/orch/board'
import type { OrchProfile } from '../../../shared/orch/profiles'
import { formatUsd } from '../../../shared/usage'
import { focusPane } from '../../actions'
import { clear, h } from '../../dom'
import { cancelRun, handoffTask, showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { renderTaskBoard } from './boardsView'
import { AGENT_STATE_LABEL, elapsed, modelBadge, pill, ROLE_LABEL, stagesOf } from './orchUi'
import './runView.css'

const TIMELINE_LIMIT = 100
const HANDOFF_STATES = new Set(['working', 'waiting', 'stalled', 'idle'])
const TONE: Record<string, string> = { working: 'working', waiting: 'waiting', stalled: 'stalled', idle: 'idle', done: 'done' }

interface Handoff {
  agentId: string
  taskKey: string
  profileId: string
}

const keyOfTask = (taskId: string, runId: string): string => (taskId.startsWith(`${runId}:`) ? taskId.slice(runId.length + 1) : taskId)

const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function profileLabel(p: OrchProfile): string {
  return `${p.name} · ${p.runner}${p.model ? ` ${p.model}` : ''}`
}

/** One run's dashboard: header, task board, agents, usage and timeline. */
export class OrchRunView {
  readonly el = h('section', { class: 'orch-section orch-run' })
  private taskKey: string | null = null
  private storyOpen = false
  private handoff: Handoff | null = null
  private note = ''
  private runId: string | null = null
  private signature = ''
  private state: AppState | null = null

  update(state: AppState): void {
    this.state = state
    const run = state.orch?.runs.find((r) => r.id === state.orchRunId) ?? null
    if (run?.id !== this.runId) {
      this.runId = run?.id ?? null
      this.taskKey = null
      this.handoff = null
      this.note = ''
    }
    if (!run) return this.renderMissing()
    const panes = state.panes.map((p) => [p.id, p.tabs.map((t) => t.orchAgentId ?? '')])
    const signature = JSON.stringify([run, state.orch?.runs.map((r) => [r.id, r.title, r.stage, r.tasksDone, r.taskCount]), state.settings.orchestrator.profiles.map((p) => p.id), panes, this.taskKey, this.handoff, Math.floor(Date.now() / 60_000)])
    if (signature === this.signature) return
    this.signature = signature
    this.render(run, state)
  }

  private rerender(): void {
    this.signature = ''
    if (this.state) this.update(this.state)
  }

  private renderMissing(): void {
    this.signature = ''
    clear(this.el)
    this.el.append(h('div', { class: 'orch-board-empty' }, 'This run is no longer available.'), this.backLink())
  }

  private backLink(): HTMLElement {
    return h('button', { class: 'orch-back', type: 'button', onClick: () => showOrch('runs') }, '← All runs')
  }

  private render(run: OrchRunDetail, state: AppState): void {
    clear(this.el)
    this.el.append(this.switcher(run, state), this.header(run), this.story(run), this.dashboard(run, state))
  }

  private switcher(run: OrchRunDetail, state: AppState): HTMLElement {
    const active = (state.orch?.runs ?? []).filter((r) => !isFinishedRun(r) || r.id === run.id)
    return h(
      'nav',
      { class: 'orch-runswitch', 'aria-label': 'Runs' },
      this.backLink(),
      ...active.map((r) =>
        h(
          'button',
          { class: 'orch-rs', type: 'button', 'aria-current': r.id === run.id ? 'page' : undefined, onClick: () => showOrch('runs', r.id) },
          r.title,
          r.openDecisions > 0 ? h('span', { class: 'orch-badge' }, String(r.openDecisions)) : null
        )
      )
    )
  }

  private header(run: OrchRunDetail): HTMLElement {
    const finished = Boolean(run.imported) || isFinishedRun(run)
    const total = run.usage.total
    const done = run.tasks.length > 0 ? run.tasks.filter((t) => t.status === 'approved' || t.status === 'cancelled').length : run.tasksDone
    const count = run.tasks.length > 0 ? run.tasks.length : run.taskCount
    const cost = `${formatUsd(total.costUsd)}${total.complete ? '' : ' (incomplete)'}`
    const kpi = (value: string, label: string, tone = ''): HTMLElement => h('div', { class: 'orch-kpi' }, h('b', { class: tone }, value), h('span', {}, label))
    return h(
      'div',
      { class: 'orch-panel orch-runhead' },
      h(
        'div',
        { class: 'orch-runhead-main' },
        h('h2', { class: 'orch-run-title' }, run.title),
        h(
          'div',
          { class: 'orch-muted orch-run-sub' },
          `${run.kind === 'bug' ? 'Bug fix' : 'Feature'} · ${run.plan || 'No plan'}`,
          run.branch ? ' · branch ' : null,
          run.branch ? h('span', { class: 'orch-mono' }, run.branch) : null
        ),
        this.stages(run),
        run.imported ? h('p', { class: 'orch-muted' }, `Imported from ${run.imported.from} · read-only`) : finished ? h('p', { class: 'orch-muted' }, 'Finished · read-only') : null
      ),
      h(
        'div',
        { class: 'orch-kpis' },
        kpi(`${done} / ${count}`, 'tasks done'),
        kpi(elapsed(run.createdAt, run.finishedAt ?? Date.now()), finished ? 'total time' : 'elapsed'),
        kpi(cost, 'spent'),
        kpi(String(run.openDecisions), 'need you', run.openDecisions > 0 ? 'orch-warn' : '')
      ),
      finished ? null : h('button', { class: 'btn danger orch-cancel', type: 'button', onClick: () => void cancelRun(run.id, run.title) }, 'Cancel run')
    )
  }

  private stages(run: OrchRunDetail): HTMLElement {
    const stages = stagesOf(run)
    const at = run.stage === 'review' ? stages.findIndex((s) => s.id === 'build') : stages.findIndex((s) => s.id === run.stage)
    const finished = run.stage === 'done'
    return h(
      'ol',
      { class: 'orch-stages', 'aria-label': 'Stages' },
      ...stages.map((stage, i) => {
        const state = finished || i < at ? 'done' : i === at && run.stage !== 'cancelled' ? 'now' : 'todo'
        return h('li', { class: `orch-stage ${state}`, 'aria-current': state === 'now' ? 'step' : undefined }, h('i', {}, state === 'done' ? '✓' : String(i + 1)), stage.label)
      }),
      run.stage === 'cancelled' ? h('li', { class: 'orch-stage cancelled' }, 'Cancelled') : null
    )
  }

  private story(run: OrchRunDetail): HTMLElement {
    const details = h('details', { class: 'orch-panel orch-story' }, h('summary', { class: 'orch-panel-title' }, 'Story'), h('p', { class: 'orch-story-text' }, run.story || 'No story.'))
    details.open = this.storyOpen
    details.addEventListener('toggle', () => (this.storyOpen = details.open))
    return details
  }

  private dashboard(run: OrchRunDetail, state: AppState): HTMLElement {
    return h('div', { class: 'orch-dash' }, this.tasks(run, state), h('div', { class: 'orch-side' }, this.agents(run, state), this.usage(run), this.timeline(run)))
  }

  private tasks(run: OrchRunDetail, state: AppState): HTMLElement {
    const cards = boardCards([run], state.settings.projects, { ...DEFAULT_BOARD_FILTER, status: 'all', includeFinished: true, runId: run.id })
    const board = renderTaskBoard(cards, {
      showProject: false,
      showRun: false,
      selectedKey: this.taskKey,
      emptyText: 'No tasks yet. The lead creates them once the plan is approved.',
      onOpen: (card) => {
        this.taskKey = this.taskKey === card.key ? null : card.key
        this.rerender()
      }
    })
    const hint = this.taskKey ? `Timeline shows ${this.taskKey}. Click it again to clear.` : 'Click a card to filter the timeline'
    return h('div', { class: 'orch-panel orch-tasks' }, h('h3', { class: 'orch-panel-title' }, 'Tasks', h('span', { class: 'orch-panel-hint' }, hint)), board)
  }

  private agents(run: OrchRunDetail, state: AppState): HTMLElement {
    const rows = run.agents.map((agent) => this.agentRows(run, agent, state))
    const table = h('table', { class: 'orch-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Agent'), h('th', { scope: 'col' }, 'State'), h('th', { scope: 'col', class: 'num' }, 'Tokens'), h('th', { scope: 'col', class: 'num' }, 'Cost'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))), h('tbody', {}, ...rows.flat()))
    return h('div', { class: 'orch-panel' }, h('h3', { class: 'orch-panel-title' }, 'Agents'), run.agents.length === 0 ? h('div', { class: 'orch-board-empty' }, 'No agents yet.') : h('div', { class: 'orch-scroll' }, table))
  }

  private agentRows(run: OrchRunDetail, agent: OrchAgentRow, state: AppState): HTMLElement[] {
    const cost = run.usage.agents.find((a) => a.agentId === agent.id)
    const { rows } = usageRows({ ...run.usage, agents: cost ? [cost] : [] })
    const row = rows[0]
    const pane = state.panes.find((p) => p.tabs.some((t) => t.orchAgentId === agent.id))
    const canHandoff = !run.imported && !isFinishedRun(run) && !agent.retired && agent.taskKey !== null && HANDOFF_STATES.has(agent.state)
    const open = h('button', { class: 'btn orch-small', type: 'button', disabled: pane ? undefined : true, title: pane ? 'Focus this agent’s pane' : 'This agent has no open pane', onClick: () => pane && focusPane(pane.id) }, 'Open pane')
    const actions = h('div', { class: 'orch-actions' }, open, canHandoff ? h('button', { class: 'btn orch-small', type: 'button', onClick: () => this.openHandoff(agent, state) }, 'Continue with…') : null)
    const main = h(
      'tr',
      { class: agent.retired ? 'retired' : '' },
      h('td', {}, h('div', { class: 'orch-role' }, ROLE_LABEL[agent.role]), h('div', { class: 'orch-sub' }, modelBadge(agent.runner, agent.model), agent.taskKey ? h('span', { class: 'orch-mono' }, ` ${agent.taskKey}`) : null)),
      h('td', {}, agent.retired ? pill('replaced', 'idle') : pill(AGENT_STATE_LABEL[agent.state], TONE[agent.state] ?? 'idle')),
      h('td', { class: 'num' }, cost ? `${row.input} in / ${row.output} out` : '–'),
      h('td', { class: 'num' }, row ? row.cost : '–'),
      h('td', {}, actions)
    )
    return !run.imported && !isFinishedRun(run) && this.handoff?.agentId === agent.id ? [main, this.handoffRow(run, agent, state)] : [main]
  }

  private openHandoff(agent: OrchAgentRow, state: AppState): void {
    if (!agent.taskKey) return
    const profiles = state.settings.orchestrator.profiles
    const first = profiles.find((p) => p.role === agent.role && p.model !== agent.model) ?? profiles[0]
    this.handoff = this.handoff?.agentId === agent.id ? null : { agentId: agent.id, taskKey: agent.taskKey, profileId: first?.id ?? '' }
    this.note = ''
    this.rerender()
  }

  private handoffRow(run: OrchRunDetail, agent: OrchAgentRow, state: AppState): HTMLElement {
    const profiles = state.settings.orchestrator.profiles
    const handoff = this.handoff as Handoff
    const select = h('select', { class: 'orch-select', id: `orch-handoff-model-${agent.id}` }, ...profiles.map((p) => h('option', { value: p.id }, profileLabel(p))))
    select.value = handoff.profileId
    select.addEventListener('change', () => (handoff.profileId = select.value))
    const note = h('textarea', { class: 'orch-note', id: `orch-handoff-note-${agent.id}`, rows: 2, placeholder: 'What should the new model know? (optional)' })
    note.value = this.note
    note.addEventListener('input', () => (this.note = note.value))
    const go = h('button', { class: 'btn primary orch-small', type: 'button', disabled: profiles.length === 0 ? true : undefined }, 'Continue')
    go.addEventListener('click', () => {
      if (!handoff.profileId) return
      go.disabled = true
      void handoffTask(run.id, handoff.taskKey, handoff.profileId, this.note.trim()).then((ok) => {
        if (ok) this.handoff = null
        this.rerender()
      })
    })
    const cancel = h('button', { class: 'btn orch-small', type: 'button', onClick: () => { this.handoff = null; this.rerender() } }, 'Cancel')
    return h(
      'tr',
      { class: 'orch-handoff' },
      h(
        'td',
        { colspan: 5 },
        h(
          'div',
          { class: 'orch-handoff-form' },
          h('label', { for: select.id }, `Continue ${handoff.taskKey} with`),
          select,
          h('label', { for: note.id }, 'Note'),
          note,
          h('div', { class: 'orch-actions' }, go, cancel)
        )
      )
    )
  }

  private usage(run: OrchRunDetail): HTMLElement {
    const { rows, total } = usageRows(run.usage)
    const marker = (r: { marker: string; markerTitle: string }): HTMLElement => h('span', { class: `orch-src src-${r.marker === 'R' ? 'r' : r.marker === 'E' ? 'e' : r.marker === 'L' ? 'l' : 'n'}`, title: r.markerTitle, 'aria-label': r.markerTitle }, r.marker)
    const body = rows.map((r) =>
      h('tr', {}, h('td', {}, ROLE_LABEL[r.role], ' ', modelBadge(r.runner, r.model)), h('td', { class: 'num' }, r.input), h('td', { class: 'num' }, r.output), h('td', { class: 'num' }, r.cache), h('td', { class: 'num' }, r.cost, ' ', marker(r)))
    )
    const foot = h('tr', { class: 'tot' }, h('td', {}, `Total · ${total.agents} ${total.agents === 1 ? 'agent' : 'agents'}`), h('td', { class: 'num' }, total.input), h('td', { class: 'num' }, total.output), h('td', { class: 'num' }, total.cache), h('td', { class: 'num' }, total.cost, total.incomplete ? ' (incomplete)' : ''))
    const table = h('table', { class: 'orch-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Agent'), h('th', { scope: 'col', class: 'num' }, 'In'), h('th', { scope: 'col', class: 'num' }, 'Out'), h('th', { scope: 'col', class: 'num' }, 'Cache'), h('th', { scope: 'col', class: 'num' }, 'Cost'))), h('tbody', {}, ...body, foot))
    return h(
      'div',
      { class: 'orch-panel' },
      h('h3', { class: 'orch-panel-title' }, 'Usage · this run', h('span', { class: 'orch-panel-hint' }, 'tokens · cost')),
      rows.length === 0 ? h('div', { class: 'orch-board-empty' }, 'No usage yet.') : h('div', { class: 'orch-scroll' }, table),
      h('div', { class: 'orch-legend orch-muted' }, 'R reported by the CLI · E estimated from your prices · L local, free · – no price or no usage yet. Cache is read plus write.')
    )
  }

  private timeline(run: OrchRunDetail): HTMLElement {
    const events = timelineEvents(run.events, run.id, this.taskKey).slice(0, TIMELINE_LIMIT)
    const filter = this.taskKey
      ? h('button', { class: 'btn orch-small', type: 'button', onClick: () => { this.taskKey = null; this.rerender() } }, `Showing ${this.taskKey} · Clear`)
      : null
    const list = events.map((e) => {
      const key = e.taskId ? keyOfTask(e.taskId, run.id) : null
      return h(
        'li',
        { class: 'orch-ev' },
        h('time', { datetime: new Date(e.at).toISOString() }, timeOf(e.at)),
        h('span', {}, key ? h('button', { class: 'orch-keylink orch-mono', type: 'button', title: `Show only ${key}`, onClick: () => { this.taskKey = key; this.rerender() } }, key) : null, key ? ' ' : null, e.text)
      )
    })
    return h(
      'div',
      { class: 'orch-panel' },
      h('h3', { class: 'orch-panel-title' }, 'Timeline', filter),
      list.length === 0 ? h('div', { class: 'orch-board-empty' }, this.taskKey ? `Nothing happened on ${this.taskKey} yet.` : 'Nothing has happened yet.') : h('ol', { class: 'orch-timeline' }, ...list)
    )
  }
}

