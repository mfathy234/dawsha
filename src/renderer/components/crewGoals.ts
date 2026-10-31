import { initialsOf, modelLabel, RUN_CHOICE_LABELS, type CrewMember, type CrewRun, type RunChoice } from '../../shared/crew'
import {
  buildLanes,
  formatBudget,
  formatEstimate,
  goalSpent,
  openQuestion,
  type CrewGoal,
  type GoalLive,
  type Lane
} from '../../shared/crewLead'
import { AVATAR_LABELS, formatCost, formatSpan, type AvatarState } from '../../shared/crewLive'
import { formatAge } from '../../shared/statusLine'
import { focusPane } from '../actions'
import { memberById } from '../crewActions'
import { answerFor, decidePlanFor, goalActive, leadMember, runsOfGoal, startGoal } from '../crewLead'
import { acknowledgeRun, paneOfRun, stateOfPane } from '../crewLive'
import { clear, h } from '../dom'
import { store, type AppState } from '../state'
import { confirmDialog } from './dialogs'
import { crewAvatar } from './crewAvatar'
import { selectMenu, syncSelectMenu } from './selectMenu'

const MODEL_CHOICES: RunChoice[] = ['default', 'fable', 'sonnet', 'codex']

const leadChoiceLabel = (choice: RunChoice, lead: CrewMember): string =>
  choice === 'default' ? `Lead on Claude · ${modelLabel(lead.runner, lead.model)}` : `Lead on ${RUN_CHOICE_LABELS[choice]}`

