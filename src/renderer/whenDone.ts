import { notifyAttribution } from '../shared/notifyContent'
import type { CheckRunUpdate } from '../shared/turnChecks'
import { checksFinished } from '../shared/turnChecks'
import { COMMIT_MESSAGE, failureOutput, initialRule, ruleFooter, stepRule, type RuleAction, type RuleEvent, type RuleMemory } from '../shared/whenDone'
import { api } from './api'
import { sendChatMessage } from './chat/chatActions'
import { toast } from './components/toast'
import { derivePanes, primaryTab, type PaneView } from './derive'
import { folderOfPane, store } from './state'
import { onTerminalInput } from './terminals'

const TICK_MS = 700
const SETTLED_TICKS = 2
const SESSION_PREFIX = 'rule-'

const memories = new Map<string, RuleMemory>()
const watching = new Map<string, { sawBusy: boolean; idleTicks: number }>()
let sending = false

export const ruleMemoryOf = (paneId: string): RuleMemory => memories.get(paneId) ?? initialRule()

/** The quiet footer line for a pane; empty when it has no rule. */
export const ruleLineFor = (paneId: string): string => ruleFooter(ruleMemoryOf(paneId), store.state.panes.find((pane) => pane.id === paneId)?.care?.rule)

const runId = (paneId: string): string => `${SESSION_PREFIX}${paneId}`

function remember(paneId: string, memory: RuleMemory): void {
  const before = ruleMemoryOf(paneId)
  memories.set(paneId, memory)
  if (before.phase !== memory.phase || before.sent !== memory.sent) store.patch({})
}

function viewOf(paneId: string): PaneView | undefined {
  return derivePanes(store.state).find((view) => view.pane.id === paneId)
}

function sendToAgent(view: PaneView, text: string): void {
  const tab = primaryTab(view.pane)
  if (tab.status === 'exited' || tab.agent === 'shell') return
  sending = true
  try {
    sendChatMessage(tab.id, tab.agent, text)
  } finally {
    sending = false
  }
}

async function startChecks(view: PaneView): Promise<void> {
  const rule = view.pane.care?.rule
  const folder = folderOfPane(store.state, view.pane)
  if (!rule || !folder) return
  const result = await api.turn.runChecks({ folder, projectId: view.pane.projectId, sessionId: runId(view.pane.id), commandIds: rule.commandIds }).catch((error: Error) => ({ ok: false as const, error: error.message }))
  if (result.ok) return
  remember(view.pane.id, initialRule())
  toast(`${view.title}: ${result.error}`, 'error')
}

function perform(view: PaneView, action: RuleAction): void {
  const paneId = view.pane.id
  if (action.kind === 'run') void startChecks(view)
  else if (action.kind === 'send') sendToAgent(view, action.text)
  else if (action.kind === 'commit') sendToAgent(view, COMMIT_MESSAGE)
  else if (action.kind === 'notify') {
    api.notify({ paneId, title: `${view.title} passed its checks`, body: 'Nothing failed.', attribution: notifyAttribution(view.project?.name, view.agent), sound: store.state.settings.sessionInfo.sound })
  } else if (action.kind === 'stop') {
    void api.turn.stopChecks(runId(paneId)).catch(() => undefined)
    if (action.reason === 'limit') toast(`${view.title} still fails its checks after ${view.pane.care?.rule?.tries ?? 0} tries. Stopped.`, 'info')
  }
}

function feed(paneId: string, event: RuleEvent): void {
  const view = viewOf(paneId)
  const rule = view?.pane.care?.rule
  if (!view || !rule) return
  const step = stepRule(rule, ruleMemoryOf(paneId), event)
  remember(paneId, step.memory)
  perform(view, step.action)
}

function onChecks(update: CheckRunUpdate): void {
  if (!update.sessionId.startsWith(SESSION_PREFIX) || !update.done || !checksFinished(update.results)) return
  const paneId = update.sessionId.slice(SESSION_PREFIX.length)
  const passed = update.results.every((result) => result.status === 'passed')
  feed(paneId, { kind: 'checks-done', passed, output: failureOutput(update.results) })
}

function tick(): void {
  const live = new Set<string>()
  for (const view of derivePanes(store.state)) {
    const paneId = view.pane.id
    live.add(paneId)
    if (!view.pane.care?.rule) {
      if (memories.has(paneId)) {
        memories.delete(paneId)
        void api.turn.stopChecks(runId(paneId)).catch(() => undefined)
        store.patch({})
      }
      continue
    }
    const seen = watching.get(paneId) ?? { sawBusy: false, idleTicks: 0 }
    if (view.status === 'busy') watching.set(paneId, { sawBusy: true, idleTicks: 0 })
    else if (view.status === 'idle' && seen.sawBusy && view.attention !== 'needs') {
      const idleTicks = seen.idleTicks + 1
      if (idleTicks >= SETTLED_TICKS) {
        watching.set(paneId, { sawBusy: false, idleTicks: 0 })
        feed(paneId, { kind: 'turn-finished' })
      } else watching.set(paneId, { ...seen, idleTicks })
    }
  }
  for (const id of [...memories.keys()]) if (!live.has(id)) memories.delete(id)
  for (const id of [...watching.keys()]) if (!live.has(id)) watching.delete(id)
}

/** Runs each session's "when done" rule: after a finished turn, the checks; failures go back to the agent a few times; typing stops it. */
export function installWhenDone(): void {
  api.turn.onChecksUpdate(onChecks)
  onTerminalInput((termId) => {
    if (sending) return
    const pane = store.state.panes.find((candidate) => candidate.tabs.some((tab) => tab.id === termId))
    if (pane?.care?.rule) feed(pane.id, { kind: 'user-input' })
  })
  window.setInterval(tick, TICK_MS)
}
