import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'
import { requestCloseCheck } from '../../src/main/closeCheck'

describe('close acknowledgement', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const ipc = new EventEmitter()
    const page = Object.assign(new EventEmitter(), { send: vi.fn() })
    const result = requestCloseCheck(ipc, page, vi.fn())
    const settled = vi.fn()
    void result.then(settled)
    expect(page.send).toHaveBeenCalledWith(IPC.closeCheck)
    return { ipc, page, result, settled }
  }

  it('allows a slow renderer to cancel after the short flush deadline', async () => {
    const { ipc, result, settled } = setup()
    await vi.advanceTimersByTimeAsync(1500)
    expect(settled).not.toHaveBeenCalled()
    ipc.emit(IPC.closeCheckAck)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).not.toHaveBeenCalled()
    ipc.emit(IPC.closeCheckDone, undefined, false)
    expect(await result).toBe(false)
  })

  it('unblocks an unresponsive renderer after three seconds', async () => {
    const { result, settled } = setup()
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(true)
  })

  it.each(['render-process-gone', 'destroyed'])('unblocks a %s page even after acknowledgement', async (event) => {
    const { ipc, page, result } = setup()
    ipc.emit(IPC.closeCheckAck)
    page.emit(event)
    expect(await result).toBe(true)
    expect(ipc.listenerCount(IPC.closeCheckAck)).toBe(0)
    expect(ipc.listenerCount(IPC.closeCheckDone)).toBe(0)
    expect(page.listenerCount('render-process-gone')).toBe(0)
    expect(page.listenerCount('destroyed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
