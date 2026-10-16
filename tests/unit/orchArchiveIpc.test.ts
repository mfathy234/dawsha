import { describe, expect, it, vi } from 'vitest'
import { registerOrchestratorIpc, type OrchestratorIpc } from '../../src/main/orch/switch'
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } }))

it('validates archive IPC before any dialog or service access', async () => {
  const exportRun = vi.fn(() => ({ ok: true, value: null }))
  const exportRuns = vi.fn(() => ({ ok: true, value: [] }))
  const importRuns = vi.fn(() => ({ ok: true, value: [] }))
  registerOrchestratorIpc({ exportRun, exportRuns, importRuns } as unknown as OrchestratorIpc)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  expect(call('orch:export-run', '../x', 'html')).toMatchObject({ ok: false })
  expect(call('orch:export-run', 'x'.repeat(201), 'markdown')).toMatchObject({ ok: false })
  expect(call('orch:export-runs', ['ok', 2])).toMatchObject({ ok: false })
  expect(call('orch:export-runs', [])).toMatchObject({ ok: false })
  expect(call('orch:import-runs', 'untrusted-path')).toMatchObject({ ok: false })
  expect(exportRun).not.toHaveBeenCalled()
  expect(exportRuns).not.toHaveBeenCalled()
  expect(importRuns).not.toHaveBeenCalled()
  expect(call('orch:export-run', 'run-1', 'markdown')).toMatchObject({ ok: true })
  expect(call('orch:export-runs', ['run-1', 'run-2'])).toMatchObject({ ok: true })
  expect(call('orch:import-runs')).toMatchObject({ ok: true })
})
