import { exportRunFile, exportRunFiles, importRunFiles } from './archiveFiles'
import type { OrchExportFormat, OrchArchiveFileResult } from '../../shared/orch/api'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OrchDecisionView, OrchHandoffInput, OrchPaneRequest, OrchResult, OrchRunView, OrchSnapshot, OrchStartInput, OrchStatus, OrchSpecView, OrchSpecContent } from '../../shared/orch/api'
import { DEFAULT_PLAN_ID, priceLookupFor, type OrchSettings } from '../../shared/orch/profiles'
import { runTitleFrom } from '../../shared/orch/runTitle'
import type { OrchAgent } from '../../shared/orch/types'
import type { RunUsage } from '../../shared/orch/usage'
import type { SpawnRequest, StatusInfo } from '../../shared/types'
import { Dispatcher } from './dispatcher'
import { startOrchMcpServer, type OrchMcpServer } from './mcpServer'
import { OrchPaneBridge, type LaunchExtras } from './paneBridge'
import { OrchService } from './service'
import { buildSnapshot } from './snapshot'
import { OrchStore } from './store'
import { listSpecVersions, readSpecVersion, snapshotSpec } from './specs'
import { OrchUsageCollector, type UsageSourceInfo } from './usageCollector'
import * as worktrees from './worktrees'
import { cleanUpRun } from './cleanup'

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

