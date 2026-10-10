import { appendFileSync } from 'node:fs'
import { app } from 'electron'
import type { BackendEvent, UpdateInfoPayload, UpdaterBackend } from './updateController'

export interface FakeScript {
  check?: 'available' | 'none' | 'error'
  info?: UpdateInfoPayload
  checkError?: string
  download?: 'ok' | 'error'
  downloadError?: string
  progress?: number[]
  hold?: boolean
}

export interface FakeHook {
  script: FakeScript
  checks: number
  downloads: number
  setScript(script: FakeScript): void
  release(): void
}

const STEP_MS = 25
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function parseScript(raw: string | undefined): FakeScript {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as FakeScript
  } catch {
    return {}
  }
}

export function createFakeBackend(): UpdaterBackend {
  const listeners = new Map<BackendEvent, Array<(payload?: unknown) => void>>()
  let releaseHold: (() => void) | null = null
  const emit = (event: BackendEvent, payload?: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload)
  }
  const hook: FakeHook = {
    script: parseScript(process.env.DAWSHA_TEST_UPDATER_SCRIPT),
    checks: 0,
    downloads: 0,
    setScript: (script) => {
      hook.script = script
    },
    release: () => releaseHold?.()
  }
  ;(globalThis as { __dawshaFakeUpdater?: FakeHook }).__dawshaFakeUpdater = hook
  const info = (): UpdateInfoPayload => hook.script.info ?? { version: '9.9.9' }

  return {
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    checkForUpdates: async () => {
      hook.checks += 1
      emit('checking-for-update')
      await pause(STEP_MS)
      const mode = hook.script.check ?? 'none'
      if (mode === 'error') {
        const error = new Error(hook.script.checkError ?? 'Network unreachable')
        emit('error', error)
        throw error
      }
      emit(mode === 'available' ? 'update-available' : 'update-not-available', mode === 'available' ? info() : undefined)
    },
    downloadUpdate: async () => {
      hook.downloads += 1
      for (const percent of hook.script.progress ?? [100]) {
        emit('download-progress', { percent })
        await pause(STEP_MS)
      }
      if (hook.script.hold) await new Promise<void>((resolve) => (releaseHold = resolve))
      if (hook.script.download === 'error') {
        const error = new Error(hook.script.downloadError ?? 'Download failed')
        emit('error', error)
        throw error
      }
      emit('update-downloaded', info())
    },
    quitAndInstall: (silent, forceRunAfter) => {
      const log = process.env.DAWSHA_TEST_UPDATER_LOG
      if (log) appendFileSync(log, `quitAndInstall ${silent} ${forceRunAfter}\n`, 'utf8')
      app.quit()
    }
  }
}
