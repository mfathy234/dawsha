import { effectiveMergeCommand, prProjectSettings, MERGE_COMMAND_MAX, type PrProjectSettings } from '../shared/prSettings'
import { miniSendRefusal } from '../shared/miniSend'
import { notifyAttribution } from '../shared/notifyContent'
import { worktreeOfPane } from '../shared/mergeBack'
import {
  PR_LINK_ONLY_NOTE,
  findPrUrl,
  isSupportedHost,
  linkOnlyPr,
  parseMergeCommand,
  prLine,
  prNotice,
  shouldAutoFix,
  shouldMerge,
  shouldTidy,
  tidyIsStrict,
  tidyNote,
  worthLooking,
  type PrPhase,
  type PrWatchState,
  type PrWatchTarget
} from '../shared/prWatch'
import type { KeptSession } from '../shared/types'
import { api } from './api'
import { discardPane, saveSettings, permissionTail } from './actions'
import { sendChatMessage } from './chat/chatActions'
import { confirmDialog, promptDialog } from './components/dialogs'
import { toast } from './components/toast'
import { derivePanes, primaryTab, type PaneView } from './derive'
import { folderOfPane, store } from './state'
import { getTerminal } from './terminals'

const TICK_MS = 2_000
const TAIL_ROWS = 60

interface PaneOptions {
  fixAuto: boolean
  mergeWhenGreen: boolean
  lastFixedSha: string | null
  lastTriedSha: string | null
}

const options = new Map<string, PaneOptions>()
const linked = new Map<string, number>()
const phases = new Map<string, PrPhase>()
const seenOpen = new Set<string>()
const tidyTried = new Set<string>()
const busyBefore = new Map<string, boolean>()
const working = new Set<string>()
let syncKey = ''

const optionsOf = (paneId: string): PaneOptions => options.get(paneId) ?? { fixAuto: false, mergeWhenGreen: false, lastFixedSha: null, lastTriedSha: null }
const setOptions = (paneId: string, patch: Partial<PaneOptions>): void => { options.set(paneId, { ...optionsOf(paneId), ...patch }) }

export const prStateOf = (paneId: string): PrWatchState | null => store.state.prWatch[paneId] ?? null

/** The session's PR status as a line, or empty when it has no pull request. */
export const prLineFor = (paneId: string): string => {
  const state = prStateOf(paneId)
  return state ? prLine(state) : ''
}

export const prNoteFor = (paneId: string): string => (prStateOf(paneId)?.phase === 'link' ? PR_LINK_ONLY_NOTE : '')

export const fixAutoOn = (paneId: string): boolean => optionsOf(paneId).fixAuto
export const mergeWhenGreenOn = (paneId: string): boolean => optionsOf(paneId).mergeWhenGreen

export function projectPrSettings(projectId: string): PrProjectSettings {
  return prProjectSettings(store.state.settings.pullRequests, projectId)
}

function savePrSettings(projectId: string, patch: Partial<PrProjectSettings>): void {
  const pullRequests = { ...store.state.settings.pullRequests, [projectId]: { ...projectPrSettings(projectId), ...patch } }
  store.patch({ settings: { ...store.state.settings, pullRequests } })
  void saveSettings({ pullRequests })
}

const viewOf = (paneId: string): PaneView | undefined => derivePanes(store.state).find((view) => view.pane.id === paneId)

/** Types a message into the session the way the chat box does. Returns why it could not, or null once sent. */
export function sendToSession(paneId: string, text: string): string | null {
  const view = viewOf(paneId)
  const tab = view ? primaryTab(view.pane) : null
  if (!view || !tab) return 'That session is gone.'
  const refusal = miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
  if (refusal) return refusal
  sendChatMessage(tab.id, tab.agent, text, () => !miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) }))
  return null
}

export async function fixCi(paneId: string, quiet = false): Promise<boolean> {
  const state = prStateOf(paneId)
  const view = viewOf(paneId)
  const folder = view ? folderOfPane(store.state, view.pane) : null
  if (!state || !folder || state.failedCount === 0) return false
  const made = await api.prWatch.fixCi(folder, { number: state.number, failed: state.failed })
  if (!made.ok) {
    if (!quiet) toast(made.error)
    return false
  }
  const refusal = sendToSession(paneId, made.message)
  if (refusal) {
    if (!quiet) toast(refusal)
    return false
  }
  setOptions(paneId, { lastFixedSha: state.headSha })
  if (!quiet) toast(`Sent the failed checks of PR #${state.number} to the session.`, 'info')
  return true
}

export function toggleFixAuto(paneId: string): void {
  setOptions(paneId, { fixAuto: !optionsOf(paneId).fixAuto, lastFixedSha: null })
}

