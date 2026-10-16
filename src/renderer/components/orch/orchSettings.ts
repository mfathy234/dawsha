import { selectMenu } from '../selectMenu'
import { supportsEffort } from '../../../shared/orch/launch'
import {
  EFFORTS,
  MAX_WORKERS_LIMIT,
  ORCH_RUNNERS,
  sanitizeOrchSettings,
  type Effort,
  type OrchPlan,
  type OrchProfile,
  type OrchRunner,
  type OrchSettings
} from '../../../shared/orch/profiles'
import {
  OPTIONAL_ROLES,
  addPlan,
  addProfile,
  deletePlan,
  deleteProfile,
  isBuiltInProfile,
  priceKeys,
  setDefaultPlan,
  setPlanRole,
  setPrice,
  setProfileRole,
  updatePlan,
  updateProfile,
  type EditResult,
  type PriceRow
} from '../../../shared/orch/settingsEdit'
import { ORCH_ROLES, type OrchRole } from '../../../shared/orch/types'
import { saveSettings } from '../../actions'
import { h } from '../../dom'
import { store, type AppState } from '../../state'
import { confirmDialog } from '../dialogs'
import { toast } from '../toast'
import { modelBadge, ROLE_LABEL } from './orchUi'
import './orchSettings.css'

// Settings -> Orchestrator: plans, agent profiles and prices. Every change builds a new OrchSettings,
// sanitizes it, and saves it; the Settings view then redraws from the store.

const MIN_TASK_MINUTES = 5
const MAX_TASK_MINUTES = 240
const RUNNER_LABEL: Record<OrchRunner, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' }
const PRICE_FIELDS: { field: keyof PriceRow; label: string }[] = [
  { field: 'inputPerM', label: 'Input' },
  { field: 'outputPerM', label: 'Output' },
  { field: 'cacheReadPerM', label: 'Cache read' },
  { field: 'cacheWritePerM', label: 'Cache write' }
]

let selectedPlanId: string | null = null
let selectedProfileId: string | null = null

const current = (): OrchSettings => store.state.settings.orchestrator

function persist(next: OrchSettings): void {
  const orchestrator = sanitizeOrchSettings(next)
  store.set((s) => ({ ...s, settings: { ...s.settings, orchestrator } }))
  void saveSettings({ orchestrator })
}

function applyEdit(result: EditResult): boolean {
  if (!result.ok) {
    toast(result.error)
    return false
  }
  persist(result.settings)
  return true
}

function field(label: string, id: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'orch-set-field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'orch-set-hint' }, hint) : null)
}

function textInput(id: string, value: string, onCommit: (value: string) => void, options: { disabled?: boolean; placeholder?: string; mono?: boolean } = {}): HTMLInputElement {
  const input = h('input', {
    class: `text-input${options.mono ? ' mono' : ''}`,
    id,
    type: 'text',
    placeholder: options.placeholder,
    disabled: options.disabled === true
  })
  input.value = value
  input.addEventListener('change', () => onCommit(input.value))
  return input
}

function numberInput(id: string, value: number | null, min: number, max: number | null, onCommit: (value: number | null) => void): HTMLInputElement {
  const input = h('input', { class: 'text-input orch-set-number', id, type: 'number', min, max: max ?? undefined, step: 'any', inputmode: 'decimal' })
  input.value = value === null ? '' : String(value)
  input.addEventListener('change', () => {
    const raw = input.value.trim()
    onCommit(raw === '' ? null : Number(raw))
  })
  return input
}

function selectInput(id: string, options: { value: string; label: string; disabled?: boolean }[], value: string, onChange: (value: string) => void, disabled = false): HTMLElement {
  const select = h('select', { class: 'text-input', id, disabled })
  for (const option of options) select.append(h('option', { value: option.value, selected: option.value === value, disabled: option.disabled === true }, option.label))
  select.addEventListener('change', () => onChange(select.value))
  return selectMenu(select)
}

function checkbox(id: string, label: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, disabled })
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'check', for: id }, input, label)
}

function button(id: string, label: string, onClick: () => void, options: { danger?: boolean; disabled?: boolean; title?: string } = {}): HTMLElement {
  return h(
    'button',
    { class: `btn small ${options.danger ? 'danger' : 'ghost'}`, type: 'button', id, disabled: options.disabled === true, title: options.title, onClick },
    label
  )
}

