import type { MiniWindowSettings } from './appearance'
import type { TodoEntry } from './chatCards'
import type { CrewIdentity } from './crew'
import { detectPermissionPrompt, parsePermissionDetail, permissionPromptText } from './permissionPrompt'
import { cleanText } from './remoteChat'
import { doneLine, filesLabel, MINI_SEND_MAX, nowLine, usageLine, type MiniChanges, type MiniLogRead } from './miniDetail'
import { MINI_START_MAX, isAgentKind, type MiniStartOptions } from './miniStart'
import { outputLines } from './recap'
import { needsAsk } from './sessionLine'
import { sessionState, SESSION_STATE_LABELS, type SessionStateInput, type SessionState } from './sessionState'
import type { AgentKind, TabAgent } from './types'

export const MINI_IPC = {
  toggle: 'mini:toggle', publish: 'mini:publish', snapshot: 'mini:snapshot', get: 'mini:get',
  action: 'mini:action', resize: 'mini:resize', visibility: 'mini:visibility', bounds: 'mini:bounds', plans: 'mini:plans'
} as const

export type MiniBounds = NonNullable<MiniWindowSettings['bounds']>
export interface MiniSessionInput extends SessionStateInput {
  paneId: string
  agent: TabAgent
  title: string
  project: string
  identity?: CrewIdentity | null
  tail: string
  recap: string
  tool: string
  idleFor: string
  changed: number | null
  todos: readonly TodoEntry[]
  plan?: { done: number; total: number; current: string } | null
  /** How long the session has been in its state, as spanShort says it. */
  elapsed?: string
  asked?: string
  reply?: readonly string[]
  changes?: MiniChanges | null
  context?: number | null
  costUsd?: number | null
  /** Set for a short while after a run of work finished: how long it took. */
  moment?: { took: string } | null
}

export interface MiniSession {
  paneId: string
  agent: TabAgent
  identity: CrewIdentity | null
  title: string
  project: string
  state: SessionState
  line: string
  /** What the agent is doing right now, in words. */
  now: string
  asked: string
  reply: string[]
  changes: MiniChanges | null
  usage: string
  /** Work just finished: the card offers Review for a while. */
  fresh: boolean
  tail: string[]
  permission: { command: string; prompt: string } | null
  plan: { done: number; total: number; current: string; items: readonly TodoEntry[] } | null
}

export interface MiniSnapshot {
  sessions: MiniSession[]
  folded: boolean
  sound: boolean
  /** What the start form offers. */
  start: MiniStartOptions
  /** Computed theme tokens from the main renderer, including the selected tone. */
  theme: Record<string, string>
  kind: string
}

export type MiniAction =
  | { kind: 'open'; paneId: string }
  | { kind: 'answer'; paneId: string; allow: boolean; prompt: string }
  | { kind: 'review'; paneId: string }
  | { kind: 'send'; paneId: string; text: string }
  | { kind: 'start'; projectId: string; agent: AgentKind; text: string }
  | { kind: 'fold' | 'sound' | 'close' | 'new' }

export interface MiniApi {
  get(): Promise<MiniSnapshot | null>
  onSnapshot(listener: (snapshot: MiniSnapshot) => void): () => void
  action(action: MiniAction): void
  resize(height: number): void
}

export interface MiniHostApi {
  toggle(): void
  publish(snapshot: MiniSnapshot): void
  onAction(listener: (action: MiniAction) => void): () => void
  onVisibility(listener: (visible: boolean) => void): () => void
  onBounds(listener: (bounds: MiniBounds) => void): () => void
  plans(requests: MiniPlanRequest[]): Promise<Record<string, MiniLogRead>>
}

export interface MiniPlanRequest { paneId: string; agent: 'claude' | 'codex'; sessionId: string; folder: string }

export function isMiniAction(value: unknown): value is MiniAction {
  if (!value || typeof value !== 'object') return false
  const a = value as Record<string, unknown>
  if (['fold', 'sound', 'close', 'new'].includes(String(a.kind))) return Object.keys(a).length === 1
  if (a.kind === 'start') {
    return typeof a.projectId === 'string' && a.projectId.length > 0 && a.projectId.length <= 128 && isAgentKind(a.agent) &&
      typeof a.text === 'string' && a.text.length <= MINI_START_MAX && Object.keys(a).length === 4
  }
  if (typeof a.paneId !== 'string' || a.paneId.length < 1 || a.paneId.length > 128) return false
  if (a.kind === 'open' || a.kind === 'review') return Object.keys(a).length === 2
  if (a.kind === 'send') return typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= MINI_SEND_MAX && Object.keys(a).length === 3
  return a.kind === 'answer' && typeof a.allow === 'boolean' && typeof a.prompt === 'string' && a.prompt.length <= 12000 && Object.keys(a).length === 4
}