export async function toggleMergeWhenGreen(paneId: string): Promise<void> {
  const current = optionsOf(paneId)
  if (current.mergeWhenGreen) {
    setOptions(paneId, { mergeWhenGreen: false })
    return
  }
  const state = prStateOf(paneId)
  const view = viewOf(paneId)
  if (!state || !view) return
  const settings = projectPrSettings(view.pane.projectId)
  const command = effectiveMergeCommand(settings)
  const parsed = parseMergeCommand(command, state.number, state.headSha)
  if (!parsed.ok) {
    toast(parsed.error)
    return
  }
  if (!settings.mergeConfirmed) {
    const shown = ['gh', ...parsed.args.filter((arg) => !arg.startsWith('--match-head-commit'))].join(' ')
    const ok = await confirmDialog({
      title: 'Merge when the checks pass?',
      body: `Once every check passes and GitHub says it can be merged, Dawsha will run "${shown}" for PR #${state.number}. Dawsha asks this once for ${view.project?.name ?? 'this project'}. It never force-pushes.`,
      confirmLabel: `Merge PR #${state.number} when green`,
      danger: false
    })
    if (!ok) return
    savePrSettings(view.pane.projectId, { mergeConfirmed: true })
  }
  setOptions(paneId, { mergeWhenGreen: true, lastTriedSha: null })
}

export async function editMergeCommand(projectId: string): Promise<void> {
  const settings = projectPrSettings(projectId)
  const answer = await promptDialog({
    title: 'Merge command',
    label: 'Run this when a pull request is green',
    initial: effectiveMergeCommand(settings),
    hint: 'For example gh pr merge <n> --squash --admin. Only plain flags are allowed.',
    confirmLabel: 'Save',
    validate: (value) => {
      if (value.length > MERGE_COMMAND_MAX) return 'That is too long.'
      const parsed = parseMergeCommand(value, 1, '')
      return parsed.ok ? null : parsed.error
    }
  })
  if (answer === null) return
  const command = answer.replace(/\s+/g, ' ').trim()
  savePrSettings(projectId, { mergeCommand: command === effectiveMergeCommand({ ...settings, mergeCommand: '' }) ? '' : command, mergeConfirmed: false })
}

export function toggleTidyUp(projectId: string): void {
  savePrSettings(projectId, { tidyUp: !projectPrSettings(projectId).tidyUp })
}