const modelCell = (p: OrchProfile): HTMLElement => modelBadge(p.local ? 'codex-local' : p.runner, p.model || 'default')

const effortLabel = (p: OrchProfile): string => (p.effort ? p.effort : supportsEffort(p.runner) ? 'default' : 'n/a')

// ---- Plans ----

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
        p.id === settings.defaultPlanId ? h('span', { class: 'orch-set-tag' }, 'default') : null
      )
    )
  }
  return chips
}

function roleRow(settings: OrchSettings, plan: OrchPlan, role: OrchRole): HTMLElement {
  const optional = OPTIONAL_ROLES.includes(role)
  const id = plan.roles[role] ?? null
  const profile = id ? settings.profiles.find((p) => p.id === id) : undefined
  const options = [
    ...(optional || id === null ? [{ value: '', label: role === 'fixer' ? 'Main model (lead)' : 'No agent' }] : []),
    ...settings.profiles.filter((p) => p.role === role).map((p) => ({ value: p.id, label: p.name }))
  ]
  const select = selectInput(`orch-set-role-${role}`, options, profile?.id ?? '', (value) => persist(setPlanRole(current(), plan.id, role, value || null)))
  select.setAttribute('aria-label', `${ROLE_LABEL[role]} profile`)
  return h(
    'tr',
    {},
    h('th', { scope: 'row' }, ROLE_LABEL[role]),
    h('td', {}, select),
    h('td', {}, profile ? modelCell(profile) : h('span', { class: 'orch-muted' }, role === 'fixer' ? 'the lead' : 'none')),
    h('td', { class: 'orch-set-effort' }, profile ? effortLabel(profile) : '')
  )
}

