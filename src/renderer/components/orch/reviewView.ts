import { selectMenu } from '../selectMenu'
import type { OrchDecisionView, OrchRunDetail } from '../../../shared/orch/api'
import type { OrchProfile } from '../../../shared/orch/profiles'
import { OTHER_OPTION, composeAnswer, decisionKindLabel, filterDecisions, pickSelection, runFilterChips } from '../../../shared/orch/review'
import { clear, h } from '../../dom'
import { answerDecision, handoffTask, showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { ROLE_LABEL, modelBadge, pill, timeAgo } from './orchUi'
import './reviewView.css'

const KIND_TONE: Record<OrchDecisionView['kind'], string> = {
  question: 'waiting',
  'spec-approval': 'waiting',
  escalation: 'stalled',
  stall: 'stalled',
  'merge-conflict': 'stalled',
  'run-complete': 'done'
}

const profileLabel = (p: OrchProfile): string => `${p.name} · ${p.runner}${p.model ? ` ${p.model}` : ''}${p.effort ? ` · ${p.effort}` : ''}`

interface Draft {
  option: string | null
  note: string
  profileId: string | null
  handoffNote: string
}

/** Human review: every open decision across runs, with a card to answer the selected one. */
export class OrchReviewView {
  readonly el = h('section', { class: 'orch-section orch-review' })
  private readonly chips = h('div', { class: 'review-chips', role: 'group', 'aria-label': 'Filter by run' })
  private readonly list = h('ul', { class: 'review-list', 'aria-label': 'Open decisions' })
  private readonly card = h('div', { class: 'review-card-wrap' })
  private readonly drafts = new Map<string, Draft>()
  private filter: string | null = null
  private selectedId: string | null = null
  private previousIds: string[] = []
  private listSignature = ''
  private cardSignature = ''
  private runs: OrchRunDetail[] = []
  private profiles: OrchProfile[] = []
  private built = false

  update(state: AppState): void {
    this.build()
    this.lastState = state
    const all = state.orch?.decisions ?? []
    this.runs = state.orch?.runs ?? []
    this.profiles = state.settings.orchestrator.profiles
    if (this.filter && !all.some((d) => d.runId === this.filter)) this.filter = null
    const shown = filterDecisions(all, this.filter)
    const ids = shown.map((d) => d.id)
    const selected = pickSelection(ids, this.selectedId, this.previousIds)
    this.selectedId = selected
    this.previousIds = ids
    for (const id of [...this.drafts.keys()]) if (!all.some((d) => d.id === id)) this.drafts.delete(id)
    const decision = shown.find((d) => d.id === selected) ?? null

    const listSignature = JSON.stringify([runFilterChips(all), this.filter, selected, shown.map((d) => [d.id, d.kind, d.question, d.taskKey, d.createdAt])])
    if (listSignature !== this.listSignature) {
      this.listSignature = listSignature
      this.renderChips(all)
      this.renderList(shown)
    }
    const profileSig = this.profiles.map((p) => profileLabel(p) + p.id)
    const cardSignature = JSON.stringify([decision, profileSig])
    if (cardSignature !== this.cardSignature) {
      this.cardSignature = cardSignature
      this.renderCard(decision)
    }
    this.el.classList.toggle('is-empty', all.length === 0)
  }

  private build(): void {
    if (this.built) return
    this.built = true
    this.el.append(
      this.chips,
      h('div', { class: 'review-layout' }, h('nav', { class: 'orch-panel review-side', 'aria-label': 'Decisions waiting' }, h('h3', { class: 'orch-panel-title' }, 'Waiting for you'), this.list), this.card)
    )
  }

  private renderChips(all: OrchDecisionView[]): void {
    clear(this.chips)
    const make = (label: string, runId: string | null, count: number): HTMLElement =>
      h(
        'button',
        { class: 'review-chip', type: 'button', 'aria-pressed': String(this.filter === runId), onClick: () => this.setFilter(runId) },
        label,
        h('span', { class: 'review-chip-count' }, String(count))
      )
    this.chips.append(make('All runs', null, all.length), ...runFilterChips(all).map((chip) => make(chip.title, chip.runId, chip.count)))
  }

  private setFilter(runId: string | null): void {
    this.filter = runId
    this.refresh()
  }

  private refresh(): void {
    if (!this.lastState) return
    this.update(this.lastState)
  }

  private lastState: AppState | null = null

  private renderList(shown: OrchDecisionView[]): void {
    clear(this.list)
    for (const d of shown) {
      const selected = d.id === this.selectedId
      this.list.append(
        h(
          'li',
          {},
          h(
            'button',
            { class: 'review-item', type: 'button', 'aria-current': selected ? 'true' : undefined, onClick: () => this.pick(d.id) },
            h('span', { class: 'review-item-top' }, h('span', { class: `review-kind kind-${d.kind}` }, decisionKindLabel(d.kind)), d.taskKey ? h('span', { class: 'orch-mono orch-muted' }, d.taskKey) : null, h('span', { class: 'orch-muted review-ago' }, timeAgo(d.createdAt))),
            h('span', { class: 'review-item-q' }, d.question),
            h(
              'span',
              { class: 'review-item-meta' },
              d.agentRole && d.agentModel ? modelBadge(this.runnerOf(d), d.agentModel, ROLE_LABEL[d.agentRole]) : null,
              h('span', { class: 'orch-muted review-run' }, d.runTitle)
            )
          )
        )
      )
    }
  }

  private pick(id: string): void {
    this.selectedId = id
    this.refresh()
  }

  private runnerOf(d: OrchDecisionView): string {
    const run = this.runs.find((r) => r.id === d.runId)
    return run?.agents.find((a) => a.role === d.agentRole && a.model === d.agentModel)?.runner ?? 'claude'
  }

  private draftOf(id: string): Draft {
    const existing = this.drafts.get(id)
    if (existing) return existing
    const draft: Draft = { option: null, note: '', profileId: null, handoffNote: '' }
    this.drafts.set(id, draft)
    return draft
  }

  private renderCard(decision: OrchDecisionView | null): void {
    clear(this.card)
    if (!decision) {
      this.card.append(h('div', { class: 'orch-empty' }, h('h2', {}, 'Nothing needs you right now.'), h('p', {}, 'Questions, approvals and stalled tasks from every run show up here.')))
      return
    }
    const draft = this.draftOf(decision.id)
    if (decision.kind === 'spec-approval') {
      this.card.append(h('article', { class: 'orch-panel review-card' }, h('h2', { class: 'review-question' }, decision.question),
        h('p', { class: 'orch-muted' }, decision.runTitle),
        h('button', { class: 'btn primary', type: 'button', onClick: () => showOrch('spec', decision.runId) }, 'Review spec & mockups')))
      return
    }
    const options = decision.options
    const choices = options.length > 0 ? [...options, OTHER_OPTION] : []
    if (choices.length > 0 && (draft.option === null || !choices.includes(draft.option))) draft.option = choices[0]

    const note = h('textarea', {
      class: 'text-input review-note',
      rows: 3,
      placeholder: choices.length > 0 ? 'Add a note (optional)…' : 'Write your answer…',
      'aria-label': choices.length > 0 ? 'Note' : 'Your answer'
    })
    note.value = draft.note
    note.addEventListener('input', () => {
      draft.note = note.value
    })

    const send = h('button', { class: 'btn primary', type: 'button', onClick: () => void this.send(decision, draft) }, 'Send')
    const runDetail = this.runs.find((r) => r.id === decision.runId)
    const head = h(
      'div',
      { class: 'review-card-head' },
      pill(decisionKindLabel(decision.kind), KIND_TONE[decision.kind]),
      h('span', { class: 'orch-muted' }, runDetail?.title ?? decision.runTitle),
      decision.taskKey ? h('span', { class: 'orch-mono orch-muted' }, decision.taskKey) : null,
      decision.agentRole && decision.agentModel ? modelBadge(this.runnerOf(decision), decision.agentModel, ROLE_LABEL[decision.agentRole]) : null,
      h('span', { class: 'orch-muted review-ago' }, timeAgo(decision.createdAt))
    )

    this.card.append(
      h(
        'article',
        { class: 'orch-panel review-card', 'aria-label': decision.question },
        head,
        h('h2', { class: 'review-question' }, decision.question),
        decision.context && decision.context !== decision.question ? h('pre', { class: 'review-context' }, decision.context) : null,
        choices.length > 0 ? this.optionList(decision, choices, draft) : null,
        note,
        h('div', { class: 'review-actions' }, send),
        decision.kind === 'stall' && decision.taskKey ? this.handoff(decision, draft) : null
      )
    )
  }

  private optionList(decision: OrchDecisionView, choices: string[], draft: Draft): HTMLElement {
    const name = `review-${decision.id}`
    return h(
      'div',
      { class: 'review-options', role: 'radiogroup', 'aria-label': 'Choose an answer' },
      ...choices.map((choice) => {
        const input = h('input', { type: 'radio', name, value: choice })
        input.checked = draft.option === choice
        input.addEventListener('change', () => {
          draft.option = choice
        })
        return h('label', { class: 'review-option' }, input, h('span', {}, choice))
      })
    )
  }

  private handoff(decision: OrchDecisionView, draft: Draft): HTMLElement {
    const select = h('select', { class: 'text-input review-select', 'aria-label': 'Continue with model' })
    for (const p of this.profiles) {
      const option = h('option', { value: p.id }, profileLabel(p))
      select.append(option)
    }
    const known = this.profiles.some((p) => p.id === draft.profileId)
    select.value = known ? (draft.profileId as string) : (this.profiles[0]?.id ?? '')
    draft.profileId = select.value || null

    const button = h('button', { class: 'btn', type: 'button' })
    const label = (): void => {
      const profile = this.profiles.find((p) => p.id === select.value)
      button.textContent = profile ? `Continue with ${profile.name}` : 'Continue with…'
      button.toggleAttribute('disabled', !profile)
    }
    label()
    select.addEventListener('change', () => {
      draft.profileId = select.value
      label()
    })

    const note = h('textarea', { class: 'text-input review-note', rows: 2, placeholder: 'Note for the new model (optional)…', 'aria-label': 'Note for the new model' })
    note.value = draft.handoffNote
    note.addEventListener('input', () => {
      draft.handoffNote = note.value
    })
    button.addEventListener('click', () => void this.handOver(decision, select.value, note.value, button))

    return h(
      'section',
      { class: 'review-handoff', 'aria-label': 'Continue with another model' },
      h('h3', { class: 'review-handoff-title' }, 'Continue with another model'),
      h('p', { class: 'orch-muted review-handoff-hint' }, 'The task moves to a fresh agent with everything done so far.'),
      selectMenu(select),
      note,
      h('div', { class: 'review-actions' }, button)
    )
  }

  private async send(decision: OrchDecisionView, draft: Draft): Promise<void> {
    const answer = composeAnswer(draft.option, draft.note)
    if (!answer) {
      const field = this.card.querySelector<HTMLTextAreaElement>('.review-card > .review-note')
      field?.focus()
      return
    }
    if (await answerDecision(decision.id, answer)) this.drafts.delete(decision.id)
  }

  private async handOver(decision: OrchDecisionView, profileId: string, note: string, button: HTMLButtonElement): Promise<void> {
    if (!decision.taskKey || !profileId) return
    button.disabled = true
    const moved = await handoffTask(decision.runId, decision.taskKey, profileId, note.trim())
    if (moved) {
      await answerDecision(decision.id, 'Handed over')
      this.drafts.delete(decision.id)
    } else {
      button.disabled = false
    }
  }
}
