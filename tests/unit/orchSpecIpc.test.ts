import { describe, expect, it, vi } from 'vitest'
import { registerOrchestratorIpc, type OrchestratorIpc } from '../../src/main/orch/switch'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }))

describe('spec IPC boundary', () => {
  it('rejects unsafe ids and invalid versions before accessing files', async () => {
    const spec = vi.fn().mockResolvedValue({ runId: 'run_a' })
    const specVersion = vi.fn().mockResolvedValue({ version: 2 })
    registerOrchestratorIpc({ spec, specVersion } as unknown as OrchestratorIpc)
    const latest = handlers.get('orch:spec')!
    const version = handlers.get('orch:spec-version')!
    expect(latest).toBeTypeOf('function')
    for (const id of ['../x', 'a/b', '', null, 2, 'a'.repeat(101)]) expect(await latest({}, id)).toBeNull()
    for (const v of [0, -1, 1.5, '2', null, NaN, Infinity]) expect(await version({}, 'run_a', v)).toBeNull()
    expect(spec).not.toHaveBeenCalled()
    expect(specVersion).not.toHaveBeenCalled()
    expect(await latest({}, 'run_a')).toEqual({ runId: 'run_a' })
    expect(await version({}, 'run_a', 2)).toEqual({ version: 2 })
    expect(specVersion).toHaveBeenCalledWith('run_a', 2)
  })
})
