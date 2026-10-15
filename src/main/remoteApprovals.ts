import {
  editRestriction,
  extractPermissionPrompt,
  pushHistory,
  sanitizeDenyReason,
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

export type ApprovalAnswerResult =
  | { ok: true; reasonSent: boolean }
  | { ok: false; status: 403 | 404 | 409; error: string }

export interface RemoteApprovals {
  snapshot(): Promise<ApprovalsPayload>
  answer(request: ApprovalAnswerRequest): Promise<ApprovalAnswerResult>
  recordDesktopAnswer(terminalId: string, allowed: boolean): Promise<void>
  subscribe(listener: (payload: ApprovalsPayload) => void): () => void
  stop(): void
}

const ALLOW_KEY = '\r'
const DENY_KEY = '\x1b'
const GONE_TIMEOUT_MS = 3000
const GONE_POLL_MS = 100
const SUBMIT_DELAY_MS = 150
const DEFAULT_POLL_MS = 1000

export function createRemoteApprovals(dependencies: ApprovalDependencies): RemoteApprovals {
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const firstSeen = new Map<string, number>()
  const answering = new Set<string>()
  const listeners = new Set<(payload: ApprovalsPayload) => void>()
  let history: ApprovalHistoryEntry[] = []
  let nextEntry = 1
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

  async function promptOf(terminal: RemoteTerminalSnapshot): Promise<ExtractedPrompt | null> {
    const tail = await dependencies.terminals.tail(terminal.id)
    return tail === null ? null : extractPermissionPrompt(tail)
  }

  function itemOf(terminal: RemoteTerminalSnapshot, prompt: ExtractedPrompt): ApprovalItem {
    const project = projectOf(terminal)
    const restriction = editRestriction(prompt.kind, prompt.text, project?.folder ?? null)
    const key = `${terminal.id}:${prompt.fingerprint}`
    if (!firstSeen.has(key)) firstSeen.set(key, now())
    const agent = terminal.agent !== null && isAgent(terminal.agent) ? terminal.agent : 'claude'
    return {
      id: terminal.id,
      projectId: terminal.projectId,
      projectName: project?.name ?? 'Unknown project',
      agent,
      title: `${AGENT_NAMES[agent]} needs you`,
      text: prompt.text,
      kind: prompt.kind,
      summary: prompt.summary,
      fingerprint: prompt.fingerprint,
      since: firstSeen.get(key) ?? now(),
      restriction,
      canAllow: restriction === null || dependencies.getConfig().allowConfigEdits
    }
  }

  async function refresh(): Promise<ApprovalsPayload> {
    const found = await Promise.all(agentTerminals().map(async (terminal) => {
      const prompt = await promptOf(terminal).catch(() => null)
      return prompt ? itemOf(terminal, prompt) : null
    }))
    const items = found.filter((item): item is ApprovalItem => item !== null).sort((a, b) => a.since - b.since)
    const live = new Set(items.map((item) => `${item.id}:${item.fingerprint}`))
    for (const key of [...firstSeen.keys()]) if (!live.has(key)) firstSeen.delete(key)
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

  async function waitUntilGone(terminal: RemoteTerminalSnapshot, fingerprint: string): Promise<boolean> {
    const deadline = now() + GONE_TIMEOUT_MS
    for (;;) {
      const prompt = await promptOf(terminal).catch(() => null)
      if (!prompt || prompt.fingerprint !== fingerprint) return true
      if (now() >= deadline) return false
      await sleep(GONE_POLL_MS)
    }
  }

  async function answer(request: ApprovalAnswerRequest): Promise<ApprovalAnswerResult> {
    const terminal = agentTerminals(request.id)[0]
    if (!terminal) return { ok: false, status: 404, error: 'That session is no longer running.' }
    if (answering.has(request.id)) return { ok: false, status: 409, error: 'That prompt is already being answered.' }
    answering.add(request.id)
    try {
      const prompt = await promptOf(terminal)
      if (!prompt || prompt.fingerprint !== request.fingerprint) {
        return { ok: false, status: 409, error: 'That prompt changed or was already answered. Check the list and try again.' }
      }
      const item = itemOf(terminal, prompt)
      if (request.allow && !item.canAllow) {
        return { ok: false, status: 403, error: 'This edit touches files outside the project or CI and config files. Open Dawsha to allow it.' }
      }
      dependencies.terminals.write(terminal.id, request.allow ? ALLOW_KEY : DENY_KEY)
      const reason = request.allow ? '' : sanitizeDenyReason(request.reason)
      let reasonSent = false
      if (reason && await waitUntilGone(terminal, request.fingerprint)) {
        dependencies.terminals.write(terminal.id, reason)
        await sleep(SUBMIT_DELAY_MS)
        dependencies.terminals.write(terminal.id, ALLOW_KEY)
        reasonSent = true
      }
      record(item, request.allow, 'phone', request.device, reasonSent)
      void poll().catch(() => undefined)
      return { ok: true, reasonSent }
    } finally {
      answering.delete(request.id)
    }
  }

  async function recordDesktopAnswer(terminalId: string, allowed: boolean): Promise<void> {
    const terminal = agentTerminals(terminalId)[0]
    if (!terminal) return
    const prompt = await promptOf(terminal).catch(() => null)
    if (!prompt) return
    record(itemOf(terminal, prompt), allowed, 'desktop', 'This computer', false)
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
    firstSeen.clear()
  }

  return { snapshot: refresh, answer, recordDesktopAnswer, subscribe, stop }
}
