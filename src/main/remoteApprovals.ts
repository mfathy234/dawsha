import {
  editRestriction,
  extractPermissionPrompt,
  hashText,
  pushHistory,
  sanitizeDenyReason,
  type AllowBlock,
  type ApprovalAnswerSource,
  type ApprovalHistoryEntry,
  type ApprovalItem,
  type ApprovalsPayload,
  type ExtractedPrompt
} from '../shared/approvals'
import { AGENT_NAMES, isAgent } from '../shared/agents'
import type { Project } from '../shared/types'
import type { RemoteTerminalSnapshot } from './remoteTerminalState'

export interface ApprovalConfig {
  allowConfigEdits: boolean
  notify: boolean
  onlyWhenAway: boolean
  awayMinutes: number
}

export interface ApprovalDependencies {
  terminals: {
    snapshot(id?: string): RemoteTerminalSnapshot[]
    tail(id: string): Promise<string | null>
    write(id: string, data: string): void
  }
  getProjects(): Project[]
  getConfig(): ApprovalConfig
  idleSeconds(): number
  now?(): number
  sleep?(ms: number): Promise<void>
  pollMs?: number
}

export interface ApprovalAnswerRequest {
  id: string
  fingerprint: string
  allow: boolean
  reason?: unknown
  device: string
}

export type ReasonFailure = 'new-prompt' | 'exited' | 'timeout' | 'unreadable'

export type ApprovalAnswerResult =
  | { ok: true; reasonSent: boolean; reasonFailure?: ReasonFailure }
  | { ok: false; status: 403 | 404 | 409; error: string }

export interface RemoteApprovals {
  snapshot(): Promise<ApprovalsPayload>
  answer(request: ApprovalAnswerRequest): Promise<ApprovalAnswerResult>
  recordDesktopAnswer(terminalId: string, allowed: boolean, tail?: string): Promise<void>
  subscribe(listener: (payload: ApprovalsPayload) => void): () => void
  stop(): void
}

type ClearState = 'clear' | 'new-prompt' | 'exited' | 'unreadable' | 'timeout'

const ALLOW_KEY = '\r'
const DENY_KEY = '\x1b'
const GONE_TIMEOUT_MS = 3000
const GONE_POLL_MS = 100
const SUBMIT_DELAY_MS = 150
const DEFAULT_POLL_MS = 1000
const MAX_DESKTOP_TAIL = 20_000

export const BLOCK_MESSAGES: Record<AllowBlock, string> = {
  config: 'This edit touches files outside the project or CI and config files. Open Dawsha to allow it.',
  'outside-project': 'This edit touches files outside the project or CI and config files. Open Dawsha to allow it.',
  truncated: 'Too long to show here. Open Dawsha to allow it.',
  kind: 'Answer this one on the computer.',
  selection: 'Answer this one on the computer.'
}

interface Tracked {
  hash: string
  sequence: number
  since: number
}

