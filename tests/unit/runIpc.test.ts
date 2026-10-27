import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { RUN_IPC } from '../../src/shared/runCommands'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  dispose: vi.fn<() => Promise<void>>(async () => {})
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, fn),
    removeHandler: (name: string) => mocks.handlers.delete(name)
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener
  },
  dialog: { showOpenDialog: vi.fn() }
}))
vi.mock('../../src/main/runCommands/processes', () => ({
  RunProcesses: class {
    list = () => []
    start = vi.fn()
    stop = vi.fn(async () => undefined)
    dispose = mocks.dispose
  }
}))
import { registerRunIpc } from '../../src/main/runCommands'
import { createRunPreload } from '../../src/preload/runCommands'

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
})
describe('run IPC boundary', () => {
  it('accepts only the application main frame and removes every handler on awaited shutdown', async () => {
    const frame = {}
    const contents = { mainFrame: frame }
    const window = {
      webContents: contents,
      isDestroyed: () => false
    } as unknown as BrowserWindow
    const close = registerRunIpc(() => window, {
      get: () => ({ projects: [] }),
      update: () => undefined
    })
    const list = mocks.handlers.get(RUN_IPC.list)!
    expect(() => list({ sender: {}, senderFrame: frame })).toThrow(
      /application window/
    )
    expect(() => list({ sender: contents, senderFrame: {} })).toThrow(
      /application window/
    )
    expect(
      list({
        sender: contents,
        senderFrame: frame
      } as unknown as IpcMainInvokeEvent)
    ).toEqual([])
    let resolveDispose!: () => void
    mocks.dispose.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDispose = resolve
        })
    )
    let closed = false
    const closing = close().then(() => {
      closed = true
    })
    expect(mocks.handlers.size).toBe(0)
    await Promise.resolve()
    expect(closed).toBe(false)
    resolveDispose()
    await closing
    expect(closed).toBe(true)
  })
  it('preload exposes narrow command-id requests and strips Electron events from updates', async () => {
    const api = createRunPreload()
    await api.start({ selectionId: 'selection', commandId: 'command' })
    expect(mocks.invoke).toHaveBeenCalledWith(RUN_IPC.start, {
      selectionId: 'selection',
      commandId: 'command'
    })
    const listener = vi.fn(),
      unsubscribe = api.onChanged(listener)
    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(RUN_IPC.changed)
    handler({ secretElectronEvent: true }, [])
    expect(listener).toHaveBeenCalledExactlyOnceWith([])
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(RUN_IPC.changed, handler)
  })
})