function planTable(settings: OrchSettings, plan: OrchPlan): HTMLElement {
  return h(
    'div',
    { class: 'orch-set-scroll' },
    h(
      'table',
      { class: 'orch-set-table' },
      h('caption', { class: 'sr-only' }, `Agents in the plan ${plan.name}`),
      h('thead', {}, h('tr', {}, ...['Role', 'Profile', 'Runner · model', 'Effort'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...ORCH_ROLES.map((role) => roleRow(settings, plan, role)))
    )
  )
}

function planFields(plan: OrchPlan, refresh: () => void): HTMLElement {
  const clampedNumber = (key: 'maxWorkers' | 'taskMinutes') => (value: number | null) => {
    if (value !== null && Number.isFinite(value)) persist(updatePlan(current(), plan.id, { [key]: Math.round(value) }))
    refresh()
  }
  return h(
    'div',
    { class: 'orch-set-fields' },
    field('Name', 'orch-set-plan-name', textInput('orch-set-plan-name', plan.name, (name) => {
      persist(updatePlan(current(), plan.id, { name: name.trim() || plan.name }))
      refresh()
    }, { disabled: plan.builtIn }), plan.builtIn ? 'Built-in plans keep their name. Duplicate one to make your own.' : undefined),
    field('Workers at once', 'orch-set-plan-workers', numberInput('orch-set-plan-workers', plan.maxWorkers, 1, MAX_WORKERS_LIMIT, clampedNumber('maxWorkers')), `1 to ${MAX_WORKERS_LIMIT} implementers run side by side.`),
    field('Minutes per task', 'orch-set-plan-minutes', numberInput('orch-set-plan-minutes', plan.taskMinutes, MIN_TASK_MINUTES, MAX_TASK_MINUTES, clampedNumber('taskMinutes')), `${MIN_TASK_MINUTES} to ${MAX_TASK_MINUTES}. A task that runs longer is marked stalled.`),
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

function plansSection(settings: OrchSettings, refresh: () => void): HTMLElement {
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
      h('p', { class: 'orch-set-hint' }, 'A plan picks which profile fills each role and sets the limits of a run. New runs start with the default plan.'),
      planChips(settings, plan, refresh),
      planTable(settings, plan),
      planFields(plan, refresh),
      h(
        'div',
        { class: 'orch-set-actions' },
        button('orch-set-plan-new', 'New plan', () => copyTo('New plan')),
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

// ---- Profiles ----

function selectedProfile(settings: OrchSettings): OrchProfile {
  return settings.profiles.find((p) => p.id === selectedProfileId) ?? settings.profiles[0]
}

function profileList(settings: OrchSettings, profile: OrchProfile, refresh: () => void): HTMLElement {
  const list = h('div', { class: 'orch-set-list', role: 'group', 'aria-label': 'Profiles' })
  for (const p of settings.profiles) {
    list.append(
      h(
        'button',
        {
          class: `orch-set-item${p.id === profile.id ? ' selected' : ''}`,
          type: 'button',
          id: `orch-set-profile-${p.id}`,
          'aria-pressed': String(p.id === profile.id),
          onClick: () => { selectedProfileId = p.id; refresh() }
        },
        h('span', { class: 'orch-set-item-name' }, p.name),
        h('span', { class: 'orch-set-item-meta' }, ROLE_LABEL[p.role]),
        modelCell(p),
        h('span', { class: 'orch-set-item-meta' }, `effort ${effortLabel(p)}`),
        p.local ? h('span', { class: 'orch-set-tag' }, 'local') : null
      )
    )
  }
  return list
}

function effortSelect(profile: OrchProfile): HTMLElement {
  const supported = supportsEffort(profile.runner)
  const options = supported
    ? [{ value: '', label: 'CLI default' }, ...EFFORTS.map((e) => ({ value: e, label: e }))]
    : [{ value: '', label: `Not supported by ${RUNNER_LABEL[profile.runner]}` }]
  return selectInput('orch-set-profile-effort', options, profile.effort ?? '', (value) => persist(updateProfile(current(), profile.id, { effort: (value || null) as Effort | null })), !supported)
}

function profileEditor(profile: OrchProfile, refresh: () => void): HTMLElement {
  const roleSelect = selectInput('orch-set-profile-role', ORCH_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), profile.role, (value) => {
    applyEdit(setProfileRole(current(), profile.id, value as OrchRole))
    refresh()
  })
  const runnerSelect = selectInput('orch-set-profile-runner', ORCH_RUNNERS.map((r) => ({ value: r, label: RUNNER_LABEL[r] })), profile.runner, (value) =>
    persist(updateProfile(current(), profile.id, { runner: value as OrchRunner }))
  )
  const prompt = h('textarea', { class: 'text-input orch-set-prompt', id: 'orch-set-profile-prompt', rows: 4, maxlength: 8000, placeholder: 'Added to the role\'s built-in prompt, for example house rules for this agent.' })
  prompt.value = profile.prompt
  prompt.addEventListener('change', () => persist(updateProfile(current(), profile.id, { prompt: prompt.value })))
  return h(
    'div',
    { class: 'orch-set-fields' },
    field('Name', 'orch-set-profile-name', textInput('orch-set-profile-name', profile.name, (name) => persist(updateProfile(current(), profile.id, { name: name.trim() || profile.name })))),
    field('Role', 'orch-set-profile-role', roleSelect),
    field('Runner', 'orch-set-profile-runner', runnerSelect),
    field('Model', 'orch-set-profile-model', textInput('orch-set-profile-model', profile.model, (model) => persist(updateProfile(current(), profile.id, { model: model.trim() })), { mono: true, placeholder: 'Empty uses the CLI default' }), 'A model name or alias such as opus or sonnet.'),
    field('Effort', 'orch-set-profile-effort', effortSelect(profile)),
    h(
      'div',
      { class: 'orch-set-field' },
      checkbox('orch-set-profile-local', 'Run locally through Ollama', profile.local, profile.runner !== 'codex', (local) => persist(updateProfile(current(), profile.id, { local }))),
      h('p', { class: 'orch-set-hint' }, profile.runner === 'codex' ? 'Local models are free and never get a price.' : 'Only Codex can run a local model.')
    ),
    h('div', { class: 'orch-set-field orch-set-wide' }, h('label', { for: 'orch-set-profile-prompt' }, 'Extra instructions'), prompt)
  )
}

async function deleteProfileFlow(profile: OrchProfile, refresh: () => void): Promise<void> {
  const check = deleteProfile(current(), profile.id)
  if (!check.ok) {
    toast(check.error)
    return
  }
  const confirmed = await confirmDialog({
    title: `Delete the profile "${profile.name}"?`,
    body: `The profile "${profile.name}" (${ROLE_LABEL[profile.role]}) will be removed. No plan uses it.`,
    confirmLabel: `Delete "${profile.name}"`
  })
  if (!confirmed) return
  if (applyEdit(deleteProfile(current(), profile.id))) selectedProfileId = null
  refresh()
}

function profilesSection(settings: OrchSettings, refresh: () => void): HTMLElement {
  const profile = selectedProfile(settings)
  const copy = (sourceId?: string): void => {
    const added = addProfile(current(), profile.role, sourceId)
    persist(added.settings)
    selectedProfileId = added.profileId
    refresh()
  }
  const builtIn = isBuiltInProfile(profile.id)
  return h(
    'section',
    { class: 'orch-panel orch-set-section', 'aria-labelledby': 'orch-set-profiles-title' },
    h('h3', { class: 'orch-panel-title', id: 'orch-set-profiles-title' }, 'Agent profiles'),
    h(
      'div',
      { class: 'orch-set-body' },
      h('p', { class: 'orch-set-hint' }, 'A profile is one way to run a role: which CLI, which model and how much effort.'),
      profileList(settings, profile, refresh),
      profileEditor(profile, refresh),
      h(
        'div',
        { class: 'orch-set-actions' },
        button('orch-set-profile-new', 'New profile', () => copy()),
        button('orch-set-profile-dup', 'Duplicate', () => copy(profile.id)),
        button('orch-set-profile-delete', 'Delete', () => void deleteProfileFlow(profile, refresh), {
          danger: true,
          disabled: builtIn,
          title: builtIn ? 'Built-in profiles cannot be deleted' : `Delete the profile "${profile.name}"`
        })
      )
    )
  )
}

// ---- Prices ----

function priceRow(settings: OrchSettings, key: string): HTMLElement {
  const price = settings.prices[key]
  const status = h('span', { class: 'orch-set-status', role: 'status' }, price ? 'priced' : 'no price')
  const inputs = PRICE_FIELDS.map(({ field: name, label }) => {
    const input = numberInput(`orch-set-price-${key}-${name}`, price?.[name] ?? null, 0, null, () => undefined)
    input.setAttribute('aria-label', `${key} ${label} USD per million`)
    return { name, input }
  })
  const commit = (): void => {
    const row = Object.fromEntries(
      inputs.map(({ name, input }) => [name, input.value.trim() === '' ? null : Number(input.value)])
    ) as unknown as PriceRow
    const next = setPrice(current(), key, row)
    if (next === current()) {
      const invalid = Object.values(row).some((v) => v !== null && !(Number.isFinite(v) && v >= 0))
      status.textContent = invalid ? 'Use a number of 0 or more' : 'Needs input and output'
      return
    }
    persist(next)
  }
  for (const { input } of inputs) input.addEventListener('change', commit)
  const [runner, ...model] = key.split(':')
  return h(
    'tr',
    {},
    h('th', { scope: 'row' }, modelBadge(runner, model.join(':'))),
    ...inputs.map(({ input }) => h('td', {}, input)),
    h('td', {}, status)
  )
}

function pricesSection(settings: OrchSettings): HTMLElement {
  const keys = priceKeys(settings)
  const unnamed = settings.profiles.some((p) => !p.local && p.model.trim() === '')
  return h(
    'section',
    { class: 'orch-panel orch-set-section', 'aria-labelledby': 'orch-set-prices-title' },
    h('h3', { class: 'orch-panel-title', id: 'orch-set-prices-title' }, 'Prices'),
    h(
      'div',
      { class: 'orch-set-body' },
      h('p', { class: 'orch-set-hint' }, 'USD per million tokens, used to estimate a run\'s cost when the CLI does not report one. Leave a row empty for "no price". Input and output are both needed; cache prices default to the input price.'),
      keys.length === 0
        ? h('p', { class: 'orch-muted' }, 'No profile names a paid model yet.')
        : h(
            'div',
            { class: 'orch-set-scroll' },
            h(
              'table',
              { class: 'orch-set-table orch-set-prices' },
              h('caption', { class: 'sr-only' }, 'Prices in USD per million tokens'),
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Runner · model'), ...PRICE_FIELDS.map((f) => h('th', { scope: 'col' }, f.label)), h('th', { scope: 'col' }, 'Status'))),
              h('tbody', {}, ...keys.map((key) => priceRow(settings, key)))
            )
          ),
      unnamed ? h('p', { class: 'orch-set-hint' }, 'Profiles on a CLI default model cannot be priced. Give them a model name to add a price. Local models are always free.') : null
    )
  )
}

export function orchestratorSettingsRows(state: AppState, refresh: () => void): HTMLElement[] {
  const settings = state.settings.orchestrator
  return [h('div', { class: 'orch-set' }, plansSection(settings, refresh), profilesSection(settings, refresh), pricesSection(settings))]
}