export function createRemoteApprovals(dependencies: ApprovalDependencies): RemoteApprovals {
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const tracked = new Map<string, Tracked>()
  const answering = new Set<string>()
  const listeners = new Set<(payload: ApprovalsPayload) => void>()
  let history: ApprovalHistoryEntry[] = []
  let nextEntry = 1
  let sequence = 0
  let timer: NodeJS.Timeout | null = null
  let lastKey = ''

  function agentTerminals(id?: string): RemoteTerminalSnapshot[] {
    return dependencies.terminals.snapshot(id).filter((terminal) => terminal.agent !== null && terminal.agent !== 'shell')
  }

  function projectOf(terminal: RemoteTerminalSnapshot): Project | null {
    return dependencies.getProjects().find((project) => project.id === terminal.projectId) ?? null
  }

  function notifyAllowed(): boolean {
    const config = dependencies.getConfig()
    return config.notify && (!config.onlyWhenAway || dependencies.idleSeconds() >= config.awayMinutes * 60)
  }

  async function promptOf(terminal: RemoteTerminalSnapshot): Promise<ExtractedPrompt | null | undefined> {
    const tail = await dependencies.terminals.tail(terminal.id)
    return tail === null ? undefined : extractPermissionPrompt(tail)
  }

  function track(terminalId: string, hash: string): Tracked {
    const existing = tracked.get(terminalId)
    if (existing && existing.hash === hash) return existing
    const next = { hash, sequence: ++sequence, since: now() }
    tracked.set(terminalId, next)
    return next
  }

  function allowBlockOf(prompt: ExtractedPrompt, restriction: ApprovalItem['restriction']): AllowBlock | null {
    if (prompt.truncated) return 'truncated'
    if (prompt.kind === 'other') return 'kind'
    if (prompt.selected !== 'allow-once') return 'selection'
    if (restriction && !dependencies.getConfig().allowConfigEdits) return restriction
    return null
  }

  function itemOf(terminal: RemoteTerminalSnapshot, prompt: ExtractedPrompt): ApprovalItem {
    const project = projectOf(terminal)
    const restriction = editRestriction(prompt.kind, prompt.text, project?.folder ?? null)
    const entry = track(terminal.id, prompt.fingerprint)
    const agent = terminal.agent !== null && isAgent(terminal.agent) ? terminal.agent : 'claude'
    const allowBlock = allowBlockOf(prompt, restriction)
    return {
      id: terminal.id,
      projectId: terminal.projectId,
      projectName: project?.name ?? 'Unknown project',
      agent,
      title: `${AGENT_NAMES[agent]} needs you`,
      text: prompt.text,
      kind: prompt.kind,
      summary: prompt.summary,
      fingerprint: hashText(`${prompt.fingerprint}:${entry.sequence}`),
      since: entry.since,
      restriction,
      allowBlock,
      canAllow: allowBlock === null
    }
  }

  async function refresh(): Promise<ApprovalsPayload> {
    const found = await Promise.all(agentTerminals().map(async (terminal) => {
      const prompt = await promptOf(terminal).catch(() => undefined)
      if (!prompt) {
        if (prompt === null) tracked.delete(terminal.id)
        return null
      }
      return itemOf(terminal, prompt)
    }))
    const live = new Set(agentTerminals().map((terminal) => terminal.id))
    for (const id of [...tracked.keys()]) if (!live.has(id)) tracked.delete(id)
    const items = found.filter((item): item is ApprovalItem => item !== null).sort((a, b) => a.since - b.since)
    return { items, history, notify: notifyAllowed() }
  }

  function payloadKey(payload: ApprovalsPayload): string {
    return JSON.stringify([payload.items.map((item) => [item.id, item.fingerprint, item.canAllow]), payload.history[0]?.id ?? null, payload.notify])
  }

  async function poll(): Promise<void> {
    const payload = await refresh()
    const key = payloadKey(payload)
    if (key === lastKey) return
    lastKey = key
    for (const listener of [...listeners]) {
      try { listener(payload) } catch { /* a remote client must not stop approval polling */ }
    }
  }

  function record(item: Pick<ApprovalItem, 'summary' | 'kind' | 'agent' | 'projectName'>, allowed: boolean, source: ApprovalAnswerSource, device: string, reason: boolean): void {
    history = pushHistory(history, {
      id: String(nextEntry++),
      time: now(),
      allowed,
      summary: item.summary,
      kind: item.kind,
      agent: item.agent,
      projectName: item.projectName,
      source,
      device,
      reason
    })
  }

  async function waitUntilClear(terminal: RemoteTerminalSnapshot, original: string): Promise<ClearState> {
    const deadline = now() + GONE_TIMEOUT_MS
    for (;;) {
      if (!agentTerminals(terminal.id).length) return 'exited'
      const prompt = await promptOf(terminal).catch(() => undefined)
      if (prompt === undefined) return agentTerminals(terminal.id).length ? 'unreadable' : 'exited'
      if (prompt === null) return 'clear'
      if (prompt.fingerprint !== original) return 'new-prompt'
      if (now() >= deadline) return 'timeout'
      await sleep(GONE_POLL_MS)
    }
  }

  async function screenState(terminal: RemoteTerminalSnapshot): Promise<ClearState> {
    if (!agentTerminals(terminal.id).length) return 'exited'
    const prompt = await promptOf(terminal).catch(() => undefined)
    if (prompt === undefined) return 'unreadable'
    return prompt === null ? 'clear' : 'new-prompt'
  }

  async function sendReason(terminal: RemoteTerminalSnapshot, original: string, reason: string): Promise<ReasonFailure | null> {
    const before = await waitUntilClear(terminal, original)
    if (before !== 'clear') return before
    dependencies.terminals.write(terminal.id, reason)
    await sleep(SUBMIT_DELAY_MS)
    const after = await screenState(terminal)
    if (after !== 'clear') return after
    dependencies.terminals.write(terminal.id, ALLOW_KEY)
    return null
  }

  async function answer(request: ApprovalAnswerRequest): Promise<ApprovalAnswerResult> {
    const terminal = agentTerminals(request.id)[0]
    if (!terminal) return { ok: false, status: 404, error: 'That session is no longer running.' }
    if (answering.has(request.id)) return { ok: false, status: 409, error: 'That prompt is already being answered.' }
    answering.add(request.id)
    try {
      const prompt = await promptOf(terminal)
      if (!prompt) return { ok: false, status: 409, error: 'That prompt changed or was already answered. Check the list and try again.' }
      const item = itemOf(terminal, prompt)
      if (item.fingerprint !== request.fingerprint) {
        return { ok: false, status: 409, error: 'That prompt changed or was already answered. Check the list and try again.' }
      }
      if (request.allow && item.allowBlock) return { ok: false, status: 403, error: BLOCK_MESSAGES[item.allowBlock] }
      dependencies.terminals.write(terminal.id, request.allow ? ALLOW_KEY : DENY_KEY)
      tracked.delete(terminal.id)
      const reason = request.allow ? '' : sanitizeDenyReason(request.reason)
      let failure: ReasonFailure | null = null
      if (reason) failure = await sendReason(terminal, prompt.fingerprint, reason)
      record(item, request.allow, 'phone', request.device, Boolean(reason) && failure === null)
      void poll().catch(() => undefined)
      return failure ? { ok: true, reasonSent: false, reasonFailure: failure } : { ok: true, reasonSent: Boolean(reason) }
    } finally {
      answering.delete(request.id)
    }
  }

  async function recordDesktopAnswer(terminalId: string, allowed: boolean, tail?: string): Promise<void> {
    const terminal = agentTerminals(terminalId)[0]
    if (!terminal) return
    const prompt = typeof tail === 'string' && tail.length <= MAX_DESKTOP_TAIL
      ? extractPermissionPrompt(tail)
      : await promptOf(terminal).catch(() => undefined)
    if (!prompt) return
    record(itemOf(terminal, prompt), allowed, 'desktop', 'This computer', false)
    tracked.delete(terminalId)
    void poll().catch(() => undefined)
  }

  function subscribe(listener: (payload: ApprovalsPayload) => void): () => void {
    listeners.add(listener)
    if (!timer) {
      lastKey = ''
      timer = setInterval(() => void poll().catch(() => undefined), dependencies.pollMs ?? DEFAULT_POLL_MS)
      timer.unref()
    }
    void poll().catch(() => undefined)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null }
    }
  }

  function stop(): void {
    listeners.clear()
    if (timer) { clearInterval(timer); timer = null }
    tracked.clear()
  }

  return { snapshot: refresh, answer, recordDesktopAnswer, subscribe, stop }
}