export function openPullRequest(paneId: string): void {
  const url = prStateOf(paneId)?.url ?? ''
  if (/^https:\/\//i.test(url)) void api.openExternal(url)
}

/** Remember a pull request a session opened (from the PR tab, or a link its agent printed) and look at it now. */
export function linkPullRequest(paneId: string, number: number): void {
  if (!store.state.settings.watchPullRequests) return
  linked.set(paneId, number)
  syncKey = ''
  api.prWatch.refresh(paneId)
}

/** The Pull request tab found or opened a pull request for a folder: its sessions start watching it. */
export function linkFolderPullRequest(folder: string, number: number): void {
  for (const view of derivePanes(store.state)) {
    if (view.agent !== 'shell' && folderOfPane(store.state, view.pane) === folder && linked.get(view.pane.id) !== number) linkPullRequest(view.pane.id, number)
  }
}

function withNote(kept: readonly KeptSession[], settings: readonly KeptSession[], note: string): KeptSession[] {
  const keys = new Set(kept.map((item) => `${item.agent}:${item.sessionId}`))
  return settings.map((item) => (keys.has(`${item.agent}:${item.sessionId}`) ? { ...item, note } : item))
}

async function tidy(paneId: string, state: PrWatchState): Promise<void> {
  const view = viewOf(paneId)
  if (!view) return
  const worktree = worktreeOfPane(view.pane)
  const strict = tidyIsStrict(seenOpen.has(paneId))
  const request = { repo: worktree?.repo ?? '', path: worktree?.path ?? '', branch: worktree?.branch ?? '', headSha: state.headSha, strict }
  const name = view.title
  if (worktree) {
    const check = await api.prWatch.tidy({ ...request, dryRun: true })
    if (!check.ok) {
      toast(`Kept ${name}: ${check.error}`)
      return
    }
  }
  const kept = await discardPane(paneId)
  const note = tidyNote(state)
  const next = withNote(kept, store.state.settings.keptSessions, note)
  store.patch({ settings: { ...store.state.settings, keptSessions: next } })
  void saveSettings({ keptSessions: next })
  if (worktree) {
    const removed = await api.prWatch.tidy({ ...request, dryRun: false })
    if (!removed.ok) {
      toast(`Closed ${name}, but its worktree stays: ${removed.error}`)
      return
    }
  }
  toast(`Closed ${name} after PR #${state.number} was ${state.phase === 'merged' ? 'merged' : 'closed'}.`, 'info')
}

async function mergeNow(paneId: string, state: PrWatchState, command: string): Promise<void> {
  const view = viewOf(paneId)
  const folder = view ? folderOfPane(store.state, view.pane) : null
  if (!folder) return
  const result = await api.prWatch.merge({ folder, number: state.number, headSha: state.headSha, command })
  toast(result.ok ? result.message : result.error, result.ok ? 'info' : 'error')
  api.prWatch.refresh(paneId)
}

function reviewPane(view: PaneView, state: PrWatchState): void {
  const id = view.pane.id
  const project = projectPrSettings(view.pane.projectId)
  const mine = optionsOf(id)
  if (shouldAutoFix({ enabled: mine.fixAuto, state, lastFixedSha: mine.lastFixedSha }) && view.status === 'idle' && !working.has(`fix:${id}`)) {
    working.add(`fix:${id}`)
    void fixCi(id, true).finally(() => working.delete(`fix:${id}`))
  }
  const command = effectiveMergeCommand(project)
  const parsed = parseMergeCommand(command, state.number, state.headSha)
  if (parsed.ok && shouldMerge({ enabled: mine.mergeWhenGreen && project.mergeConfirmed, state, admin: parsed.admin, lastTriedSha: mine.lastTriedSha }) && !working.has(`merge:${id}`)) {
    working.add(`merge:${id}`)
    setOptions(id, { lastTriedSha: state.headSha })
    void mergeNow(id, state, command).finally(() => working.delete(`merge:${id}`))
  }
  if (shouldTidy({ enabled: project.tidyUp, state }) && view.status !== 'busy' && !tidyTried.has(id) && !working.has(`tidy:${id}`)) {
    tidyTried.add(id)
    working.add(`tidy:${id}`)
    void tidy(id, state).finally(() => working.delete(`tidy:${id}`))
  }
}

function onUpdate(key: string, state: PrWatchState | null): void {
  if (!store.state.settings.watchPullRequests) return
  const known = store.state.prWatch
  const before = known[key]
  if (!state) {
    if (!before || before.phase === 'link') return
    const { [key]: _gone, ...rest } = known
    store.patch({ prWatch: rest })
    return
  }
  if (state.state === 'OPEN') seenOpen.add(key)
  const notice = before ? prNotice(phases.get(key) ?? null, state) : null
  phases.set(key, state.phase)
  store.patch({ prWatch: { ...known, [key]: state } })
  if (!notice || !store.state.settings.sessionInfo.notifications) return
  const view = viewOf(key)
  api.notify({ paneId: key, ...notice, attribution: notifyAttribution(view?.project?.name, view?.agent ?? 'shell'), sound: store.state.settings.sessionInfo.sound })
}

function scanForLink(view: PaneView): void {
  const text = getTerminal(view.primaryTabId)?.tailText(TAIL_ROWS) ?? ''
  const found = findPrUrl(text)
  const id = view.pane.id
  if (!found || prStateOf(id)?.url === found.url) return
  if (isSupportedHost(found.url)) linkPullRequest(id, found.number)
  else store.patch({ prWatch: { ...store.state.prWatch, [id]: linkOnlyPr(found.number, found.url) } })
}

function pauseWatching(): void {
  if (syncKey !== '[]') {
    syncKey = '[]'
    api.prWatch.sync([])
  }
  if (Object.keys(store.state.prWatch).length > 0) store.patch({ prWatch: {} })
  phases.clear()
  linked.clear()
}

function tick(): void {
  const state = store.state
  if (!state.ready) return
  if (!state.settings.watchPullRequests) {
    pauseWatching()
    return
  }
  const views = derivePanes(state).filter((view) => view.agent !== 'shell')
  const targets: PrWatchTarget[] = []
  const alive = new Set<string>()
  for (const view of views) {
    const id = view.pane.id
    const folder = folderOfPane(state, view.pane)
    alive.add(id)
    const busy = view.status === 'busy'
    if (busyBefore.get(id) === true && !busy) {
      scanForLink(view)
      api.prWatch.refresh(id)
    }
    busyBefore.set(id, busy)
    const known = state.prWatch[id]
    if (known?.phase === 'link' && !linked.has(id)) continue
    if (!folder || !(known || linked.has(id) || worthLooking(view.branch))) continue
    targets.push({ key: id, folder, number: known?.number ?? linked.get(id) ?? null })
    if (known && known.phase !== 'link') reviewPane(view, known)
  }
  const signature = JSON.stringify(targets)
  if (signature !== syncKey) {
    syncKey = signature
    api.prWatch.sync(targets)
  }
  forget(alive)
}

function forget(alive: ReadonlySet<string>): void {
  for (const map of [options, linked, phases, busyBefore]) for (const key of [...map.keys()]) if (!alive.has(key)) map.delete(key)
  for (const set of [seenOpen, tidyTried]) for (const key of [...set]) if (!alive.has(key)) set.delete(key)
  const stale = Object.keys(store.state.prWatch).filter((key) => !alive.has(key))
  if (stale.length === 0) return
  store.patch({ prWatch: Object.fromEntries(Object.entries(store.state.prWatch).filter(([key]) => alive.has(key))) })
}

/** Watches each agent session's pull request: status in the sidebar, pane and Mini window, Fix CI, merge when green and tidy-up. */
export function installPrWatch(): void {
  api.prWatch.onUpdate((update) => onUpdate(update.key, update.state))
  window.setInterval(tick, TICK_MS)
}
