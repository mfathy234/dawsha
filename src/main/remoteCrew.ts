import { randomUUID } from 'node:crypto'
import { crewMembers } from '../shared/crewBuiltins'
import { checkRemoteRun, emptyCrewSnapshot, remoteCrewPayload, sanitizeCrewSnapshot, type RemoteCrewPayload, type RemoteCrewSnapshot, type RemoteRunRequest } from '../shared/remoteCrew'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/types'

export type RemoteCrewRunResult = { ok: true; runId: string; member: string; project: string } | { ok: false; error: string }

export interface RemoteCrewHost {
  list(): RemoteCrewPayload
  run(input: unknown): Promise<RemoteCrewRunResult>
}

export interface RemoteCrewBridge {
  snapshot(): RemoteCrewSnapshot
  start(request: RemoteRunRequest): Promise<{ ok: true; runId: string } | { ok: false; error: string }>
  dispose(): void
}

interface BridgeIpc {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

interface BridgeWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export const RUN_TIMEOUT_MS = 15_000
const NO_WINDOW = 'Dawsha is not open on the PC.'

/** Carries a phone's run to the desktop window, which owns the panes, and brings the live crew state back for the phone. */
export function createRemoteCrewBridge(options: { getWindow(): BridgeWindow | null; ipc: BridgeIpc; timeoutMs?: number }): RemoteCrewBridge {
  let latest = emptyCrewSnapshot()
  const pending = new Map<string, (result: { ok: true; runId: string } | { ok: false; error: string }) => void>()

  const onSnapshot = (_event: unknown, value: unknown): void => { latest = sanitizeCrewSnapshot(value) }
  const onResult = (_event: unknown, id: unknown, result: unknown): void => {
    if (typeof id !== 'string') return
    const settle = pending.get(id)
    if (!settle) return
    pending.delete(id)
    const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    if (record.ok === true && typeof record.runId === 'string') settle({ ok: true, runId: record.runId.slice(0, 20) })
    else settle({ ok: false, error: typeof record.error === 'string' ? record.error.slice(0, 200) : 'Could not start the run.' })
  }
  options.ipc.on(IPC.remoteCrewSnapshot, onSnapshot)
  options.ipc.on(IPC.remoteCrewRunResult, onResult)

  return {
    snapshot: () => latest,
    start(request) {
      const window = options.getWindow()
      if (!window || window.isDestroyed()) return Promise.resolve({ ok: false, error: NO_WINDOW })
      const id = randomUUID()
      const waitMs = options.timeoutMs ?? RUN_TIMEOUT_MS
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, error: 'Dawsha did not answer in time.' })
        }, waitMs)
        pending.set(id, (result) => { clearTimeout(timer); resolve(result) })
        window.webContents.send(IPC.remoteCrewRun, id, {
          memberId: request.member.id,
          projectId: request.project.id,
          choice: request.choice,
          fields: request.fields,
          deadline: Date.now() + waitMs
        })
      })
    },
    dispose() {
      options.ipc.removeListener(IPC.remoteCrewSnapshot, onSnapshot)
      options.ipc.removeListener(IPC.remoteCrewRunResult, onResult)
      for (const settle of pending.values()) settle({ ok: false, error: NO_WINDOW })
      pending.clear()
    }
  }
}

export function createRemoteCrewHost(options: { settings: { get(): Pick<Settings, 'crew' | 'projects'> }; bridge: RemoteCrewBridge }): RemoteCrewHost {
  const members = (): ReturnType<typeof crewMembers> => crewMembers(options.settings.get().crew)
  return {
    list: () => remoteCrewPayload(members(), options.bridge.snapshot()),
    async run(input) {
      const checked = checkRemoteRun(input, members(), options.settings.get().projects)
      if (!checked.ok) return checked
      const started = await options.bridge.start(checked.request)
      if (!started.ok) return started
      return { ok: true, runId: started.runId, member: checked.request.member.name, project: checked.request.project.name }
    }
  }
}
