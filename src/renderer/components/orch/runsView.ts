import type { OrchDecisionView, OrchRunDetail } from '../../../shared/orch/api'
import {
  QUICK_OPTION_LIMIT,
  activitySummary,
  decisionKindLabel,
  isActiveRun,
  liveTimeline,
  oldestDecisionByRun,
  runCounts,
  runTag
} from '../../../shared/orch/review'
import { clear, h } from '../../dom'
import { answerDecision, showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { ROLE_LABEL, currentStageIndex, elapsed, modelBadge, pill, stagesOf, timeAgo } from './orchUi'
import './runsView.css'

const KIND_LABEL = { bug: 'Bug fix', feature: 'Feature' } as const

/** All runs: a card per active run, the live timeline across runs and the finished runs. */
export class OrchRunsView {
  readonly el = h('section', { class: 'orch-section orch-runs' })
  private signature = ''
  private readonly drafts = new Map<string, string>()
  private finishedOpen = false

  update(state: AppState): void {
    const snapshot = state.orch
    const runs = snapshot?.runs ?? []
    const decisions = snapshot?.decisions ?? []
    const projects = new Map(state.settings.projects.map((p) => [p.id, p.name]))
    const typing = this.el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement
    const minute = typing || this.drafts.size > 0 ? 0 : Math.floor(Date.now() / 60_000)
    const signature = JSON.stringify([runs.map(runKey), decisions.map((d) => [d.id, d.question, d.options, d.createdAt]), [...projects], minute, this.finishedOpen])
    if (signature === this.signature) return
    this.signature = signature
    this.render(runs, decisions, projects)
  }

  private render(runs: OrchRunDetail[], decisions: OrchDecisionView[], projects: Map<string, string>): void {
    const focused = document.activeElement instanceof HTMLInputElement && this.el.contains(document.activeElement) ? document.activeElement : null
    const focusId = focused?.dataset.decision ?? null
    const caret = focused?.selectionStart ?? null
    for (const id of [...this.drafts.keys()]) if (!decisions.some((d) => d.id === id)) this.drafts.delete(id)
    clear(this.el)
    if (runs.length === 0) {
      this.el.append(this.empty())
      return
    }
    const active = runs.filter(isActiveRun)
    const finished = runs.filter((r) => !isActiveRun(r))
    const oldest = oldestDecisionByRun(decisions)
    this.el.append(this.header(runs, decisions))
    if (active.length > 0) {
      this.el.append(h('div', { class: 'runs-grid' }, ...active.map((run) => this.card(run, oldest.get(run.id), projects))))
    } else {
      this.el.append(h('p', { class: 'orch-muted runs-none' }, 'No run is active. Start one, or open a finished run below.'))
    }
    // Live means active runs only; finished and cancelled runs keep their timeline in their own dashboard.
    if (active.length > 0) this.el.append(this.timeline(active))
    if (finished.length > 0) this.el.append(this.finished(finished))
    if (focusId) {
      const input = this.el.querySelector<HTMLInputElement>(`input[data-decision="${CSS.escape(focusId)}"]`)
      input?.focus()
      if (input && caret !== null) input.setSelectionRange(caret, caret)
    }
  }

  private empty(): HTMLElement {
    return h(
      'section',
      { class: 'orch-empty' },
      h('h2', {}, 'No runs yet'),
      h('p', {}, 'A run is one job for a team of agents: build a feature from a user story, or fix a bug. Active runs, their questions and a live timeline show up here.'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => showOrch('new') }, 'Start a run')
    )
  }

  private header(runs: OrchRunDetail[], decisions: OrchDecisionView[]): HTMLElement {
    const counts = runCounts(runs, decisions)
    const stat = (value: number, label: string, tone?: string): HTMLElement =>
      h('span', { class: `runs-stat${tone ? ` ${tone}` : ''}` }, h('strong', {}, String(value)), ` ${label}`)
    return h(
      'div',
      { class: 'runs-header' },
      h(
        'div',
        { class: 'runs-stats', 'aria-label': 'Totals' },
        stat(counts.running, counts.running === 1 ? 'run active' : 'runs active'),
        stat(counts.waiting, counts.waiting === 1 ? 'decision waiting' : 'decisions waiting', counts.waiting > 0 ? 'attention' : undefined),
        stat(counts.agents, counts.agents === 1 ? 'agent working' : 'agents working')
      ),
      h('button', { class: 'btn primary', type: 'button', onClick: () => showOrch('new') }, 'New run')
    )
  }

  private card(run: OrchRunDetail, decision: OrchDecisionView | undefined, projects: Map<string, string>): HTMLElement {
    const activity = activitySummary(run, (role) => ROLE_LABEL[role])
    const percent = run.taskCount > 0 ? Math.round((run.tasksDone / run.taskCount) * 100) : 0
    const project = (run.projectId && projects.get(run.projectId)) || 'Unknown project'
    return h(
      'article',
      { class: 'orch-panel run-card', 'aria-label': run.title },
      h(
        'div',
        { class: 'run-card-top' },
        h('h3', { class: 'run-card-title', title: run.title }, run.title),
        pill(activity.tone === 'idle' ? 'idle' : activity.tone === 'waiting' ? 'needs you' : activity.tone, activity.tone)
      ),
      h('div', { class: 'run-card-meta orch-muted' }, `${project} · ${KIND_LABEL[run.kind]} · ${run.plan} · ${elapsed(run.createdAt)}`),
      this.stages(run),
      h(
        'div',
        { class: 'run-progress' },
        h('div', { class: 'run-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(run.taskCount), 'aria-valuenow': String(run.tasksDone), 'aria-label': 'Tasks done' }, h('span', { style: `width:${percent}%` })),
        h('span', { class: 'orch-muted' }, run.taskCount > 0 ? `${run.tasksDone}/${run.taskCount} tasks` : 'No tasks yet')
      ),
      h('div', { class: `run-activity tone-${activity.tone}` }, activity.text),
      decision ? this.quickReply(decision, run) : null,
      h(
        'div',
        { class: 'run-card-actions' },
        h('button', { class: 'btn small', type: 'button', onClick: () => showOrch('runs', run.id) }, 'Open')
      )
    )
  }

  private stages(run: OrchRunDetail): HTMLElement {
    const stages = stagesOf(run)
    const current = currentStageIndex(run)
    return h(
      'ol',
      { class: 'run-stages', 'aria-label': 'Progress' },
      ...stages.map((stage, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'next'
        return h('li', { class: `run-stage ${state}`, 'aria-current': state === 'current' ? 'step' : undefined }, stage.label)
      })
    )
  }

  private quickReply(decision: OrchDecisionView, run: OrchRunDetail): HTMLElement {
    const send = (answer: string): void => {
      const text = answer.trim()
      if (!text) return
      this.drafts.delete(decision.id)
      void answerDecision(decision.id, text)
    }
    const input = h('input', {
      class: 'text-input run-reply-input',
      type: 'text',
      placeholder: 'Quick reply…',
      'aria-label': `Reply to: ${decision.question}`,
      'data-decision': decision.id
    })
    input.value = this.drafts.get(decision.id) ?? ''
    input.addEventListener('input', () => {
      if (input.value) this.drafts.set(decision.id, input.value)
      else this.drafts.delete(decision.id)
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') send(input.value)
    })
    const options = decision.options.slice(0, QUICK_OPTION_LIMIT)
    return h(
      'div',
      { class: 'run-decision' },
      h(
        'div',
        { class: 'run-decision-head' },
        h('span', { class: 'run-decision-kind' }, decisionKindLabel(decision.kind)),
        decision.agentModel && decision.agentRole ? modelBadge(run.agents.find((a) => a.role === decision.agentRole && a.model === decision.agentModel)?.runner ?? 'claude', decision.agentModel, ROLE_LABEL[decision.agentRole]) : null,
        h('span', { class: 'orch-muted' }, timeAgo(decision.createdAt))
      ),
      h('p', { class: 'run-decision-q' }, decision.question),
      options.length > 0
        ? h('div', { class: 'run-options' }, ...options.map((option) => h('button', { class: 'btn small ghost', type: 'button', onClick: () => send(option) }, option)))
        : null,
      h('div', { class: 'run-reply' }, input, h('button', { class: 'btn small primary', type: 'button', onClick: () => send(input.value) }, 'Reply'))
    )
  }

  private timeline(runs: OrchRunDetail[]): HTMLElement {
    const events = liveTimeline(runs)
    return h(
      'section',
      { class: 'orch-panel', 'aria-label': 'Live across all runs' },
      h('h3', { class: 'orch-panel-title' }, 'Live across all runs'),
      events.length === 0
        ? h('p', { class: 'orch-muted runs-pad' }, 'Nothing has happened yet.')
        : h(
            'ul',
            { class: 'runs-timeline' },
            ...events.map((event) =>
              h(
                'li',
                {},
                h('time', { class: 'orch-muted orch-mono', title: new Date(event.at).toLocaleString() }, new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
                h('span', { class: 'runs-tag', title: event.runTitle }, runTag(event.runTitle)),
                h('span', { class: 'runs-event-text' }, event.text)
              )
            )
          )
    )
  }

  private finished(runs: OrchRunDetail[]): HTMLElement {
    const details = h(
      'details',
      { class: 'orch-panel runs-finished' },
      h('summary', { class: 'orch-panel-title' }, `Finished runs (${runs.length})`),
      h(
        'ul',
        { class: 'runs-finished-list' },
        ...runs.map((run) =>
          h(
            'li',
            {},
            h('span', { class: 'runs-finished-title', title: run.title }, run.title),
            pill(run.stage === 'done' ? 'done' : 'cancelled', run.stage === 'done' ? 'done' : 'idle'),
            h('button', { class: 'btn small ghost', type: 'button', onClick: () => showOrch('runs', run.id) }, 'Open')
          )
        )
      )
    )
    details.open = this.finishedOpen
    details.addEventListener('toggle', () => {
      this.finishedOpen = details.open
    })
    return details
  }
}

function runKey(run: OrchRunDetail): unknown[] {
  return [
    run.id,
    run.title,
    run.stage,
    run.kind,
    run.plan,
    run.projectId,
    run.taskCount,
    run.tasksDone,
    run.agents.map((a) => [a.id, a.state, a.taskKey, a.retired]),
    run.events.length,
    run.events[run.events.length - 1]?.at ?? 0
  ]
}
