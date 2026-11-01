import type { ToolKind } from './chatKind'
import type { TabAgent } from './types'

export type ChatView = 'terminal' | 'chat'

export const DEFAULT_CHAT_VIEW: ChatView = 'terminal'
export const CHAT_VIEWS_MAX = 500
export const CHAT_ITEMS_MAX = 300
export const CHAT_MESSAGE_MAX = 24_000
export const CHAT_OUTPUT_MAX = 6_000
export const CHAT_OUTPUT_LINES = 80
export const CHAT_TARGET_MAX = 240

const CHAT_AGENTS: readonly TabAgent[] = ['claude', 'codex']

export const isChatView = (value: unknown): value is ChatView => value === 'terminal' || value === 'chat'

/** Only Claude and Codex have a reader for their session log; Gemini and shells stay terminals. */
export const chatCapable = (agent: TabAgent | null | undefined): boolean => agent !== null && agent !== undefined && CHAT_AGENTS.includes(agent)

export const chatViewKey = (agent: TabAgent, sessionId: string): string => `${agent}:${sessionId}`

export interface ChatViewChoice {
  agent: TabAgent
  tabView?: ChatView
  remembered?: ChatView
  fallback: ChatView
}

/** The view a session opens in: its own choice, then what it remembered, then the default; never Chat for an agent without a reader. */
export function resolveChatView(choice: ChatViewChoice): ChatView {
  if (!chatCapable(choice.agent)) return 'terminal'
  return choice.tabView ?? choice.remembered ?? choice.fallback
}

export type ChatAgent = 'claude' | 'codex'
export type SessionViews = Record<ChatAgent, ChatView>

/** The view new sessions of an agent open in; Gemini and shells have no chat to open in. */
export const defaultViewFor = (views: SessionViews, agent: TabAgent): ChatView => (agent === 'claude' || agent === 'codex' ? views[agent] : DEFAULT_CHAT_VIEW)

/** Each agent's default view; an older single default fills any agent that has none of its own. */
export function sanitizeSessionViews(value: unknown, legacy?: unknown): SessionViews {
  const own = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const pick = (agent: ChatAgent): ChatView => (isChatView(own[agent]) ? own[agent] : isChatView(legacy) ? legacy : DEFAULT_CHAT_VIEW)
  return { claude: pick('claude'), codex: pick('codex') }
}

export function sanitizeChatViews(value: unknown): Record<string, ChatView> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, ChatView] => /^(claude|codex):[\w-]{1,100}$/.test(entry[0]) && isChatView(entry[1])
  )
  return Object.fromEntries(entries.slice(-CHAT_VIEWS_MAX))
}

export function rememberChatView(views: Readonly<Record<string, ChatView>>, key: string, view: ChatView): Record<string, ChatView> {
  if (views[key] === view) return { ...views }
  const without = Object.entries(views).filter(([name]) => name !== key)
  return Object.fromEntries([...without, [key, view]].slice(-CHAT_VIEWS_MAX))
}

export interface ChatMessage {
  kind: 'message'
  id: string
  role: 'user' | 'agent'
  text: string
  at?: number
}

export interface ChatTool {
  kind: 'tool'
  id: string
  activity: ToolKind
  verb: string
  target: string
  added?: number
  removed?: number
  note?: string
  output: string
  outputTruncated: boolean
  failed?: boolean
  done: boolean
  at?: number
}

export type ChatNoticeKind = 'limit' | 'error' | 'interrupted'

export interface ChatNotice {
  kind: 'notice'
  id: string
  notice: ChatNoticeKind
  text: string
  resetsAt?: number
  at?: number
}

export type ChatItem = ChatMessage | ChatTool | ChatNotice

export interface ChatReadRequest {
  agent: TabAgent
  sessionId: string
  folder: string
  version?: string
}

export type ChatReadResult =
  | { status: 'ok'; items: ChatItem[]; version: string; earlier: number }
  | { status: 'unchanged' }
  | { status: 'no-session' }
  | { status: 'failed'; reason: string }

export interface ChatReleaseRequest {
  agent: TabAgent
  sessionId: string
}

export interface ChatApi {
  read(request: ChatReadRequest): Promise<ChatReadResult>
  release(request: ChatReleaseRequest): Promise<void>
}

export const CHAT_IPC = {
  read: 'chat:read',
  release: 'chat:release'
} as const

export interface Bounded {
  text: string
  truncated: boolean
}

/** Cuts text to a number of characters and lines, so a huge tool output or message cannot freeze the page. */
export function boundText(text: string, maxChars: number, maxLines = Number.POSITIVE_INFINITY): Bounded {
  let lines = text.split('\n')
  let truncated = false
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    truncated = true
  }
  let out = lines.join('\n')
  if (out.length > maxChars) {
    out = out.slice(0, maxChars)
    truncated = true
  }
  return { text: truncated ? `${out.trimEnd()}\n…` : out, truncated }
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR = /[A-Za-zÀ-ɏ]/

/** The direction of the first strong character, so an Arabic message sets right to left and an English one left to right. */
export function textDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (RTL.test(char)) return 'rtl'
    if (LTR.test(char)) return 'ltr'
  }
  return 'ltr'
}

/** Short message previews fold by lines; longer ones show a start and offer the rest. */
export const FOLD_LINES = 14

export function foldLines(text: string, limit = FOLD_LINES): { head: string; hidden: number } {
  const lines = text.split('\n')
  if (lines.length <= limit) return { head: text, hidden: 0 }
  return { head: lines.slice(0, limit).join('\n'), hidden: lines.length - limit }
}

export type ChatPhase = 'empty' | 'working' | 'approval' | 'menu' | 'limit' | 'done'

export interface ChatPhaseInput {
  items: readonly ChatItem[]
  working: boolean
  needsApproval: boolean
  /** The terminal shows a menu or picker that chat cannot draw. */
  menuOpen?: boolean
}

/** What the thread says about the session right now. A working session keeps its indicator until the reply has landed. */
export function chatPhase(input: ChatPhaseInput): ChatPhase {
  if (input.needsApproval) return 'approval'
  if (input.menuOpen) return 'menu'
  const last = input.items[input.items.length - 1]
  if (last?.kind === 'notice' && last.notice === 'limit' && !input.working) return 'limit'
  if (input.working) return 'working'
  return last ? 'done' : 'empty'
}
