import { describe, expect, it } from 'vitest'
import { closeBehavior, loginItemArgs, startHidden, sanitizeDesktopSettings } from '../../src/shared/desktopSettings'

describe('desktop lifecycle preferences', () => {
  it('keeps Quit as the default and repairs invalid preferences', () => {
    expect(sanitizeDesktopSettings(null)).toEqual({ closeBehavior: 'quit', startHidden: false })
    expect(sanitizeDesktopSettings({ closeBehavior: 'exit', startHidden: 'yes' })).toEqual({ closeBehavior: 'quit', startHidden: false })
  })

  it.each([
    ['win32', 'quit', false, 'quit'], ['win32', 'tray', false, 'hide'],
    ['linux', 'quit', false, 'quit'], ['linux', 'tray', false, 'hide'],
    ['darwin', 'quit', false, 'hide'], ['darwin', 'tray', false, 'hide'],
    ['win32', 'tray', true, 'quit'], ['darwin', 'tray', true, 'quit']
  ] as const)('on %s with %s and quitting=%s decides %s', (platform, setting, quitting, expected) => {
    expect(closeBehavior(platform, setting, quitting)).toBe(expected)
  })

  it('only registers hidden Windows startup while keep-running is enabled', () => {
    expect(loginItemArgs('win32', { closeBehavior: 'tray', startHidden: true })).toEqual(['--hidden'])
    expect(loginItemArgs('win32', { closeBehavior: 'quit', startHidden: true })).toEqual([])
    expect(loginItemArgs('win32', { closeBehavior: 'tray', startHidden: false })).toEqual([])
    expect(loginItemArgs('darwin', { closeBehavior: 'tray', startHidden: true })).toEqual([])
  })

  it('parses the exact hidden flag, never filenames or similar flags', () => {
    const settings = { closeBehavior: 'tray', startHidden: true } as const
    expect(startHidden(['app.exe', '--hidden'], 'win32', settings, false)).toBe(true)
    for (const arg of ['C:\\--hidden', '--hidden=true', '--not-hidden']) {
      expect(startHidden(['app.exe', arg], 'win32', settings, false)).toBe(false)
    }
    expect(startHidden(['app.exe', '--hidden'], 'win32', { ...settings, closeBehavior: 'quit' }, false)).toBe(false)
    expect(startHidden([], 'darwin', settings, true)).toBe(true)
    expect(startHidden([], 'darwin', settings, false)).toBe(false)
    expect(startHidden([], 'darwin', { ...settings, startHidden: false }, true)).toBe(false)
  })
})
