import { MAX_WORKERS_LIMIT, type OrchPlan, type OrchSettings } from '../../../shared/orch/profiles'
import { OPTIONAL_ROLES, addPlan, deletePlan, setDefaultPlan, setPlanRole, updatePlan } from '../../../shared/orch/settingsEdit'
import { ORCH_ROLES, type OrchRole } from '../../../shared/orch/types'
import { h } from '../../dom'
import { confirmDialog } from '../dialogs'
import { selectMenu } from '../selectMenu'
import { ROLE_LABEL } from './orchUi'
import { current, persist, applyEdit, field, textInput, numberInput, checkbox, button, modelCell, effortLabel } from './orchSettingsControls'

const MIN_TASK_MINUTES = 5
const MAX_TASK_MINUTES = 240
let selectedPlanId: string | null = null

function selectedPlan(settings: OrchSettings): OrchPlan {
  return settings.plans.find((p) => p.id === selectedPlanId) ?? settings.plans.find((p) => p.id === settings.defaultPlanId) ?? settings.plans[0]
}

function planChips(settings: OrchSettings, plan: OrchPlan, refresh: () => void): HTMLElement {
  const chips = h('div', { class: 'orch-set-chips', role: 'group', 'aria-label': 'Plans' })
  for (const p of settings.plans) {
    chips.append(
      h(
        'button',
        {
          class: `orch-set-chip${p.id === plan.id ? ' selected' : ''}`,
          type: 'button',
          id: `orch-set-plan-${p.id}`,
          'aria-pressed': String(p.id === plan.id),
          onClick: () => { selectedPlanId = p.id; refresh() }
        },
        p.name,
        p.id === settings.defaultPlanId ? h('span', { class: 'orch-set-tag' }, 'Default for new runs') : null
      )
    )
  }
  return chips
}

function roleRow(settings: OrchSettings, plan: OrchPlan, role: OrchRole): HTMLElement {
  const optional = OPTIONAL_ROLES.includes(role)
  const id = plan.roles[role] ?? null
  const profile = settings.profiles.find((p) => p.id === id)
  const options = [
    ...(optional || id === null ? [{ value: '', label: role === 'fixer' ? 'Main model (lead)' : 'No agent' }] : []),
    ...settings.profiles.filter((p) => p.role === role).map((p) => ({ value: p.id, label: p.name }))
  ]
  const select = h('select', { class: 'text-input', id: `orch-set-role-${role}`, 'aria-label': `${ROLE_LABEL[role]} profile` },
    ...options.map((option) => h('option', { value: option.value, selected: option.value === (profile?.id ?? '') }, option.label)))
  select.addEventListener('change', () => {
    persist(setPlanRole(current(), plan.id, role, select.value || null))
    requestAnimationFrame(() => document.getElementById(`orch-set-role-${role}-change`)?.focus())
  })
  const picker = selectMenu(select)
  picker.hidden = true
  // The native select stays available to existing automation while its visible picker is folded away.
  const change = button(`orch-set-role-${role}-change`, 'Change', () => {
    picker.hidden = false
    change.hidden = true
    picker.querySelector('button')?.focus()
  })
  const model = profile
    ? h('span', { class: 'orch-set-team-model' }, h('span', { class: 'orch-muted' }, profile.local ? 'Codex local' : profile.runner),
      modelCell(profile), profile.effort ? h('span', { class: 'orch-set-effort' }, effortLabel(profile)) : null)
    : h('span', { class: 'orch-muted' }, 'Not used')
  return h('div', { class: 'orch-set-team-row', role: 'listitem' },
    h('span', { class: 'orch-set-team-role' }, ROLE_LABEL[role]), model,
    h('div', { class: 'orch-set-team-change' }, change, picker))
}

function planTeam(settings: OrchSettings, plan: OrchPlan): HTMLElement {
  return h('div', { class: 'orch-set-team', role: 'list', 'aria-label': `Agents in the plan ${plan.name}` },
    ...ORCH_ROLES.map((role) => roleRow(settings, plan, role)))
}

function planFields(plan: OrchPlan, refresh: () => void): HTMLElement {
  const clampedNumber = (key: 'maxWorkers' | 'taskMinutes') => (value: number | null) => {
    if (value !== null && Number.isFinite(value)) persist(updatePlan(current(), plan.id, { [key]: Math.round(value) }))
    refresh()
  }
  return h(
    'div',
    { class: 'orch-set-limits' },
    field('Workers at once', 'orch-set-plan-workers', numberInput('orch-set-plan-workers', plan.maxWorkers, 1, MAX_WORKERS_LIMIT, clampedNumber('maxWorkers'))),
    field('Minutes per task', 'orch-set-plan-minutes', numberInput('orch-set-plan-minutes', plan.taskMinutes, MIN_TASK_MINUTES, MAX_TASK_MINUTES, clampedNumber('taskMinutes'))),
    h(
      'div',
      { class: 'orch-set-field' },
      checkbox('orch-set-plan-approval', 'Stop for my approval of the spec and mockups', plan.specApproval, false, (specApproval) => persist(updatePlan(current(), plan.id, { specApproval })))
    )
  )
}

async function deletePlanFlow(plan: OrchPlan, refresh: () => void): Promise<void> {
  const confirmed = await confirmDialog({
    title: `Delete the plan "${plan.name}"?`,
    body: `The plan "${plan.name}" will be removed. Runs that already started keep working. Your profiles are not deleted.`,
    confirmLabel: `Delete "${plan.name}"`
  })
  if (!confirmed) return
  if (applyEdit(deletePlan(current(), plan.id))) selectedPlanId = null
  refresh()
}

export function plansSection(settings: OrchSettings, refresh: () => void): HTMLElement {
  const plan = selectedPlan(settings)
  const copyTo = (name: string): void => {
    const added = addPlan(current(), plan.id, name)
    persist(added.settings)
    selectedPlanId = added.planId
    refresh()
  }
  return h(
    'section',
    { class: 'orch-panel orch-set-section', 'aria-labelledby': 'orch-set-plans-title' },
    h('h3', { class: 'orch-panel-title', id: 'orch-set-plans-title' }, 'Plans'),
    h(
      'div',
      { class: 'orch-set-body' },
      h('div', { class: 'orch-set-plan-top' }, planChips(settings, plan, refresh), button('orch-set-plan-new', 'New plan', () => copyTo('New plan'))),
      planTeam(settings, plan),
      planFields(plan, refresh),
      h('div', { class: 'orch-set-plan-edit', hidden: plan.builtIn },
        field('Name', 'orch-set-plan-name', textInput('orch-set-plan-name', plan.name, (name) => {
          persist(updatePlan(current(), plan.id, { name: name.trim() || plan.name }))
          refresh()
        }, { disabled: plan.builtIn }))),
      h(
        'div',
        { class: 'orch-set-actions' },
        button('orch-set-plan-dup', 'Duplicate', () => copyTo(`${plan.name} copy`)),
        button('orch-set-plan-default', settings.defaultPlanId === plan.id ? 'Default plan' : 'Set as default', () => persist(setDefaultPlan(current(), plan.id)), { disabled: settings.defaultPlanId === plan.id }),
        button('orch-set-plan-delete', 'Delete', () => void deletePlanFlow(plan, refresh), {
          danger: true,
          disabled: plan.builtIn,
          title: plan.builtIn ? 'Built-in plans cannot be deleted' : `Delete the plan "${plan.name}"`
        })
      )
    )
  )
}

