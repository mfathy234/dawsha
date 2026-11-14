import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  isPackaged: true,
  getLoginItemSettings: vi.fn(),
  setLoginItemSettings: vi.fn()
}))
vi.mock('electron', () => ({ app: native }))
import { readLoginItem, setLoginItem, reconcileLoginItem } from '../../src/main/loginItems'

const desktop = { closeBehavior: 'tray', startHidden: true } as const

beforeEach(() => {
  vi.clearAllMocks()
  native.isPackaged = true
  native.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: true, status: 'enabled' })
})

describe('native sign-in settings', () => {
  it('reads Windows startup approval rather than a saved preference or matching arguments', () => {
    native.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: false })
    expect(readLoginItem('win32').enabled).toBe(false)
    native.getLoginItemSettings.mockReturnValue({ openAtLogin: false, executableWillLaunchAtLogin: true })
    expect(readLoginItem('win32').enabled).toBe(true)
  })

  it('sets the executable and hidden arguments then reads the actual OS result', () => {
    native.getLoginItemSettings.mockReturnValue({ openAtLogin: false, executableWillLaunchAtLogin: false })
    expect(setLoginItem(true, desktop, 'win32').enabled).toBe(false)
    expect(native.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, enabled: true, path: process.execPath, args: ['--hidden'] })
  })

  it('removes hidden arguments when close behavior changes without enabling a disabled OS entry', () => {
    reconcileLoginItem(desktop, { closeBehavior: 'quit', startHidden: true }, 'win32')
    expect(native.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, enabled: true, path: process.execPath, args: [] })
    native.setLoginItemSettings.mockClear()
    native.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: false })
    reconcileLoginItem(desktop, { closeBehavior: 'quit', startHidden: true }, 'win32')
    expect(native.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('uses the macOS service state and never passes Windows arguments', () => {
    expect(setLoginItem(true, desktop, 'darwin').enabled).toBe(true)
    expect(native.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
    native.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'requires-approval' })
    expect(readLoginItem('darwin').enabled).toBe(false)
  })

  it('never changes login registration in development or on Linux', () => {
    native.isPackaged = false
    expect(setLoginItem(true, desktop, 'win32')).toMatchObject({ packaged: false, enabled: false })
    native.isPackaged = true
    expect(setLoginItem(true, desktop, 'linux').enabled).toBe(false)
    expect(native.setLoginItemSettings).not.toHaveBeenCalled()
    expect(native.getLoginItemSettings).not.toHaveBeenCalled()
  })
})
