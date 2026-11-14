import { describe, expect, it } from 'vitest'
import { closeBehavior, loginItemArgs, startHidden, sanitizeDesktopSettings } from '../../src/shared/desktopSettings'

describe('desktop lifecycle preferences', () => {
  it('keeps Quit as the default and repairs invalid preferences', () => {
    expect(sanitizeDesktopSettings(null)).toEqual({ closeBehavior: 'quit', startHidden: false })
    expect(sanitizeDesktopSettings({ closeBehavior: 'exit', startHidden: 'yes' })).toEqual({ closeBehavior: 'quit', startHidden: false })
  })

  it.each([
    ['quit', false, true, 'quit'], ['tray', false, true, 'hide'],
    ['tray', true, true, 'quit'], ['quit', true, true, 'quit'],
    ['tray', false, false, 'quit']
  ] as const)('with %s, quitting=%s and tray=%s decides %s on every platform', (setting, quitting, tray, expected) => {
    expect(closeBehavior(setting, quitting, tray)).toBe(expected)
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
    expect(startHidden([], 'darwin', { ...settings, closeBehavior: 'quit' }, true)).toBe(false)
    expect(startHidden([], 'darwin', settings, false)).toBe(false)
    expect(startHidden([], 'darwin', { ...settings, startHidden: false }, true)).toBe(false)
  })
})
