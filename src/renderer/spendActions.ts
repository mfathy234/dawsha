import { pauseConfirm, pauseTargets } from '../shared/pauseAgents'
import { detectSpendWarnings, formatLimitUsd, parseLimitAmount, spendMessage, spendProjects, type SpendLimit, type SpendPeriod, type SpendWarned } from '../shared/spendLimits'
import { saveSettings } from './actions'
import { interruptAgent } from './chat/chatActions'
import { choiceDialog, confirmDialog, promptDialog } from './components/dialogs'
import { toast } from './components/toast'
import { derivePanes } from './derive'
import { refreshUsage } from './usageSnapshot'
import { store } from './state'

const STORAGE_KEY = 'dawsha.spendWarned'

function loadWarned(): SpendWarned {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SpendWarned) : {}
  } catch {
    return {}
  }
}

function saveWarned(warned: SpendWarned): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(warned))
  } catch {
    // Not remembering a warning only means it may show once more after a restart.
  }
}

const projectName = (projectId: string): string => store.state.settings.projects.find((p) => p.id === projectId)?.name ?? 'This project'

/** Asks before sending Esc to every working agent, or only those in one project. */
export async function pauseAllAgents(projectId?: string): Promise<void> {
  const views = derivePanes(store.state).map((view) => ({ tabId: view.primaryTabId, projectId: view.project?.id, agent: view.agent, status: view.status }))
  const targets = pauseTargets(views, projectId)
  if (targets.length === 0) return toast(projectId ? `No agents are working in ${projectName(projectId)}.` : 'No agents are working.', 'info')
  const ask = pauseConfirm(targets.length, projectId ? projectName(projectId) : undefined)
  if (!(await confirmDialog({ ...ask, danger: true }))) return
  for (const tabId of targets) interruptAgent(tabId)
  toast(`Interrupted ${targets.length} ${targets.length === 1 ? 'session' : 'sessions'}.`, 'info')
}

let warned: SpendWarned | null = null

function checkSpend(): void {
  const { settings, usage } = store.state
  const projects = spendProjects(settings.projects, settings.spendLimits ?? {})
  if (projects.length === 0 || !usage?.spend) return
  warned ??= loadWarned()
  const result = detectSpendWarnings(projects, usage.spend, Date.now(), warned)
  if (result.warned !== warned) {
    warned = result.warned
    saveWarned(warned)
  }
  for (const warning of result.fire) {
    const text = `${spendMessage(warning, projectName(warning.projectId))}.`
    if (warning.threshold === 100) toast(text, 'info', { label: 'Pause agents', run: () => void pauseAllAgents(warning.projectId) })
    else toast(text, 'info')
  }
}

export function installSpendWarnings(): void {
  let lastUsage = store.state.usage
  store.subscribe(() => {
    if (store.state.usage === lastUsage) return
    lastUsage = store.state.usage
    checkSpend()
  })
}

function storeLimits(limits: Record<string, SpendLimit>): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, spendLimits: limits } }))
  void saveSettings({ spendLimits: limits }).then(() => refreshUsage())
}

/** Sets, changes or clears a project's spending limit. Leaving the amount empty clears it. */
export async function editSpendLimit(projectId: string): Promise<void> {
  const name = projectName(projectId)
  const current = store.state.settings.spendLimits?.[projectId]
  const typed = await promptDialog({
    title: `Spending limit for ${name}`,
    label: 'Amount in US dollars',
    initial: current ? String(current.amountUsd) : '',
    hint: 'Dawsha warns at 80% and again at 100%. It counts the cost Claude Code reports. Leave empty for no limit.',
    confirmLabel: 'Next',
    validate: (value) => (value.trim() === '' || parseLimitAmount(value) !== null ? null : 'Type an amount like 20 or 12.50.')
  })
  if (typed === null) return
  const { [projectId]: _old, ...others } = store.state.settings.spendLimits ?? {}
  if (typed.trim() === '') {
    if (current) storeLimits(others)
    return
  }
  const amountUsd = parseLimitAmount(typed) as number
  const period = await choiceDialog<SpendPeriod>({
    title: `${formatLimitUsd(amountUsd)} for ${name}`,
    body: 'Count spending per day or per week? Weeks start on Monday.',
    choices: [{ label: 'Per week', value: 'week' }, { label: 'Per day', value: 'day', kind: 'primary' }]
  })
  if (period) storeLimits({ ...others, [projectId]: { amountUsd, period } })
}
