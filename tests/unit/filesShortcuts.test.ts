import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_ASK_SHORTCUT, fileHistoryBinding, fileHistoryShortcut } from '../../src/shared/filesShortcuts'
import { bind, matchesBinding } from '../../src/shared/shortcuts'

const event = (key: string, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
afterEach(() => vi.unstubAllGlobals())

describe('Files shortcuts', () => {
  it('keeps macOS Option arrows available for movement in text fields and editors', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(fileHistoryShortcut('back').shortcut).toBe('Ctrl+-')
    expect(fileHistoryShortcut('forward').shortcut).toBe('Ctrl+Shift+-')
    for (const direction of ['back', 'forward'] as const) {
      const binding = fileHistoryBinding(direction)
      expect(matchesBinding(event('-', { ctrlKey: true, shiftKey: direction === 'forward' }), binding)).toBe(true)
      expect(matchesBinding(event(direction === 'back' ? 'ArrowLeft' : 'ArrowRight', { altKey: true }), binding)).toBe(false)
    }
  })

  it.each(['Win32', 'Linux x86_64'])('uses Alt arrows on %s', platform => {
    vi.stubGlobal('navigator', { platform })
    expect(matchesBinding(event('ArrowLeft', { altKey: true }), fileHistoryBinding('back'))).toBe(true)
    expect(matchesBinding(event('ArrowRight', { altKey: true }), fileHistoryBinding('forward'))).toBe(true)
    expect(fileHistoryShortcut('back').shortcut).toBe('Alt+ArrowLeft')
    expect(fileHistoryShortcut('forward').shortcut).toBe('Alt+ArrowRight')
  })

  it('uses Ctrl+I for Ask without claiming AltGr+A', () => {
    const binding = bind(FILE_ASK_SHORTCUT)
    expect(matchesBinding(event('i', { ctrlKey: true }), binding, 'Win32')).toBe(true)
    expect(matchesBinding(event('i', { metaKey: true }), binding, 'darwin')).toBe(true)
    expect(matchesBinding(event('a', { ctrlKey: true, altKey: true }), binding, 'Win32')).toBe(false)
  })
})
