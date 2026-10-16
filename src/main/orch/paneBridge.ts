import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ORCH_TOKEN_ENV } from '../../shared/orch/launch'
import { detectLimit, type LimitRunner } from '../../shared/orch/quota'
import type { OrchAgent } from '../../shared/orch/types'
import type { SpawnRequest } from '../../shared/types'
import type { OrchService } from './service'

const TAIL_CHARS = 4000
const NUDGE_EVERY_MS = 60_000
const QUIET_BEFORE_NUDGE_MS = 3_000
const SUBMIT_DELAY_MS = 400
const SUBMIT_CHECK_MS = 5_000
const SUBMIT_TRIES = 3

export interface LaunchExtras {
  args: string[]
  env: Record<string, string>
}

export interface PaneBridgeDeps {
  service: () => OrchService | null
  /** Writes to the pane's terminal. */
  write: (tabId: string, data: string) => void
  /** Options offered when an agent stops (other profiles for its role, "Wait", "Cancel task"). */
  stallOptions: (agent: OrchAgent) => string[]
  /** Minutes of silence on a working task before Dawsha asks whether the agent is stuck. */
  quietMinutes: (agent: OrchAgent) => number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => void
}

interface Watched {
  agentId: string
  runner: LimitRunner
  tail: string
  lastOutputAt: number
  lastNudgeAt: number
  quietNudged: boolean
  limitReported: boolean
}

const runnerOf = (agent: OrchAgent): LimitRunner => agent.runner.replace(/-local$/, '') as LimitRunner

/** Removes `--session-id <id>` when the pane resumes: the CLI then gets its resume flag instead. */
export function launchArgsFor(args: readonly string[], resume: boolean): string[] {
  if (!resume) return [...args]
  const index = args.indexOf('--session-id')
  return index < 0 ? [...args] : [...args.slice(0, index), ...args.slice(index + 2)]
}

/**
 * Connects orchestrator agents to their Dawsha panes: launch extras and a fresh token at spawn,
 * quota and silence detection from output, release on close, and nudges typed into the pane.
 */
export class OrchPaneBridge {
  private readonly watched = new Map<string, Watched>()
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => void

  constructor(private readonly deps: PaneBridgeDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => void setTimeout(fn, ms))
  }

  /** Extras for an orchestrated spawn, or an error to show in the pane. Plain spawns return null. */
  prepare(request: SpawnRequest): LaunchExtras | { error: string } | null {
    if (!request.orchAgentId) return null
    const service = this.deps.service()
    const agent = service?.agent(request.orchAgentId)
    if (!service || !agent || agent.retiredAt || !agent.launch) {
      return { error: 'This orchestrator agent has finished or the orchestrator is off. You can close this pane.' }
    }
    for (const file of agent.launch.files) {
      mkdirSync(dirname(file.path), { recursive: true })
      writeFileSync(file.path, file.content, 'utf8')
    }
    const token = service.rotateToken(agent.id)
    this.watched.set(request.id, {
      agentId: agent.id,
      runner: runnerOf(agent),
      tail: '',
      lastOutputAt: this.now(),
      lastNudgeAt: 0,
      quietNudged: false,
      limitReported: false
    })
    return { args: launchArgsFor(agent.launch.args, request.resume), env: { ...agent.launch.env, [ORCH_TOKEN_ENV]: token } }
  }

  tabOf(agentId: string): string | undefined {
    for (const [tabId, watched] of this.watched) if (watched.agentId === agentId) return tabId
    return undefined
  }

  onOutput(tabId: string, data: string): void {
    const watched = this.watched.get(tabId)
    if (!watched) return
    watched.tail = (watched.tail + data).slice(-TAIL_CHARS)
    watched.lastOutputAt = this.now()
    watched.quietNudged = false
    if (watched.limitReported) return
    const hit = detectLimit(watched.runner, watched.tail)
    if (!hit) return
    watched.limitReported = true
    this.stall(watched, hit.resetsAt ? `${hit.message} (resets ${hit.resetsAt})` : hit.message)
  }

  /** The pane was closed or its CLI exited: the agent is done and its unfinished task goes back. */
  onClosed(tabId: string, reason: string): void {
    const watched = this.watched.get(tabId)
    if (!watched) return
    this.watched.delete(tabId)
    this.deps.service()?.releaseAgent(watched.agentId, reason)
  }

  /** Called every few seconds: nudges agents with unread messages, and asks about long silences. */
  poll(): void {
    const service = this.deps.service()
    if (!service) return
    const now = this.now()
    for (const [tabId, watched] of this.watched) {
      const agent = service.agent(watched.agentId)
      if (!agent || agent.retiredAt) continue
      const quietFor = now - watched.lastOutputAt
      if (quietFor < QUIET_BEFORE_NUDGE_MS) continue
      if (service.unreadCount(agent.id) > 0 && now - watched.lastNudgeAt >= NUDGE_EVERY_MS) {
        watched.lastNudgeAt = now
        this.type(tabId, 'Dawsha: you have new messages. Call fetch_inbox, then continue your task.')
        continue
      }
      this.checkSilence(tabId, watched, agent, quietFor)
    }
  }

  private checkSilence(tabId: string, watched: Watched, agent: OrchAgent, quietFor: number): void {
    const limit = this.deps.quietMinutes(agent) * 60_000
    const working = this.deps.service()?.activeTask(agent.id)?.status === 'in_progress'
    if (!working || quietFor < limit) return
    if (!watched.quietNudged) {
      watched.quietNudged = true
      watched.lastOutputAt = this.now() - limit / 2
      this.type(tabId, 'Dawsha: are you still working? If you are done, call complete_task; if you are stuck, call ask_human.')
      return
    }
    this.stall(watched, `No output for ${Math.round(quietFor / 60_000)} minutes`)
  }

  private stall(watched: Watched, message: string): void {
    const service = this.deps.service()
    const agent = service?.agent(watched.agentId)
    if (!service || !agent || !service.activeTask(agent.id)) return
    service.reportStall(agent.id, message, this.deps.stallOptions(agent))
  }

  /**
   * Types a line into the pane, then presses Enter. Typing echoes, so success is judged by output after
   * Enter: while the pane stays silent after a press, Enter is pressed again (at most SUBMIT_TRIES times).
   */
  type(tabId: string, text: string): void {
    this.deps.write(tabId, text)
    const press = (attempt: number): void => {
      if (!this.watched.has(tabId)) return
      const pressedAt = this.now()
      this.deps.write(tabId, '\r')
      if (attempt >= SUBMIT_TRIES) return
      this.setTimer(() => {
        const watched = this.watched.get(tabId)
        if (watched && watched.lastOutputAt <= pressedAt) press(attempt + 1)
      }, SUBMIT_CHECK_MS)
    }
    this.setTimer(() => press(1), SUBMIT_DELAY_MS)
  }
}