/** Reuses the phone's text limits and the desktop's permission parser and state resolver. */
export function miniStateOf(input: SessionStateInput & { tail: string }): { state: SessionState; waiting: boolean } {
  // The main sidebar acknowledges its focused pane; Mini must still show its live request.
  const waiting = input.status !== 'exited' && detectPermissionPrompt(input.tail)
  return { state: sessionState({ ...input, attention: waiting ? 'needs' : input.attention }), waiting }
}

export function miniSession(input: MiniSessionInput): MiniSession {
  const { state, waiting } = miniStateOf(input)
  const detail = parsePermissionDetail(input.tail)
  const ask = needsAsk(detail, permissionPromptText(input.tail))
  const items = input.todos.slice(0, 60).map(todo => ({ ...todo, text: cleanText(todo.text, 240) }))
  const progress = items.length ? {
    done: items.filter(todo => todo.status === 'completed').length,
    total: items.length,
    current: items.find(todo => todo.status === 'in_progress')?.text ?? items.find(todo => todo.status !== 'completed')?.text ?? ''
  } : input.plan
  const changed = input.changed ?? 0
  const line = state === 'needs' ? ask || 'Needs you'
    : state === 'done' ? input.moment ? doneLine(input.moment.took, changed) : `Done${changed > 0 ? `, ${filesLabel(changed)} changed` : ''}`
      : state === 'idle' ? `Idle${input.idleFor ? ` ${input.idleFor}` : ''}`
        : state === 'exited' ? 'Exited' : input.recap || input.tool || progress?.current || SESSION_STATE_LABELS[state]
  return {
    paneId: input.paneId, agent: input.agent, identity: input.identity ?? null,
    title: cleanText(input.title, 240), project: cleanText(input.project, 160), state, line: cleanText(line, 320),
    now: cleanText(nowLine({ state, ask, tool: input.tool, step: progress?.current ?? '', elapsed: input.elapsed ?? '' }), 320),
    asked: cleanText(input.asked ?? '', 420), reply: (input.reply ?? []).slice(0, 3).map(text => cleanText(text, 220)),
    changes: input.changes && input.changes.files > 0 ? input.changes : null,
    usage: usageLine(input.context ?? null, input.costUsd ?? null), fresh: !!input.moment && changed > 0,
    tail: outputLines(input.tail, 3).map(line => cleanText(line, 600)),
    permission: waiting ? { command: cleanText(detail.target, 2000), prompt: input.tail.slice(-12000) } : null,
    plan: progress && progress.total > 0 ? { ...progress, items } : null
  }
}

export function orderMiniSessions(sessions: readonly MiniSession[]): MiniSession[] {
  const rank = (state: SessionState): number => state === 'needs' ? 0 : state === 'working' ? 1 : 2
  return [...sessions].sort((a, b) => rank(a.state) - rank(b.state))
}

/** A refused update is not marked sent, so the next tick publishes the newest trailing value. */
export function createMiniSnapshotGate(): { take(value: unknown, now: number): boolean } {
  let last = ''
  let at = -Infinity
  return { take(value, now) {
    if (now - at < 250) return false
    const next = JSON.stringify(value)
    if (next === last) return false
    last = next
    at = now
    return true
  } }
}

/** Place on a real work area, keeping the whole header reachable after monitor changes. */
export function miniBounds(saved: MiniBounds | null, areas: readonly MiniBounds[], main: MiniBounds): MiniBounds {
  const area = saved && areas.find(a => saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y)
  const target = area || main
  const width = Math.min(Math.max(300, area && saved ? saved.width : 360), target.width)
  const height = Math.min(Math.max(52, area && saved ? saved.height : 480), 640, target.height)
  const x = area && saved ? Math.min(Math.max(target.x, saved.x), target.x + target.width - width) : target.x + target.width - width - 16
  const y = area && saved ? Math.min(Math.max(target.y, saved.y), target.y + target.height - height) : target.y + target.height - height - 16
  return { x: Math.max(target.x, x), y: Math.max(target.y, y), width, height }
}

/** Preserve the bottom anchor as content grows or folds, without moving off-screen test windows. */
export function miniContentBounds(previous: MiniBounds, contentHeight: number, area: MiniBounds, offscreen = false): MiniBounds {
  const height = Math.min(640, area.height, Math.max(52, Math.ceil(contentHeight)))
  const y = offscreen ? previous.y : Math.max(area.y, Math.min(previous.y + previous.height - height, area.y + area.height - height - 16))
  return { ...previous, y, height }
}
