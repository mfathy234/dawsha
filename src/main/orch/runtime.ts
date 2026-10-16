import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OrchDecisionView, OrchHandoffInput, OrchPaneRequest, OrchResult, OrchRunView, OrchSnapshot, OrchStartInput, OrchStatus } from '../../shared/orch/api'
import { DEFAULT_PLAN_ID, priceLookupFor, type OrchSettings } from '../../shared/orch/profiles'
import type { OrchAgent } from '../../shared/orch/types'
import type { RunUsage } from '../../shared/orch/usage'
import type { SpawnRequest, StatusInfo } from '../../shared/types'
import { Dispatcher } from './dispatcher'
import { startOrchMcpServer, type OrchMcpServer } from './mcpServer'
import { OrchPaneBridge, type LaunchExtras } from './paneBridge'
import { OrchService } from './service'
import { buildSnapshot } from './snapshot'
import { OrchStore } from './store'
import { OrchUsageCollector, type UsageSourceInfo } from './usageCollector'
import * as worktrees from './worktrees'

const POLL_MS = 5_000
const USAGE_MS = 30_000
const MAX_STALL_CHOICES = 4
const NOTIFY_MS = 250

export interface OrchRuntimeDeps {
  dbPath: string
  /** Per-agent config files (MCP configs) live under here. */
  configRoot: string
  version: string
  log: (message: string) => void
  settings: () => OrchSettings
  projectFolder: (projectId: string) => string | null
  writePty: (tabId: string, data: string) => void
  openPane: (request: OrchPaneRequest) => void
  closePane: (agentId: string) => void
  /** Something changed: the renderer should fetch a new snapshot. */
  changed: () => void
}

/** Owns the orchestrator for the life of the app (experimental feature): store, server, dispatcher, panes. */
export class OrchRuntime {
  private store: OrchStore | null = null
  private server: OrchMcpServer | null = null
  private starting: Promise<OrchMcpServer> | null = null
  private dispatcher: Dispatcher | null = null
  private timers: NodeJS.Timeout[] = []
  private readonly sources = new Map<string, UsageSourceInfo>()
  private readonly collector = new OrchUsageCollector()
  private readonly bridge: OrchPaneBridge
  service: OrchService | null = null

  constructor(private readonly deps: OrchRuntimeDeps) {
    this.bridge = new OrchPaneBridge({
      service: () => this.service,
      write: deps.writePty,
      stallOptions: (agent) => this.stallOptions(agent),
      quietMinutes: (agent) => this.planOf(agent.runId).taskMinutes,
      autoTrust: () => this.deps.settings().autoTrust
    })
  }

  get running(): boolean {
    return this.server !== null
  }