/** Owns the orchestrator for the life of the app: store, server, dispatcher, panes. */
export class OrchRuntime {
  private store: OrchStore | null = null
  private server: OrchMcpServer | null = null
  private starting: Promise<OrchMcpServer> | null = null
  private dispatcher: Dispatcher | null = null
  private timers: NodeJS.Timeout[] = []
  private readonly sources = new Map<string, UsageSourceInfo>()
  private readonly collector = new OrchUsageCollector()
  private readonly bridge: OrchPaneBridge
  private specQueue: Promise<void> = Promise.resolve()
  private readonly specSeen = new Set<string>()
  private readonly specErrors = new Set<string>()
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
    await this.specQueue
    this.specSeen.clear()
    this.specErrors.clear()
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
  prepareSpawn(request: SpawnRequest): LaunchExtras | { error: string; retired?: boolean } | null {
    if (!request.orchAgentId) return null
    if (!this.service) return { error: 'The orchestrator is not running. Restart Dawsha, then reopen this pane.' }
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
    if (!service) return { ok: false, error: 'The orchestrator is not running. Restart Dawsha and try again.' }
    const folder = this.deps.projectFolder(input.projectId)
    if (!folder) return { ok: false, error: 'That project no longer exists.' }
    if (!input.story.trim()) return { ok: false, error: input.kind === 'bug' ? 'Describe the bug first.' : 'Write the user story first.' }
    const plan = this.deps.settings().plans.find((p) => p.id === input.planId)
    const run = service.startRun({
      kind: input.kind,
      projectPath: folder,
      projectId: input.projectId,
      title: input.title.trim() || runTitleFrom(input.story),
      story: input.story.trim(),
      plan: plan?.id ?? DEFAULT_PLAN_ID,
      specApproval: plan?.specApproval ?? true,
      leadProfileId: input.leadProfileId,
      solo: input.solo,
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

  async restart(runId: string, agentId: string): Promise<OrchResult> {
    if (!this.dispatcher) return { ok: false, error: 'The orchestrator is off.' }
    try {
      await this.dispatcher.restart(runId, agentId)
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
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

  async exportRun(runId: string, format: OrchExportFormat): Promise<OrchResult<string | null>> {
    return this.service ? exportRunFile(this.service, runId, format, this.deps.version, this.deps.log) : { ok: false, error: 'The orchestrator is off.' }
  }

  async exportRuns(runIds: string[]): Promise<OrchResult<OrchArchiveFileResult[]>> {
    return this.service ? exportRunFiles(this.service, runIds, this.deps.version, this.deps.log) : { ok: false, error: 'The orchestrator is off.' }
  }

  async importRuns(): Promise<OrchResult<OrchArchiveFileResult[]>> {
    return this.service ? importRunFiles(this.service, this.deps.log) : { ok: false, error: 'The orchestrator is off.' }
  }

  cancelRun(runId: string): OrchResult {
    const service = this.service
    if (!service?.run(runId)) return { ok: false, error: 'That run no longer exists.' }
    if (service.run(runId)?.imported) return { ok: false, error: 'Imported runs are read-only.' }
    for (const agent of service.agents(runId).filter((a) => !a.retiredAt)) this.deps.closePane(agent.id)
    service.finishRun(runId, 'cancelled')
    return { ok: true, value: undefined }
  }

  /** Tries again to remove a finished run's worktrees and branches. */
  async retryCleanup(runId: string): Promise<OrchResult> {
    const service = this.service
    const run = service?.run(runId)
    if (!service || !run) return { ok: false, error: 'That run no longer exists.' }
    if (run.imported || run.stage !== 'done') return { ok: false, error: 'Only runs marked as done can be cleaned up.' }
    service.recordCleanup(runId, await cleanUpRun(run.projectPath, runId))
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

  private get specsRoot(): string { return join(dirname(this.deps.configRoot), 'specs') }

  async spec(runId: string): Promise<OrchSpecView | null> {
    await this.specQueue
    if (!this.service?.run(runId)) return null
    if (this.specErrors.has(runId)) {
      // Retry only on a reader's request, never on change notifications alone.
      for (const d of this.service.openDecisions().filter((d) => d.runId === runId && d.kind === 'spec-approval')) this.specSeen.delete(d.id)
      this.captureSpecs(this.service)
      await this.specQueue
      if (this.specErrors.has(runId)) throw new Error('The spec could not be saved. Check its files and retry.')
    }
    try {
      const decisions = this.service.decisions(runId)
      const versions = (await listSpecVersions(this.specsRoot, runId)).map((v) => ({ ...v, answer: decisions.find((d) => d.id === v.decisionId)?.answer ?? null }))
      const latest = versions.at(-1)
      const current = latest ? await readSpecVersion(this.specsRoot, runId, latest.version) : null
      return current ? { runId, versions, current } : null
    } catch (error) {
      this.deps.log(`orchestrator spec read failed for ${runId}: ${String(error)}`)
      throw new Error('The saved spec could not be read.')
    }
  }

  async specVersion(runId: string, version: number): Promise<OrchSpecContent | null> {
    await this.specQueue
    if (!this.service?.run(runId)) return null
    try { return await readSpecVersion(this.specsRoot, runId, version) } catch (error) {
      this.deps.log(`orchestrator spec version read failed for ${runId}: ${String(error)}`)
      throw new Error('That spec version could not be read.')
    }
  }

  private captureSpecs(service: OrchService): void {
    for (const decision of service.openDecisions().filter((d) => d.kind === 'spec-approval' && !this.specSeen.has(d.id))) {
      this.specSeen.add(decision.id)
      this.specQueue = this.specQueue.then(async () => {
        try {
          const versions = await listSpecVersions(this.specsRoot, decision.runId)
          if (versions.some((v) => v.decisionId === decision.id)) return
          const run = service.run(decision.runId)
          if (!run) return
          const worktree = await worktrees.runWorktree(run.projectPath, run.id)
          await snapshotSpec(join(worktree.path, '.dawsha', 'runs', run.id), this.specsRoot, run.id, { decisionId: decision.id, createdAt: decision.createdAt })
          this.specErrors.delete(run.id)
        } catch (error) {
          this.specErrors.add(decision.runId)
          this.deps.log(`orchestrator spec snapshot failed for ${decision.runId}: ${String(error)}`)
        }
        this.notifyChanged()
      })
    }
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
        this.captureSpecs(service)
        void this.dispatcher?.tick()
        this.notifyChanged()
      })
      this.captureSpecs(service)
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
      cleanUp: (repo, runId) => cleanUpRun(repo, runId),
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
