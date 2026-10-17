import type { OrchSettings } from '../../../shared/orch/profiles'
import { priceKeys, setPrice, type PriceRow } from '../../../shared/orch/settingsEdit'
import { h } from '../../dom'
import { setOrchestratorAutoTrust } from '../../orchActions'
import type { AppState } from '../../state'
import { modelBadge } from './orchUi'
import { current, persist, numberInput, checkbox } from './orchSettingsControls'
import { plansSection } from './orchSettingsTeam'
import { profilesSection } from './orchSettingsProfiles'
import './orchSettings.css'

const PRICE_FIELDS: { field: keyof PriceRow; label: string }[] = [
  { field: 'inputPerM', label: 'Input' },
  { field: 'outputPerM', label: 'Output' },
  { field: 'cacheReadPerM', label: 'Cache read' },
  { field: 'cacheWritePerM', label: 'Cache write' }
]
let advancedOpen = false

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
      h('p', { class: 'orch-set-hint' }, 'USD per million tokens. Input and output are required; cache prices default to input.'),
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
      unnamed ? h('p', { class: 'orch-set-hint' }, 'Name a model to add a price. Empty rows have no price; local models are free.') : null
    )
  )
}

export function orchestratorSettingsRows(state: AppState, refresh: () => void): HTMLElement[] {
  const settings = state.settings.orchestrator
  const advanced = h('details', { class: 'orch-set-advanced', open: advancedOpen },
    h('summary', {}, 'Advanced', h('span', { class: 'orch-set-hint' }, 'Agent profiles, prices and trust')),
    profilesSection(settings, refresh), pricesSection(settings),
    h('section', { class: 'orch-panel orch-set-section' },
      h('h3', { class: 'orch-panel-title' }, 'Trust orchestrator worktrees'),
      h('div', { class: 'orch-set-body' },
        checkbox('settings-orchestrator-trust', 'Answer for me', settings.autoTrust, false, setOrchestratorAutoTrust),
        h('p', { class: 'orch-set-hint' }, 'Answer the trust prompt once for each worktree Dawsha creates.'))))
  advanced.addEventListener('toggle', () => { if (advanced.isConnected) advancedOpen = advanced.open })
  return [h('div', { class: 'orch-set' }, plansSection(settings, refresh), advanced)]
}