  start(): Promise<OrchMcpServer> {
    if (this.server) return Promise.resolve(this.server)
    if (!this.starting) this.starting = this.open().finally(() => (this.starting = null))
    return this.starting
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined)
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    const server = this.server
    this.server = null
    this.service = null
    this.dispatcher = null
    if (server) await server.close()
    this.store?.close()
    this.store = null
  }

  // ---- Spawn and pane events (from the pty layer) ----

  /** Extras for an orchestrated spawn; null for ordinary panes. */
  prepareSpawn(request: SpawnRequest): LaunchExtras | { error: string } | null {
    if (!request.orchAgentId) return null
    if (!this.service) return { error: 'The orchestrator is off. Turn it on in Settings → Experimental, then reopen this pane.' }
    const extras = this.bridge.prepare(request)
    const agent = this.service.agent(request.orchAgentId)
    if (extras && !('error' in extras) && agent?.launch) {
      this.sources.set(agent.id, {
        agentId: agent.id,
        runner: agent.launch.agent,
        cwd: request.cwd,
        sessionId: request.sessionId ?? null,
        startedAt: Date.now()
      })
    }
    return extras
  }

  onOutput(tabId: string, data: string): void {
    this.bridge.onOutput(tabId, data)
  }

  onEnd(tabId: string, reason: string): void {
    this.bridge.onClosed(tabId, reason)
  }

  onResize(tabId: string, cols: number, rows: number): void {
    this.bridge.onResize(tabId, cols, rows)
  }

  onStatus(infos: readonly StatusInfo[]): void {
    for (const info of infos) if (typeof info.costUsd === 'number') this.collector.setReportedCost(info.sessionId, info.costUsd)
  }

  // ---- Renderer requests ----

  startRun(input: OrchStartInput): OrchResult<string> {
    const service = this.service
    if (!service) return { ok: false, error: 'The orchestrator is off. Turn it on in Settings → Experimental.' }
    const folder = this.deps.projectFolder(input.projectId)
    if (!folder) return { ok: false, error: 'That project no longer exists.' }
    if (!input.story.trim()) return { ok: false, error: input.kind === 'bug' ? 'Describe the bug first.' : 'Write the user story first.' }
    const plan = this.deps.settings().plans.find((p) => p.id === input.planId)
    const run = service.startRun({
      kind: input.kind,
      projectPath: folder,
      projectId: input.projectId,
      title: input.title.trim() || input.story.trim().split(/\r?\n/)[0].slice(0, 80),
      story: input.story.trim(),
      plan: plan?.id ?? DEFAULT_PLAN_ID,
      specApproval: plan?.specApproval ?? true,
      fixerProfileId: input.fixerProfileId
    })
    return { ok: true, value: run.id }
  }

  snapshot(status: OrchStatus): OrchSnapshot {
    return buildSnapshot(this.service, priceLookupFor(this.deps.settings()), status)
  }

  runs(): OrchRunView[] {
    return this.snapshot({ enabled: true, running: this.running, error: null }).runs.map(({ id, kind, title, stage, projectId, createdAt, taskCount, tasksDone, openDecisions }) =>
      ({ id, kind, title, stage, projectId, createdAt, taskCount, tasksDone, openDecisions }))
  }

  decisions(): OrchDecisionView[] {
    return this.snapshot({ enabled: true, running: this.running, error: null }).decisions
  }

  /** The human picked another profile for a task ("Continue with…"). */
  async handoff(input: OrchHandoffInput): Promise<OrchResult> {
    if (!this.dispatcher) return { ok: false, error: 'The orchestrator is off.' }
    const profile = this.deps.settings().profiles.find((p) => p.id === input.profileId)
    if (!profile) return { ok: false, error: 'That profile no longer exists.' }
    try {
      await this.dispatcher.handoff(input.runId, input.taskKey, profile, input.note)
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  cancelRun(runId: string): OrchResult {
    const service = this.service
    if (!service?.run(runId)) return { ok: false, error: 'That run no longer exists.' }
    for (const agent of service.agents(runId).filter((a) => !a.retiredAt)) this.deps.closePane(agent.id)
    service.finishRun(runId, 'cancelled')
    return { ok: true, value: undefined }
  }

  answer(decisionId: string, answer: string): OrchResult {
    if (!this.service) return { ok: false, error: 'The orchestrator is off.' }
    try {
      this.service.answerDecision(decisionId, answer)
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  usage(runId: string): RunUsage | null {
    return this.service?.runUsage(runId, priceLookupFor(this.deps.settings())) ?? null
  }

  // ---- Internals ----

  private planOf(runId: string) {
    const { plans } = this.deps.settings()
    const id = this.service?.run(runId)?.plan
    return plans.find((p) => p.id === id) ?? plans.find((p) => p.id === DEFAULT_PLAN_ID) ?? plans[0]
  }

  /** "Continue with <profile>" for profiles on another runner (a separate quota), then wait or cancel. */
  private stallOptions(agent: OrchAgent): string[] {
    const runner = agent.runner.replace(/-local$/, '')
    const others = this.deps.settings().profiles.filter((p) => p.runner !== runner || p.local)
    const ranked = [...others.filter((p) => p.role === agent.role), ...others.filter((p) => p.role !== agent.role)]
    const names = [...new Set(ranked.map((p) => p.name))].slice(0, MAX_STALL_CHOICES)
    return [...names.map((name) => `Continue with ${name}`), 'Wait', 'Cancel task']
  }

  private async open(): Promise<OrchMcpServer> {
    const store = new OrchStore(this.deps.dbPath)
    const service = new OrchService(store)
    try {
      const server = await startOrchMcpServer(service, { version: this.deps.version, log: this.deps.log })
      this.store = store
      this.service = service
      this.server = server
      this.dispatcher = this.createDispatcher(service, server)
      service.onChange(() => {
        void this.dispatcher?.tick()
        this.notifyChanged()
      })
      this.timers = [
        setInterval(() => this.bridge.poll(), POLL_MS),
        setInterval(() => void this.collectUsage(), USAGE_MS)
      ]
      void this.dispatcher.tick()
      return server
    } catch (error) {
      store.close()
      throw error
    }
  }

  private createDispatcher(service: OrchService, server: OrchMcpServer): Dispatcher {
    return new Dispatcher({
      service,
      settings: this.deps.settings,
      worktrees,
      mcpUrl: () => server.url,
      configDir: (agentId) => join(this.deps.configRoot, agentId),
      writeFiles: async (files) => {
        for (const file of files) {
          await mkdir(dirname(file.path), { recursive: true })
          await writeFile(file.path, file.content, 'utf8')
        }
      },
      openPane: this.deps.openPane,
      closePane: this.deps.closePane,
      newSessionId: () => randomUUID(),
      log: this.deps.log
    })
  }

  private async collectUsage(): Promise<void> {
    const service = this.service
    if (!service) return
    const live = [...this.sources.values()].filter((s) => !service.agent(s.agentId)?.retiredAt)
    await this.collector.collect(service, live)
  }

  private notifyTimer: NodeJS.Timeout | null = null

  /** Bursts of changes become one notification at most every NOTIFY_MS. */
  private notifyChanged(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.deps.changed()
    }, NOTIFY_MS)
  }
}
