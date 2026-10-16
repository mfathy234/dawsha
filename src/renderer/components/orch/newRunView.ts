import { selectMenu } from '../selectMenu'
import type { RunKind } from '../../../shared/orch/types'
import { defaultRunProject } from '../../../shared/orch/board'
import { bugFixerFor, fixerProfileOf, type OrchPlan, type OrchProfile, type OrchRunner, type OrchSettings } from '../../../shared/orch/profiles'
import { openSettings } from '../../actions'
import { h } from '../../dom'
import { startRun } from '../../orchActions'
import type { AppState } from '../../state'
import './newRunView.css'

interface Draft {
  kind: RunKind
  projectId: string | null
  planId: string | null
  leadId: string | null
  solo: boolean
  fixerId: string | null
  title: string
  story: string
  submitting: boolean
  error: string | null
}

const TITLE_MAX = 120

const KIND_OPTIONS: { kind: RunKind; name: string; hint: string }[] = [
  { kind: 'feature', name: 'Feature', hint: 'The lead reads it and starts only the agents the work needs.' },
  { kind: 'bug', name: 'Bug', hint: 'One agent, Claude or Codex, fixes it. No subagents, no spec.' }
]

const FIXER_OPTIONS: { runner: OrchRunner; name: string }[] = [
  { runner: 'claude', name: 'Claude' },
  { runner: 'codex', name: 'Codex' }
]

const profileLabel = (p: OrchProfile): string =>
  `${p.name} · ${p.local ? 'codex (local)' : p.runner}${p.model ? ` ${p.model}` : ''}${p.effort ? ` · effort ${p.effort}` : ''}`

function field(label: string, id: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'orch-nr-field' }, h('label', { class: 'orch-nr-label', for: id }, label), control, hint ? h('p', { class: 'orch-nr-hint' }, hint) : null)
}

/** Arrow keys move between the radios of a group, like native radio buttons. */
function radioKeys(event: KeyboardEvent): void {
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
  if (!forward && !back) return
  const group = event.currentTarget as HTMLElement
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const index = radios.findIndex((r) => r === document.activeElement)
  if (index < 0) return
  event.preventDefault()
  const next = radios[(index + (forward ? 1 : -1) + radios.length) % radios.length]
  next.focus()
  next.click()
}

export class OrchNewRunView {
  readonly el = h('section', { class: 'orch-section orch-nr' })
  private draft: Draft = { kind: 'feature', projectId: null, planId: null, fixerId: null, leadId: null, solo: false, title: '', story: '', submitting: false, error: null }
  private signature = ''
  private state: AppState | null = null

  update(state: AppState): void {
    this.state = state
    const signature = JSON.stringify([
      state.settings.projects,
      state.settings.orchestrator,
      state.focusedId,
      state.panes.find((p) => p.id === state.focusedId)?.projectId ?? null,
      this.draft.kind,
      this.draft.projectId,
      this.draft.planId,
      this.draft.fixerId,
      this.draft.leadId,
      this.draft.solo,
      this.draft.submitting,
      this.draft.error
    ])
    if (signature === this.signature) return
    this.signature = signature
    this.render(state)
  }

  private change(patch: Partial<Draft>): void {
    this.draft = { ...this.draft, ...patch }
    if (this.state) this.update(this.state)
  }

  private projectId(state: AppState): string | null {
    const { projects } = state.settings
    if (this.draft.projectId && projects.some((p) => p.id === this.draft.projectId)) return this.draft.projectId
    const focused = state.panes.find((p) => p.id === state.focusedId)?.projectId ?? null
    return defaultRunProject(projects, state.orch?.runs ?? [], state.orchRunId, focused)
  }

  private plan(settings: OrchSettings): OrchPlan | undefined {
    const wanted = this.draft.planId ?? settings.defaultPlanId
    return settings.plans.find((p) => p.id === wanted) ?? settings.plans.find((p) => p.id === settings.defaultPlanId) ?? settings.plans[0]
  }

