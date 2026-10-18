import type { OrchExportFormat, OrchArchiveFileResult } from '../../shared/orch/api'
import { ipcMain } from 'electron'
import type { OrchDecisionView, OrchHandoffInput, OrchResult, OrchRunView, OrchSnapshot, OrchStartInput, OrchStatus, OrchSpecView, OrchSpecContent } from '../../shared/orch/api'
import { IPC } from '../../shared/ipc'
import type { Settings, SpawnRequest } from '../../shared/types'
import type { LaunchExtras } from './paneBridge'
import type { OrchRuntime } from './runtime'
import { validSpecRunId } from './specs'

/** What the IPC layer needs from the orchestrator. */
export interface OrchestratorIpc {
  /** Starts the runtime; it is always on since 1.5. */
  apply(settings: Settings): void
  prepareSpawn(request: SpawnRequest): LaunchExtras | { error: string; retired?: boolean } | null
  status(): OrchStatus
  startRun(input: OrchStartInput): OrchResult<string>
  runs(): OrchRunView[]
  decisions(): OrchDecisionView[]
  answer(decisionId: string, answer: string): OrchResult
  snapshot(): OrchSnapshot
  restart(runId: string, agentId: string): Promise<OrchResult>
  handoff(input: OrchHandoffInput): Promise<OrchResult>
  exportRun(runId: string, format: OrchExportFormat): Promise<OrchResult<string | null>>
  exportRuns(runIds: string[]): Promise<OrchResult<OrchArchiveFileResult[]>>
  importRuns(): Promise<OrchResult<OrchArchiveFileResult[]>>
  cancelRun(runId: string): OrchResult
  retryCleanup(runId: string): Promise<OrchResult>
  spec(runId: string): Promise<OrchSpecView | null>
  specVersion(runId: string, version: number): Promise<OrchSpecContent | null>
}

export function createOrchestratorSwitch(runtime: OrchRuntime, log: (message: string) => void): OrchestratorIpc {
  let enabled = false
  let error: string | null = null
  return {
    apply(settings) {
      enabled = settings.experimental.orchestrator
      if (enabled && !runtime.running) {
        error = null
        runtime.start().catch((reason: unknown) => {
          error = (reason as Error).message
          log(`orchestrator did not start: ${error}`)
        })
      } else if (!enabled && runtime.running) {
        void runtime.stop()
      }
    },
    prepareSpawn: (request) => runtime.prepareSpawn(request),
    status: () => ({ enabled, running: runtime.running, error }),
    startRun: (input) => runtime.startRun(input),
    runs: () => runtime.runs(),
    decisions: () => runtime.decisions(),
    answer: (decisionId, answer) => runtime.answer(decisionId, answer),
    snapshot: () => runtime.snapshot({ enabled, running: runtime.running, error }),
    restart: (runId, agentId) => runtime.restart(runId, agentId),
    handoff: (input) => runtime.handoff(input),
    cancelRun: (runId) => runtime.cancelRun(runId),
    retryCleanup: (runId) => runtime.retryCleanup(runId),
    spec: (runId) => runtime.spec(runId),
    specVersion: (runId, version) => runtime.specVersion(runId, version),
    exportRun: (runId, format) => runtime.exportRun(runId, format),
    exportRuns: (runIds) => runtime.exportRuns(runIds),
    importRuns: () => runtime.importRuns()
  }
}

const isText = (value: unknown, max = 20_000): value is string => typeof value === 'string' && value.length <= max

function parseStartInput(value: unknown): OrchStartInput | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if ((raw.kind !== 'bug' && raw.kind !== 'feature') || !isText(raw.projectId, 200) || !isText(raw.title, 300)) return null
  if (!isText(raw.story) || !isText(raw.planId, 100)) return null
  const fixer = raw.fixerProfileId
  if (fixer !== null && !isText(fixer, 100)) return null
  if (raw.leadProfileId !== undefined && raw.leadProfileId !== null && !isText(raw.leadProfileId, 100)) return null
  if (raw.solo !== undefined && typeof raw.solo !== 'boolean') return null
  return { leadProfileId: raw.leadProfileId as string | null | undefined, solo: raw.solo as boolean | undefined, kind: raw.kind, projectId: raw.projectId, title: raw.title, story: raw.story, planId: raw.planId, fixerProfileId: fixer }
}

export function registerOrchestratorIpc(orchestrator: OrchestratorIpc): void {
  ipcMain.handle(IPC.orchSpec, (_event, runId: unknown) => validSpecRunId(runId) ? orchestrator.spec(runId) : null)
  ipcMain.handle(IPC.orchSpecVersion, (_event, runId: unknown, version: unknown) =>
    validSpecRunId(runId) && typeof version === 'number' && Number.isSafeInteger(version) && version > 0
      ? orchestrator.specVersion(runId, version) : null)
  const validId = (v: unknown): v is string => isText(v, 200) && v.length > 0
  ipcMain.handle(IPC.orchExportRun, (_event, runId: unknown, format: unknown) =>
    validId(runId) && (format === 'dawsharun' || format === 'markdown')
      ? orchestrator.exportRun(runId, format) : { ok: false, error: 'The export request could not be read.' })
  ipcMain.handle(IPC.orchExportRuns, (_event, ids: unknown) =>
    Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(validId)
      ? orchestrator.exportRuns([...new Set(ids)]) : { ok: false, error: 'Select between 1 and 100 runs.' })
  ipcMain.handle(IPC.orchImportRuns, (_event, ...args: unknown[]) =>
    args.length === 0 ? orchestrator.importRuns() : { ok: false, error: 'The import request could not be read.' })
  ipcMain.handle(IPC.orchStatus, () => orchestrator.status())
  ipcMain.handle(IPC.orchStartRun, (_event, input: unknown) => {
    const parsed = parseStartInput(input)
    return parsed ? orchestrator.startRun(parsed) : { ok: false, error: 'The run details could not be read.' }
  })
  ipcMain.handle(IPC.orchRuns, () => orchestrator.runs())
  ipcMain.handle(IPC.orchDecisions, () => orchestrator.decisions())
  ipcMain.handle(IPC.orchSnapshot, () => orchestrator.snapshot())
  ipcMain.handle(IPC.orchRestart, (_event, runId: unknown, agentId: unknown) =>
    validId(runId) && validId(agentId) ? orchestrator.restart(runId, agentId) : { ok: false, error: 'The restart request could not be read.' })
  ipcMain.handle(IPC.orchHandoff, (_event, input: unknown) => {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
    if (!isText(raw.runId, 100) || !isText(raw.taskKey, 20) || !isText(raw.profileId, 100) || !isText(raw.note, 4000)) {
      return { ok: false, error: 'The handoff could not be read.' }
    }
    return orchestrator.handoff({ runId: raw.runId, taskKey: raw.taskKey, profileId: raw.profileId, note: raw.note })
  })
  ipcMain.handle(IPC.orchRetryCleanup, (_event, runId: unknown) =>
    validId(runId) ? orchestrator.retryCleanup(runId) : { ok: false, error: 'The run could not be read.' })
  ipcMain.handle(IPC.orchCancelRun, (_event, runId: unknown) =>
    isText(runId, 100) ? orchestrator.cancelRun(runId) : { ok: false, error: 'The run could not be read.' }
  )
  ipcMain.handle(IPC.orchAnswer, (_event, decisionId: unknown, answer: unknown) =>
    isText(decisionId, 100) && isText(answer, 4000)
      ? orchestrator.answer(decisionId, answer)
      : { ok: false, error: 'The answer could not be read.' }
  )
}
