import { mkdirSync, writeFileSync } from 'node:fs'
import { Terminal } from '@xterm/headless'
import { dirname } from 'node:path'
import { ORCH_TOKEN_ENV } from '../../shared/orch/launch'
import { detectLimit, type LimitRunner } from '../../shared/orch/quota'
import { TRUST_DOWN, TRUST_ENTER, trustPromptStep } from '../../shared/orch/trustPrompt'
import type { OrchAgent } from '../../shared/orch/types'
import type { SpawnRequest } from '../../shared/types'
import type { OrchService } from './service'

/** Lines above the visible screen that are still checked for prompts and limit messages. */
const CHECKED_SCROLLBACK = 20
const NUDGE_EVERY_MS = 60_000
const QUIET_BEFORE_NUDGE_MS = 3_000
const SUBMIT_DELAY_MS = 400
const SUBMIT_CHECK_MS = 5_000
const SUBMIT_TRIES = 3
/** A key on the trust menu that changed nothing is repeated after this long, at most TRUST_TRIES times per key. */
const TRUST_RETRY_MS = 1_500
const TRUST_TRIES = 3
/** After the trust prompt, an agent that has not called the orch server by then gets its first message typed. */
const FIRST_MESSAGE_AFTER_MS = 5_000
/**
 * The CLI can drop the starting prompt it was given (a busy start-up hook, bypass mode): an agent that has not
 * called the orch server this long after spawning, with an idle screen, gets its first message typed once.
 */
const FIRST_MESSAGE_FALLBACK_MS = 20_000
/** Shown by Claude Code while it is working on a prompt. */
const BUSY = /esc to interrupt/i
/** A selection menu is on screen (trust, permission, resume...): typed text and Enter would pick an option. */
// Claude: "Enter to confirm · Esc to cancel". Codex: "enter continue · esc quit", "enter to confirm".
const MENU = /enter to confirm|esc to cancel|enter continue|esc quit/i

export interface LaunchExtras {
  args: string[]
  env: Record<string, string>
  /** Whether the CLI resumes its session; false when the agent never connected, so there is none yet. */
  resume: boolean
}

export interface PaneBridgeDeps {
  service: () => OrchService | null
  /** Writes to the pane's terminal. */
  write: (tabId: string, data: string) => void
  /** Options offered when an agent stops (other profiles for its role, "Wait", "Cancel task"). */
  stallOptions: (agent: OrchAgent) => string[]
  /** Minutes of silence on a working task before Dawsha asks whether the agent is stuck. */
  quietMinutes: (agent: OrchAgent) => number
  /** Answer Claude's folder trust prompt for the agent's own worktree (user setting). */
  autoTrust: () => boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => void
}