const firstLine = (text: string, max = 80): string => {
  const line = text.trim().split(/\r?\n/)[0]
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function identityOfName(name: string, colour: CrewMember['colour'] = 'blue') {
  return { name, initials: initialsOf(name), colour }
}

function laneState(state: AppState, run: CrewRun | null): { avatar: AvatarState; word: string } {
  if (!run) return { avatar: 'idle', word: 'Waiting' }
  const pane = paneOfRun(run.id)
  if (pane) {
    const live = stateOfPane(state, pane)
    return { avatar: live, word: AVATAR_LABELS[live] }
  }
  if (run.outcome === 'done') return { avatar: 'done', word: 'Done' }
  if (run.outcome === 'failed') return { avatar: 'failed', word: 'Failed' }
  return { avatar: 'idle', word: 'Closed' }
}

function laneLine(state: AppState, lane: Lane, word: string): string {
  const { run, step } = lane
  if (!run) return step ? `Starts when Maya runs it · ${formatEstimate(step.estimate)}` : ''
  const model = `${run.runner === 'claude' ? 'Claude' : run.runner === 'codex' ? 'Codex' : 'Gemini'} · ${modelLabel(run.runner, run.model)}`
  const span = formatSpan((run.endedAt ?? state.now) - run.startedAt)
  const cost = formatCost(run.costUsd)
  if (word === 'Needs you') return 'Waiting on you. Open its pane to answer.'
  if (word === 'Done') return `Finished in ${span}${cost ? ` · ${cost}` : ''}`
  if (word === 'Failed') return `Stopped after ${span}`
  if (word === 'Closed') return 'Its pane was closed'
  return `${model} · ${span}`
}

export class CrewGoalsPage {
  readonly el = h('div', { class: 'crew-goals' })
  private readonly goalText = h('textarea', { class: 'text-input crew-goal-text', rows: '3', 'aria-label': 'Goal for Maya', placeholder: 'What should Maya get done? For example: the login test fails about 1 in 7 CI runs. Find out why, fix it and get it ready for a PR.' })
  private readonly project = h('select', { class: 'text-input crew-goal-project', 'aria-label': 'Project' })
  private readonly model = h('select', { class: 'text-input crew-goal-model', 'aria-label': 'Lead model' })
  private readonly planFirst = h('button', { class: 'toggle', type: 'button', id: 'crew-goal-plan-first', role: 'switch', 'aria-label': 'Show me the plan first', 'aria-checked': 'true', onClick: () => this.planFirst.setAttribute('aria-checked', String(this.planFirst.getAttribute('aria-checked') !== 'true')) })
  private readonly error = h('div', { class: 'crew-goal-error', role: 'alert', hidden: true })
  private readonly go = h('button', { class: 'btn primary', type: 'button', id: 'crew-goal-go', onClick: () => void this.start() }, 'Hand it to Maya')
  private readonly live = h('div', { class: 'crew-goal-live' })
  private readonly recent = h('div', { class: 'crew-goal-recent' })
  private selected: string | null = null
  private changing = false
  private changeNote = ''
  private projectsSig = ''
  private modelSig = ''
  private ruleSeen: boolean | null = null
  private liveSig = ''
  private recentSig = ''

  constructor() {
    const box = h(
      'div',
      { class: 'crew-goalbox' },
      h('div', { class: 'crew-goal-head' }, h('h3', { class: 'crew-goal-title' }, 'Give Maya a goal'), h('span', { class: 'crew-muted' }, 'She plans first. Nothing runs until you approve.')),
      this.goalText,
      h('div', { class: 'crew-goal-row' },
        h('div', { class: 'crew-goal-selects' },
          h('label', { class: 'crew-goal-field' }, h('span', {}, 'Project'), selectMenu(this.project)),
          h('label', { class: 'crew-goal-field' }, h('span', {}, 'Model'), selectMenu(this.model))
        ),
        h('div', { class: 'crew-goal-actions' },
          h('div', { class: 'crew-check' }, this.planFirst, h('span', {}, 'Show me the plan first')),
          this.go
        )
      ),
      this.error
    )
    this.el.append(box, this.live, this.recent)
  }

  update(state: AppState): void {
    this.syncControls(state)
    const goal = this.current(state)
    const live = goal ? state.goalLive[goal.id] : undefined
    const lanesSig = goal ? runsOfGoal(goal.id).map((run) => [run.id, run.outcome, run.costUsd, run.endedAt, state.crewStates[paneOfRun(run.id)?.id ?? ''] ?? '']) : []
    const liveSig = JSON.stringify([goal?.id, goal?.approved, live, lanesSig, goal ? this.mayaState(state, goal) : '', this.changing, Math.floor(state.now / 15_000), state.settings.lead.budgetUsd, state.settings.lead.atOnce])
    if (liveSig !== this.liveSig) {
      this.liveSig = liveSig
      this.renderLive(state, goal, live ?? { plan: null, question: null, notes: [] })
    }
    const recentSig = JSON.stringify([state.settings.crewGoals.map((g) => g.id), state.settings.crewRuns.map((r) => [r.id, r.outcome, r.costUsd]), goal?.id, Math.floor(state.now / 60_000)])
    if (recentSig !== this.recentSig) {
      this.recentSig = recentSig
      this.renderRecent(state, goal)
    }
  }

  private syncControls(state: AppState): void {
    const projects = state.settings.projects
    const projectsSig = JSON.stringify(projects.map((p) => [p.id, p.name]))
    if (projectsSig !== this.projectsSig) {
      this.projectsSig = projectsSig
      const keep = this.project.value
      clear(this.project)
      for (const project of projects) this.project.append(h('option', { value: project.id }, project.name))
      const focused = state.panes.find((pane) => pane.id === state.focusedId)?.projectId
      this.project.value = projects.some((p) => p.id === keep) ? keep : projects.some((p) => p.id === focused) ? focused! : (projects[0]?.id ?? '')
      syncSelectMenu(this.project)
    }
    const lead = leadMember()
    const modelSig = lead ? `${lead.runner}:${lead.model}` : ''
    if (lead && modelSig !== this.modelSig) {
      this.modelSig = modelSig
      const keep = this.model.value
      clear(this.model)
      for (const choice of MODEL_CHOICES) this.model.append(h('option', { value: choice }, leadChoiceLabel(choice, lead)))
      this.model.value = MODEL_CHOICES.includes(keep as RunChoice) ? keep : 'default'
      syncSelectMenu(this.model)
    }
    const rule = state.settings.lead.rules.planFirst
    if (this.ruleSeen !== rule) {
      this.ruleSeen = rule
      this.planFirst.setAttribute('aria-checked', String(rule))
    }
  }

  private current(state: AppState): CrewGoal | null {
    const goals = state.settings.crewGoals
    const picked = goals.find((goal) => goal.id === this.selected)
    if (picked) return picked
    return goals.find((goal) => goalActive(goal)) ?? null
  }

  private mayaState(state: AppState, goal: CrewGoal): AvatarState {
    const pane = paneOfRun(goal.leadRunId)
    return pane ? stateOfPane(state, pane) : 'idle'
  }

  private async start(): Promise<void> {
    this.error.hidden = true
    this.go.disabled = true
    const result = await startGoal({ text: this.goalText.value, projectId: this.project.value, choice: this.model.value as RunChoice, planFirst: this.planFirst.getAttribute('aria-checked') === 'true' })
    this.go.disabled = false
    if (!result.ok) {
      this.error.textContent = result.error
      this.error.hidden = false
      return
    }
    this.selected = result.goalId
    this.goalText.value = ''
    this.liveSig = ''
    this.update(store.state)
  }

  private renderLive(state: AppState, goal: CrewGoal | null, live: GoalLive): void {
    clear(this.live)
    if (!goal) return
    const maya = leadMember()
    if (live.plan) this.live.append(this.planCard(goal, live))
    this.live.append(this.board(state, goal, live))
    if (maya) this.live.append(this.notes(state, goal, live, maya))
  }

  private planCard(goal: CrewGoal, live: GoalLive): HTMLElement {
    const plan = live.plan!
    const lead = store.state.settings.lead
    const jobs = plan.steps.length
    const rows = plan.steps.map((step, index) => {
      const member = memberById(step.memberId)
      const fields = Object.entries(step.fields)
        .map(([key, value]) => `${key}: ${firstLine(value, 60)}`)
        .join(' · ')
      return h(
        'div',
        { class: 'crew-step', 'data-step': String(index + 1) },
        h('span', { class: 'crew-step-n' }, String(index + 1)),
        crewAvatar(member ?? identityOfName(step.memberName), 'idle', 28),
        h('span', { class: 'crew-step-job' }, h('b', {}, step.memberName), h('span', { class: 'crew-muted' }, ` · ${step.job}`)),
        h('span', { class: 'crew-step-model' }, `${step.runner === 'claude' ? 'Claude' : step.runner === 'codex' ? 'Codex' : 'Gemini'} · ${modelLabel(step.runner, step.model)} · ${formatEstimate(step.estimate)}`),
        fields ? h('small', { class: 'crew-muted' }, fields) : null
      )
    })
    const foot: Node[] = [h('span', { class: 'crew-muted crew-plan-total' }, `Estimated ${formatEstimate(plan.estimate)} of ${formatBudget(lead.budgetUsd)} · at most ${lead.atOnce} at once · asks before any push or PR`), h('span', { class: 'crew-spacer' })]
    const status = h('div', { class: 'crew-plan-status', 'data-plan-status': plan.status })
    if (plan.status === 'waiting') {
      foot.push(
        h('button', { class: 'btn', type: 'button', id: 'crew-plan-cancel', onClick: () => void this.cancelPlan(goal) }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', id: 'crew-plan-change', onClick: () => { this.changing = !this.changing; this.liveSig = ''; this.update(store.state) } }, 'Change the plan…'),
        h('button', { class: 'btn primary', type: 'button', id: 'crew-plan-approve', onClick: () => { this.changing = false; decidePlanFor(goal.id, { kind: 'approved' }) } }, 'Approve and start')
      )
    } else {
      status.textContent =
        plan.status === 'approved' ? 'Approved' : plan.status === 'cancelled' ? 'Cancelled' : `Changes sent to Maya${plan.note ? `: ${plan.note}` : ''}`
    }
    const change = this.changing && plan.status === 'waiting' ? this.changeBox(goal) : null
    return h(
      'section',
      { class: 'crew-plan', 'aria-label': 'Plan' },
      h('h3', {}, `Maya's plan · ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`),
      plan.summary ? h('p', { class: 'crew-plan-summary' }, plan.summary) : null,
      ...rows,
      plan.status === 'waiting' ? null : status,
      change,
      h('div', { class: 'crew-plan-foot' }, ...foot)
    )
  }

  private async cancelPlan(goal: CrewGoal): Promise<void> {
    const name = firstLine(goal.text, 70)
    const confirmed = await confirmDialog({
      title: 'Cancel this plan?',
      body: `Maya stops "${name}" and no member starts. The plan is discarded.`,
      confirmLabel: `Cancel plan for "${name}"`,
      cancelLabel: 'Keep the plan'
    })
    if (confirmed) decidePlanFor(goal.id, { kind: 'cancelled' })
  }

  private changeBox(goal: CrewGoal): HTMLElement {
    const note = h('textarea', { class: 'text-input crew-area', rows: '3', 'aria-label': 'What should change in the plan', placeholder: 'Tell Maya what to change, for example: skip the review, use Sonnet for the fix.' })
    note.value = this.changeNote
    note.addEventListener('input', () => (this.changeNote = note.value))
    const send = h('button', { class: 'btn primary', type: 'button', id: 'crew-plan-send', onClick: () => {
      this.changing = false
      const text = note.value
      this.changeNote = ''
      decidePlanFor(goal.id, { kind: 'changed', note: text })
    } }, 'Send to Maya')
    return h('div', { class: 'crew-plan-change' }, note, h('div', { class: 'crew-goal-row' }, h('span', { class: 'crew-spacer' }), send))
  }

  private board(state: AppState, goal: CrewGoal, live: GoalLive): HTMLElement {
    const runs = runsOfGoal(goal.id)
    const lanes = buildLanes(live.plan?.steps ?? [], runs)
    const wrap = h('section', { class: 'crew-board', 'aria-label': 'Board' }, h('h3', {}, `Goal · ${firstLine(goal.text, 70)} · ${goal.projectName}`))
    if (lanes.length === 0) wrap.append(h('p', { class: 'crew-muted crew-board-empty' }, live.plan ? 'No jobs yet.' : 'No jobs yet. They appear here as Maya starts them.'))
    for (const lane of lanes) wrap.append(this.lane(state, lane))
    return wrap
  }

  private lane(state: AppState, lane: Lane): HTMLElement {
    const { run, step } = lane
    const name = step?.memberName ?? run?.memberName ?? 'Member'
    const member = memberById(step?.memberId ?? run?.memberId ?? '')
    const { avatar, word } = laneState(state, run)
    const job = step?.job ?? run?.title ?? ''
    const element = h(
      'button',
      { class: 'crew-lane', type: 'button', 'data-lane': String(lane.index + 1), 'data-state': avatar, title: run && paneOfRun(run.id) ? 'Go to its pane' : '' },
      crewAvatar(member ?? identityOfName(name), avatar, 30),
      h('span', { class: 'crew-lane-job' }, h('b', {}, name), h('span', { class: 'crew-muted' }, ` · ${job}`)),
      h('span', { class: `crew-lane-word state-${avatar === 'needs' ? 'needs' : avatar === 'working' ? 'working' : avatar === 'done' ? 'done' : avatar === 'failed' ? 'failed' : 'idle'}` }, word),
      h('small', { class: 'crew-muted crew-lane-line' }, laneLine(state, lane, word))
    )
    element.addEventListener('click', () => {
      const pane = run ? paneOfRun(run.id) : undefined
      if (!run || !pane) return
      acknowledgeRun(run.id, pane.id)
      focusPane(pane.id)
    })
    return element
  }

  private notes(state: AppState, goal: CrewGoal, live: GoalLive, maya: CrewMember): HTMLElement {
    const mayaState = this.mayaState(state, goal)
    const question = openQuestion(live)
    const lines = live.notes.slice(-6).map((note) => h('p', { class: 'crew-note-line' }, h('b', {}, `${maya.name}: `), note.text))
    const answered = live.question && live.question.answer !== null ? h('p', { class: 'crew-muted crew-answered' }, `${live.question.text} You answered: ${live.question.answer}`) : null
    const ask = question
      ? h(
          'div',
          { class: 'crew-question', 'data-question': question.id },
          h('p', { class: 'crew-question-text' }, h('b', {}, `${maya.name}: `), question.text),
          h(
            'div',
            { class: 'crew-question-acts' },
            ...question.options.map((option, index) =>
              h('button', { class: `btn${index === 0 ? ' primary' : ''}`, type: 'button', 'data-option': option, onClick: () => answerFor(goal.id, option) }, option)
            )
          )
        )
      : null
    return h(
      'section',
      { class: 'crew-lead-notes', 'aria-label': `${maya.name}'s notes` },
      h('div', { class: 'crew-lead-head' }, crewAvatar(maya, mayaState, 30), h('span', {}, h('b', {}, maya.name), h('span', { class: 'crew-muted' }, ` · ${AVATAR_LABELS[mayaState]} · spent ${formatCost(goalSpent(store.state.settings.crewRuns, goal.id)) || '$0.00'}`))),
      h('div', { class: 'crew-lead-body' }, ...lines, answered, ask)
    )
  }

  private renderRecent(state: AppState, current: CrewGoal | null): void {
    clear(this.recent)
    const goals = state.settings.crewGoals
    if (goals.length === 0) return
    this.recent.append(h('h3', {}, 'Recent goals'))
    for (const goal of goals) {
      const lead = state.settings.crewRuns.find((run) => run.id === goal.leadRunId)
      const runs = runsOfGoal(goal.id).filter((run) => !run.lead)
      const active = goalActive(goal)
      const word = active ? 'Running' : lead?.outcome === 'failed' ? 'Failed' : lead?.outcome === 'done' ? 'Done' : 'Closed'
      const cost = goalSpent(state.settings.crewRuns, goal.id)
      const row = h(
        'button',
        { class: `crew-goal-row-item${current?.id === goal.id ? ' sel' : ''}`, type: 'button', 'data-goal': goal.id },
        h('span', { class: `crew-outcome out-${active ? 'running' : (lead?.outcome ?? 'closed')}` }, word),
        h('span', { class: 'crew-run-title' }, firstLine(goal.text, 90)),
        h('span', { class: 'crew-run-cell' }, `${runs.length} ${runs.length === 1 ? 'member' : 'members'}`),
        h('span', { class: 'crew-run-cell' }, `${formatAge(Math.max(0, state.now - goal.startedAt))} ago`),
        h('span', { class: 'crew-run-cell' }, cost > 0 ? formatCost(cost) : '')
      )
      row.addEventListener('click', () => {
        this.selected = goal.id
        this.liveSig = ''
        this.recentSig = ''
        this.update(store.state)
      })
      this.recent.append(row)
    }
  }
}
