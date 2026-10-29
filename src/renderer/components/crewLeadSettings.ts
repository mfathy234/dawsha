import type { CrewMember } from '../../shared/crew'
import { MAX_BUDGET_USD, formatBudget, type AtOnce, type LeadRules } from '../../shared/crewLead'
import { currentMembers } from '../crewActions'
import { updateLead } from '../crewLead'
import { h } from '../dom'
import { store } from '../state'
import { crewAvatar } from './crewAvatar'

const RULE_LABELS: [keyof LeadRules, string][] = [
  ['fewBig', 'Hand out a few big jobs, not many small ones'],
  ['oneReview', 'Have one review at the end, not one per job'],
  ['planFirst', 'Show me the plan before starting'],
  ['askFirst', 'Ask me before pushing, merging, posting comments or deleting anything']
]

const COMMANDS = [
  'dawsha crew plan --goal <id> --file plan.json',
  'dawsha crew run <member> --goal <id> --field key=value',
  'dawsha crew status <run>',
  'dawsha crew result <run>',
  'dawsha crew note --goal <id> "<text>"',
  'dawsha crew ask --goal <id> "<question>" --option "…" --option "…"'
].join('\n')

function row(label: string, control: Node, hint?: string): HTMLElement[] {
  return [h('label', { class: 'crew-label' }, label), h('div', { class: 'crew-control' }, control, hint ? h('div', { class: 'crew-hint' }, hint) : null)]
}

function rules(): HTMLElement {
  const lead = store.state.settings.lead
  const wrap = h('div', { class: 'crew-checks' })
  for (const [key, label] of RULE_LABELS) {
    const input = h('input', { type: 'checkbox', 'data-rule': key, checked: lead.rules[key] })
    input.addEventListener('change', () => updateLead({ rules: { ...store.state.settings.lead.rules, [key]: input.checked } }))
    wrap.append(h('label', { class: 'crew-check' }, input, h('span', {}, label)))
  }
  return wrap
}

function atOnce(): HTMLElement {
  const current = store.state.settings.lead.atOnce
  const wrap = h('div', { class: 'crew-radios', role: 'radiogroup', 'aria-label': 'At once' })
  for (const value of [1, 2, 3] as AtOnce[]) {
    const button = h('button', { class: 'crew-radio', type: 'button', role: 'radio', 'aria-checked': String(value === current), 'data-value': String(value) }, h('span', {}, String(value)))
    button.addEventListener('click', () => {
      updateLead({ atOnce: value })
      for (const other of wrap.querySelectorAll('.crew-radio')) other.setAttribute('aria-checked', String(other === button))
    })
    wrap.append(button)
  }
  return wrap
}

function budget(): HTMLElement {
  const input = h('input', { class: 'text-input crew-budget', type: 'text', inputmode: 'decimal', 'aria-label': 'Budget per goal', autocomplete: 'off' })
  input.value = formatBudget(store.state.settings.lead.budgetUsd)
  input.addEventListener('change', () => {
    const value = Number.parseFloat(input.value.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(value) && value >= 0.1) updateLead({ budgetUsd: Math.min(MAX_BUDGET_USD, value) })
    input.value = formatBudget(store.state.settings.lead.budgetUsd)
  })
  return input
}

function members(): HTMLElement {
  const lead = store.state.settings.lead
  const wrap = h('div', { class: 'crew-checks crew-lead-members' })
  for (const member of currentMembers().filter((m) => !m.lead && !m.hidden)) {
    const input = h('input', { type: 'checkbox', 'data-member-allowed': member.id, checked: !lead.excluded.includes(member.id) })
    input.addEventListener('change', () => {
      const excluded = store.state.settings.lead.excluded.filter((id) => id !== member.id)
      updateLead({ excluded: input.checked ? excluded : [...excluded, member.id] })
    })
    wrap.append(h('label', { class: 'crew-check crew-member-check' }, input, crewAvatar(member, 'idle', 22), h('span', {}, member.name), h('span', { class: 'crew-muted' }, member.role)))
  }
  return wrap
}

/** The "How she leads" tab: the Lead's rules and limits, which Dawsha enforces on every `crew run` of a goal. */
export function buildLeadSettings(maya: CrewMember, duplicate: () => void): HTMLElement {
  const instructions = h('textarea', { class: 'text-input crew-area mono', rows: '8', 'aria-label': 'Her instructions', readonly: true, spellcheck: 'false' })
  instructions.value = maya.instructions
  const duplicateButton = h('button', { class: 'btn', type: 'button', id: 'crew-lead-duplicate', onClick: duplicate }, 'Duplicate to customise')
  return h(
    'div',
    { class: 'crew-form crew-lead-form' },
    h('div', { class: 'crew-group-title' }, `How ${maya.name} leads`),
    ...row('Rules', rules()),
    ...row('At once', atOnce(), 'Dawsha refuses a run when this many are already working.'),
    ...row('Budget per goal', budget(), 'Dawsha refuses a run that would pass it, so she has to ask you first.'),
    ...row('Members she may use', members(), 'Unticked members are refused when she tries to run them.'),
    h('div', { class: 'crew-group-title' }, 'Her instructions'),
    ...row('Instructions', h('div', {}, instructions, h('div', { class: 'crew-lead-dup' }, duplicateButton)), 'Built in. Duplicate to change them.'),
    h('div', { class: 'crew-group-title' }, 'How she runs them'),
    ...row(
      'Commands',
      h('div', { class: 'crew-cmd', 'data-lead-commands': '' }, COMMANDS),
      'Maya is a normal Claude session. She starts members and talks to you only through these commands, so every job is a visible pane and every limit above is checked by Dawsha, not just by her instructions.'
    )
  )
}