  private render(state: AppState): void {
    const activeId = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement) ? document.activeElement.id : ''
    const settings = state.settings.orchestrator
    const plan = this.plan(settings)
    const bug = this.draft.kind === 'bug'
    this.el.replaceChildren(
      h(
        'div',
        { class: 'orch-panel orch-nr-form' },
        h('h2', { class: 'orch-nr-title' }, 'New run'),
        this.projectField(state),
        this.kindField(),
        bug ? this.fixerField(settings, plan) : null,
        this.storyField(),
        this.titleField(),
        !bug && plan ? this.planField(settings, plan) : null,
        !bug && plan ? this.leadField(settings, plan) : null,
        !bug ? this.teamField() : null,
        !bug && plan ? this.limits(plan) : null,
        this.footer(state, plan)
      )
    )
    if (activeId) document.getElementById(activeId)?.focus()
  }

  private projectField(state: AppState): HTMLElement {
    const { projects } = state.settings
    const current = this.projectId(state)
    const select = h('select', { class: 'text-input', id: 'orch-nr-project', disabled: projects.length === 0 || this.draft.submitting })
    if (projects.length === 0) select.append(h('option', { value: '' }, 'No projects yet'))
    for (const p of projects) select.append(h('option', { value: p.id, selected: p.id === current }, p.name))
    select.addEventListener('change', () => this.change({ projectId: select.value }))
    return field('Project', 'orch-nr-project', selectMenu(select), 'The run works in its own branch and worktrees, so your checkout stays untouched.')
  }

  private kindField(): HTMLElement {
    const group = h('div', { class: 'orch-nr-cards', role: 'radiogroup', 'aria-label': 'Run type', id: 'orch-nr-kind' })
    for (const option of KIND_OPTIONS) {
      const selected = this.draft.kind === option.kind
      group.append(
        h(
          'button',
          {
            class: `orch-nr-card${selected ? ' selected' : ''}`,
            type: 'button',
            role: 'radio',
            id: `orch-nr-kind-${option.kind}`,
            'aria-checked': String(selected),
            tabindex: selected ? 0 : -1,
            disabled: this.draft.submitting,
            onClick: () => this.change({ kind: option.kind, error: null })
          },
          h('b', {}, option.name),
          h('small', {}, option.hint)
        )
      )
    }
    group.addEventListener('keydown', radioKeys)
    return h('div', { class: 'orch-nr-field' }, h('span', { class: 'orch-nr-label', id: 'orch-nr-kind-label' }, 'Type'), group)
  }

  /** A bug has one agent, so the only choice is which CLI; the profile follows from the plan. */
  private fixerField(settings: OrchSettings, plan: OrchPlan | undefined): HTMLElement {
    const chosen = settings.profiles.find((p) => p.id === this.draft.fixerId) ?? (plan ? fixerProfileOf(settings, plan) : undefined)
    const group = h('div', { class: 'orch-nr-cards', role: 'radiogroup', 'aria-labelledby': 'orch-nr-fixer-label', id: 'orch-nr-fixer' })
    for (const option of FIXER_OPTIONS) {
      const profile = plan ? bugFixerFor(settings, plan, option.runner) : undefined
      const selected = chosen?.runner === option.runner
      group.append(h(
        'button',
        {
          class: `orch-nr-card${selected ? ' selected' : ''}`,
          type: 'button',
          role: 'radio',
          id: `orch-nr-fixer-${option.runner}`,
          'aria-checked': String(selected),
          tabindex: selected ? 0 : -1,
          disabled: this.draft.submitting || !profile,
          onClick: () => profile && this.change({ fixerId: profile.id })
        },
        h('b', {}, option.name),
        h('small', { class: 'orch-nr-est' }, profile ? `${profile.model || 'default model'}${profile.effort ? ` · effort ${profile.effort}` : ''}` : 'Add a profile for it in Settings')
      ))
    }
    group.addEventListener('keydown', radioKeys)
    return h('div', { class: 'orch-nr-field' }, h('span', { class: 'orch-nr-label', id: 'orch-nr-fixer-label' }, 'Fixed by'), group)
  }

  private storyField(): HTMLElement {
    const bug = this.draft.kind === 'bug'
    const area = h('textarea', {
      class: 'text-input orch-nr-story',
      id: 'orch-nr-story',
      rows: 7,
      placeholder: bug
        ? 'What goes wrong, the steps to reproduce it, and what you expected to happen.'
        : 'As a …, I want …, so that …',
      disabled: this.draft.submitting
    })
    area.value = this.draft.story
    area.addEventListener('input', () => { this.draft = { ...this.draft, story: area.value } })
    return field(bug ? 'Bug report' : 'User story', 'orch-nr-story', area, bug ? 'Paste an error, a stack trace or a ticket if you have one.' : 'Paste any story or ticket. For larger or unclear work the lead asks for a spec you approve first.')
  }

  private titleField(): HTMLElement {
    const input = h('input', { class: 'text-input', id: 'orch-nr-title', type: 'text', maxlength: TITLE_MAX, placeholder: 'Optional, taken from the text when empty', disabled: this.draft.submitting })
    input.value = this.draft.title
    input.addEventListener('input', () => { this.draft = { ...this.draft, title: input.value } })
    return field('Title', 'orch-nr-title', input)
  }

  private planField(settings: OrchSettings, plan: OrchPlan): HTMLElement {
    const group = h('div', { class: 'orch-nr-cards', role: 'radiogroup', 'aria-label': 'Plan', id: 'orch-nr-plans' })
    for (const p of settings.plans) {
      const selected = p.id === plan.id
      const lead = settings.profiles.find((profile) => profile.id === p.roles.lead)
      group.append(
        h(
          'button',
          {
            class: `orch-nr-card${selected ? ' selected' : ''}`,
            type: 'button',
            role: 'radio',
            id: `orch-nr-plan-${p.id}`,
            'aria-checked': String(selected),
            tabindex: selected ? 0 : -1,
            disabled: this.draft.submitting,
            onClick: () => this.change({ planId: p.id })
          },
          h('b', {}, p.name, p.id === settings.defaultPlanId ? h('span', { class: 'orch-nr-default' }, 'default') : null),
          h('small', { class: 'orch-nr-est' }, `Lead: ${lead?.model || 'default'} · team picked by the lead`)
        )
      )
    }
    group.addEventListener('keydown', radioKeys)
    const link = h(
      'button',
      { class: 'orch-nr-link', type: 'button', id: 'orch-nr-open-plans', onClick: () => openSettings('orchestrator') },
      'Open plans'
    )
    return h(
      'div',
      { class: 'orch-nr-field' },
      h('span', { class: 'orch-nr-label' }, 'Plan'),
      group,
      h('p', { class: 'orch-nr-hint' }, 'Plans are edited in Settings → Orchestrator. ', link)
    )
  }

  private leadField(settings: OrchSettings, plan: OrchPlan): HTMLElement {
    const main = settings.profiles.find((p) => p.id === plan.roles.lead)
    const select = h('select', { class: 'text-input', id: 'orch-nr-lead', disabled: this.draft.submitting },
      h('option', { value: '' }, main ? `Plan lead (${profileLabel(main)})` : 'Plan lead'),
      ...settings.profiles.filter((p) => p.role === 'lead' || p.runner === 'claude' || p.runner === 'codex')
        .map((p) => h('option', { value: p.id }, profileLabel(p))))
    select.value = this.draft.leadId ?? ''
    select.addEventListener('change', () => this.change({ leadId: select.value || null }))
    return field('Lead model', select.id, selectMenu(select), 'Applies to this run only.')
  }

  private teamField(): HTMLElement {
    const select = h('select', { class: 'text-input', id: 'orch-nr-team', disabled: this.draft.submitting },
      h('option', { value: 'auto' }, 'Let the lead decide'), h('option', { value: 'solo' }, 'Lead works alone'))
    select.value = this.draft.solo ? 'solo' : 'auto'
    select.addEventListener('change', () => this.change({ solo: select.value === 'solo' }))
    return field('Team', select.id, selectMenu(select))
  }

  private limits(plan: OrchPlan): HTMLElement {
    const tile = (label: string, value: string): HTMLElement => h('div', { class: 'orch-nr-tile' }, h('span', { class: 'orch-muted' }, label), h('b', {}, value))
    return h(
      'div',
      { class: 'orch-nr-field' },
      h('span', { class: 'orch-nr-label' }, 'Limits for this run'),
      h(
        'div',
        { class: 'orch-nr-tiles' },
        tile('Workers at once', String(plan.maxWorkers)),
        tile('Per task', `${plan.taskMinutes} min`),
        tile('Spec approval', plan.specApproval ? 'You approve first' : 'No stop')
      )
    )
  }

  private footer(state: AppState, plan: OrchPlan | undefined): HTMLElement {
    const bug = this.draft.kind === 'bug'
    const label = this.draft.submitting ? 'Starting…' : bug ? 'Start fix' : 'Start spec'
    const button = h('button', { class: 'btn primary', type: 'button', id: 'orch-nr-start', disabled: this.draft.submitting, onClick: () => void this.submit(state, plan) }, label)
    const note = bug
      ? 'The fixer works on its own branch. Nothing merges until you review it.'
      : this.plan(state.settings.orchestrator)?.specApproval === false
        ? 'The run builds straight after the spec.'
        : 'Nothing is built until you approve the spec.'
    return h(
      'div',
      { class: 'orch-nr-footer' },
      h('div', { class: 'orch-nr-message' }, h('span', { class: 'orch-muted' }, note), this.draft.error ? h('p', { class: 'orch-nr-error', role: 'alert' }, this.draft.error) : null),
      button
    )
  }

  private async submit(state: AppState, plan: OrchPlan | undefined): Promise<void> {
    const projectId = this.projectId(state)
    const story = this.draft.story.trim()
    if (!projectId) return this.change({ error: 'Add a project in Dawsha first, then start a run.' })
    if (!story) return this.change({ error: this.draft.kind === 'bug' ? 'Describe the bug first.' : 'Write the user story first.' })
    if (!plan) return this.change({ error: 'There is no plan to run. Check Settings → Orchestrator.' })
    this.change({ error: null, submitting: true })
    let started = false
    try {
      started = await startRun({
        kind: this.draft.kind,
        projectId,
        title: this.draft.title.trim(),
        story,
        planId: plan.id,
        leadProfileId: this.draft.kind === 'feature' ? this.draft.leadId : null,
        solo: this.draft.kind === 'feature' && this.draft.solo,
        fixerProfileId: this.draft.kind === 'bug' ? this.draft.fixerId : null
      })
    } finally {
      this.change(started ? { submitting: false, story: '', title: '' } : { submitting: false })
    }
  }
}
