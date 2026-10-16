import { ipcMain } from 'electron'
import type { OrchDecisionView, OrchHandoffInput, OrchResult, OrchRunView, OrchSnapshot, OrchStartInput, OrchStatus, OrchSpecView, OrchSpecContent } from '../../shared/orch/api'
import { IPC } from '../../shared/ipc'
import type { Settings, SpawnRequest } from '../../shared/types'
import type { LaunchExtras } from './paneBridge'
import type { OrchRuntime } from './runtime'
import { validSpecRunId } from './specs'

/** What the IPC layer needs from the orchestrator. */
export interface OrchestratorIpc {
  /** Starts or stops the runtime to match Settings → Experimental. */
  apply(settings: Settings): void
  prepareSpawn(request: SpawnRequest): LaunchExtras | { error: string } | null
  status(): OrchStatus
  startRun(input: OrchStartInput): OrchResult<string>
  runs(): OrchRunView[]
  decisions(): OrchDecisionView[]
  answer(decisionId: string, answer: string): OrchResult
  snapshot(): OrchSnapshot
  handoff(input: OrchHandoffInput): Promise<OrchResult>
  cancelRun(runId: string): OrchResult
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
    handoff: (input) => runtime.handoff(input),
    cancelRun: (runId) => runtime.cancelRun(runId),
    spec: (runId) => runtime.spec(runId),
    specVersion: (runId, version) => runtime.specVersion(runId, version)
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
  return { kind: raw.kind, projectId: raw.projectId, title: raw.title, story: raw.story, planId: raw.planId, fixerProfileId: fixer }
}

export function registerOrchestratorIpc(orchestrator: OrchestratorIpc): void {
  ipcMain.handle(IPC.orchSpec, (_event, runId: unknown) => validSpecRunId(runId) ? orchestrator.spec(runId) : null)
  ipcMain.handle(IPC.orchSpecVersion, (_event, runId: unknown, version: unknown) =>
    validSpecRunId(runId) && typeof version === 'number' && Number.isSafeInteger(version) && version > 0
      ? orchestrator.specVersion(runId, version) : null)
  ipcMain.handle(IPC.orchStatus, () => orchestrator.status())
  ipcMain.handle(IPC.orchStartRun, (_event, input: unknown) => {
    const parsed = parseStartInput(input)
    return parsed ? orchestrator.startRun(parsed) : { ok: false, error: 'The run details could not be read.' }
  })
  ipcMain.handle(IPC.orchRuns, () => orchestrator.runs())
  ipcMain.handle(IPC.orchDecisions, () => orchestrator.decisions())
  ipcMain.handle(IPC.orchSnapshot, () => orchestrator.snapshot())
  ipcMain.handle(IPC.orchHandoff, (_event, input: unknown) => {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
    if (!isText(raw.runId, 100) || !isText(raw.taskKey, 20) || !isText(raw.profileId, 100) || !isText(raw.note, 4000)) {
      return { ok: false, error: 'The handoff could not be read.' }
    }
    return orchestrator.handoff({ runId: raw.runId, taskKey: raw.taskKey, profileId: raw.profileId, note: raw.note })
  })
  ipcMain.handle(IPC.orchCancelRun, (_event, runId: unknown) =>
    isText(runId, 100) ? orchestrator.cancelRun(runId) : { ok: false, error: 'The run could not be read.' }
  )
  ipcMain.handle(IPC.orchAnswer, (_event, decisionId: unknown, answer: unknown) =>
    isText(decisionId, 100) && isText(answer, 4000)
      ? orchestrator.answer(decisionId, answer)
      : { ok: false, error: 'The answer could not be read.' }
  )
}