interface Watched {
  agentId: string
  runner: LimitRunner
  folder: string
  trustAnswered: boolean
  trustDowns: number
  trustEnters: number
  /** When Dawsha last pressed a key on the trust menu. */
  trustKeyAt: number
  /** When the trust menu was first seen; 0 until then. */
  trustSeenAt: number
  startedAt: number
  /** The first message was typed, or the agent no longer needs it. */
  firstMessageDone: boolean
  /** A hidden terminal that renders the pane like the user sees it; detection reads its screen. */
  screen: Terminal
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
      folder: request.cwd,
      trustAnswered: false,
      trustDowns: 0,
      trustEnters: 0,
      trustKeyAt: 0,
      trustSeenAt: 0,
      startedAt: this.now(),
      firstMessageDone: false,
      screen: new Terminal({ cols: Math.max(2, request.cols), rows: Math.max(1, request.rows), scrollback: 200, allowProposedApi: true }),
      lastOutputAt: this.now(),
      lastNudgeAt: 0,
      quietNudged: false,
      limitReported: false
    })
    // An agent that never called the server has no saved conversation: resuming it makes the CLI exit.
    const resume = request.resume && Boolean(agent.lastCallAt)
    return { args: launchArgsFor(agent.launch.args, resume), env: { ...agent.launch.env, [ORCH_TOKEN_ENV]: token }, resume }
  }

  tabOf(agentId: string): string | undefined {
    for (const [tabId, watched] of this.watched) if (watched.agentId === agentId) return tabId
    return undefined
  }

  onOutput(tabId: string, data: string): void {
    const watched = this.watched.get(tabId)
    if (!watched) return
    watched.lastOutputAt = this.now()
    watched.quietNudged = false
    watched.screen.write(data, () => this.inspect(tabId, watched))
  }

  onResize(tabId: string, cols: number, rows: number): void {
    const watched = this.watched.get(tabId)
    if (watched && cols >= 2 && rows >= 1) watched.screen.write('', () => watched.screen.resize(cols, rows))
  }

  /** Resolves once everything written to the pane's hidden screen has been rendered and checked. */
  settle(tabId: string): Promise<void> {
    const watched = this.watched.get(tabId)
    return watched ? new Promise((resolve) => watched.screen.write('', resolve)) : Promise.resolve()
  }

  private screenText(watched: Watched): string {
    const buffer = watched.screen.buffer.active
    const first = Math.max(0, buffer.length - watched.screen.rows - CHECKED_SCROLLBACK)
    const lines: string[] = []
    for (let index = first; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    return lines.join('\n')
  }

  private inspect(tabId: string, watched: Watched): void {
    if (this.watched.get(tabId) !== watched) return
    const text = this.screenText(watched)
    this.answerTrust(tabId, watched, text)
    if (watched.limitReported) return
    const hit = detectLimit(watched.runner, text)
    if (!hit) return
    watched.limitReported = true
    this.stall(watched, hit.resetsAt ? `${hit.message} (resets ${hit.resetsAt})` : hit.message)
  }

  /**
   * Claude and Codex ask whether they may work in the new worktree; with the user's consent, say yes.
   * One key at a time, decided from the rendered screen: Down while the cursor is on "No, exit", Enter only once
   * it is on the trusting option, so a lost key can never make the CLI exit. The menu is drawn a moment before
   * the CLI reads keys, so Dawsha waits after first seeing it and after every key, looks again on its own timer,
   * and repeats a key that changed nothing. The prompt counts as answered only once it is gone.
   */
  private answerTrust(tabId: string, watched: Watched, text: string): void {
    if (watched.trustAnswered || !this.deps.autoTrust()) return
    const step = trustPromptStep(watched.runner, text, watched.folder)
    if (!step) {
      if (watched.trustEnters > 0) watched.trustAnswered = true
      return
    }
    if (!watched.trustSeenAt) {
      watched.trustSeenAt = this.now()
      this.setTimer(() => this.recheckTrust(tabId, watched), TRUST_RETRY_MS)
      return
    }
    if (this.now() - watched.trustSeenAt < TRUST_RETRY_MS || this.now() - watched.trustKeyAt < TRUST_RETRY_MS) return
    if (step === 'down' ? watched.trustDowns >= TRUST_TRIES : watched.trustEnters >= TRUST_TRIES) return
    watched.trustKeyAt = this.now()
    if (step === 'down') {
      watched.trustDowns += 1
      this.deps.write(tabId, TRUST_DOWN)
    } else {
      watched.trustEnters += 1
      this.deps.write(tabId, TRUST_ENTER)
      // The CLI can drop its starting prompt when the trust prompt comes first.
      if (watched.trustEnters === 1) this.setTimer(() => this.deliverFirstMessage(tabId, watched), FIRST_MESSAGE_AFTER_MS)
    }
    this.setTimer(() => this.recheckTrust(tabId, watched), TRUST_RETRY_MS)
  }

  private deliverFirstMessage(tabId: string, watched: Watched): void {
    if (this.watched.get(tabId) !== watched || watched.firstMessageDone) return
    // Never type into a menu; the idle fallback tries again once it is gone.
    // Never type into a menu or over a prompt the CLI is already working on.
    const screen = this.screenText(watched)
    if (MENU.test(screen) || BUSY.test(screen)) return
    watched.firstMessageDone = true
    const agent = this.deps.service()?.agent(watched.agentId)
    const message = agent?.launch?.firstMessage
    if (!agent || agent.retiredAt || agent.lastCallAt || !message) return
    this.type(tabId, message)
  }

  /** Not while a trust menu waits for an answer, and not while the CLI shows it is working. */
  private firstMessageDue(watched: Watched, agent: OrchAgent, now: number): boolean {
    if (agent.lastCallAt) watched.firstMessageDone = true
    if (watched.firstMessageDone || now - watched.startedAt < FIRST_MESSAGE_FALLBACK_MS) return false
    if (watched.trustSeenAt && !watched.trustAnswered) return false
    return !BUSY.test(this.screenText(watched))
  }

  private recheckTrust(tabId: string, watched: Watched): void {
    if (this.watched.get(tabId) === watched && !watched.trustAnswered) this.answerTrust(tabId, watched, this.screenText(watched))
  }

  /** The pane was closed or its CLI exited: the agent is done and its unfinished task goes back. */
  onClosed(tabId: string, reason: string): void {
    const watched = this.watched.get(tabId)
    if (!watched) return
    this.watched.delete(tabId)
    watched.screen.dispose()
    this.deps.service()?.releaseAgent(watched.agentId, reason)
  }

  /** Called every few seconds: nudges agents with unread messages, and asks about long silences. */
  poll(): void {
    const service = this.deps.service()
    if (!service) return
    const now = this.now()
    for (const [tabId, watched] of this.watched) {
      // A Down that arrived before the menu took input changes nothing on screen; look again.
      if (!watched.trustAnswered) this.inspect(tabId, watched)
      const agent = service.agent(watched.agentId)
      if (!agent || agent.retiredAt) continue
      const quietFor = now - watched.lastOutputAt
      if (quietFor < QUIET_BEFORE_NUDGE_MS) continue
      if (MENU.test(this.screenText(watched))) continue
      if (this.firstMessageDue(watched, agent, now)) {
        this.deliverFirstMessage(tabId, watched)
        continue
      }
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
