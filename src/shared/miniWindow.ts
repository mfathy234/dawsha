import type { MiniWindowSettings } from './appearance'
import type { TodoEntry } from './chatCards'
import type { CrewIdentity } from './crew'
import { detectPermissionPrompt, parsePermissionDetail, permissionPromptText } from './permissionPrompt'
import { cleanText } from './remoteChat'
import { outputLines } from './recap'
import { needsAsk } from './sessionLine'
import { sessionState, SESSION_STATE_LABELS, type SessionStateInput, type SessionState } from './sessionState'
import type { TabAgent } from './types'

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
}

export interface MiniSession {
  paneId: string
  agent: TabAgent
  identity: CrewIdentity | null
  title: string
  project: string
  state: SessionState
  line: string
  tail: string[]
  permission: { command: string; prompt: string } | null
  plan: { done: number; total: number; current: string; items: readonly TodoEntry[] } | null
}

export interface MiniSnapshot {
  sessions: MiniSession[]
  folded: boolean
  sound: boolean
  /** Computed theme tokens from the main renderer, including the selected tone. */
  theme: Record<string, string>
  kind: string
}

export type MiniAction =
  | { kind: 'open'; paneId: string }
  | { kind: 'answer'; paneId: string; allow: boolean; prompt: string }
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
  plans(requests: MiniPlanRequest[]): Promise<Record<string, readonly TodoEntry[]>>
}

export interface MiniPlanRequest { paneId: string; agent: 'claude' | 'codex'; sessionId: string; folder: string }

export function isMiniAction(value: unknown): value is MiniAction {
  if (!value || typeof value !== 'object') return false
  const a = value as Record<string, unknown>
  if (['fold', 'sound', 'close', 'new'].includes(String(a.kind))) return Object.keys(a).length === 1
  if (typeof a.paneId !== 'string' || a.paneId.length < 1 || a.paneId.length > 128) return false
  if (a.kind === 'open') return Object.keys(a).length === 2
  return a.kind === 'answer' && typeof a.allow === 'boolean' && typeof a.prompt === 'string' && a.prompt.length <= 12000 && Object.keys(a).length === 4
}

/** Reuses the phone's text limits and the desktop's permission parser and state resolver. */
export function miniSession(input: MiniSessionInput): MiniSession {
  // The main sidebar acknowledges its focused pane; Mini must still show its live request.
  const waiting = input.status !== 'exited' && detectPermissionPrompt(input.tail)
  const state = sessionState({ ...input, attention: waiting ? 'needs' : input.attention })
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
    : state === 'done' ? `Done${changed > 0 ? `, ${changed} file${changed === 1 ? '' : 's'} changed` : ''}`
      : state === 'idle' ? `Idle${input.idleFor ? ` ${input.idleFor}` : ''}`
        : state === 'exited' ? 'Exited' : input.recap || input.tool || progress?.current || SESSION_STATE_LABELS[state]
  return {
    paneId: input.paneId, agent: input.agent, identity: input.identity ?? null,
    title: cleanText(input.title, 240), project: cleanText(input.project, 160), state, line: cleanText(line, 320),
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
