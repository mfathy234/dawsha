import { describe, expect, it } from 'vitest'
import { bind, formatShortcut, matchesBinding, parseShortcut, primaryModifierPressed } from '../../src/shared/shortcuts'

const event = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('parseShortcut', () => {
  it('reads modifiers and keys case-insensitively', () => {
    expect(parseShortcut('Ctrl+K')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false })
    expect(parseShortcut('control+shift+p')).toEqual({ key: 'p', ctrl: true, shift: true, alt: false })
    expect(parseShortcut('Alt+3')).toEqual({ key: '3', ctrl: false, shift: false, alt: true })
    expect(parseShortcut('Ctrl+Alt+ArrowLeft')?.key).toBe('ArrowLeft')
    expect(parseShortcut('ctrl+f5')?.key).toBe('F5')
    expect(parseShortcut('Ctrl+Shift+Alt+Home')?.key).toBe('Home')
    expect(parseShortcut('Cmd+K')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false })
    expect(parseShortcut('ctrl+shift+alt+end')?.key).toBe('End')
  })

  it('rejects shortcuts without ctrl or alt, unknown modifiers and unknown keys', () => {
    expect(parseShortcut('K')).toBeNull()
    expect(parseShortcut('Shift+K')).toBeNull()
    expect(parseShortcut('Meta+K')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false })
    expect(parseShortcut('Ctrl+Banana')).toBeNull()
    expect(parseShortcut('Ctrl+')).toBeNull()
    expect(parseShortcut('')).toBeNull()
  })
})

describe('formatShortcut', () => {
  it('prints modifiers in a fixed order', () => {
    expect(formatShortcut(bind('shift+ctrl+r'), 'win32')).toBe('Ctrl+Shift+R')
    expect(formatShortcut(bind('alt+1'), 'win32')).toBe('Alt+1')
    expect(formatShortcut(bind('Ctrl+Enter'), 'win32')).toBe('Ctrl+Enter')
    expect(formatShortcut(bind('Ctrl+Shift+K'), 'darwin')).toBe('Cmd+Shift+K')
  })
})

describe('matchesBinding', () => {
  it('supports physical Control bindings on macOS without claiming Command or Option navigation', () => {
    const back = { key: '-', ctrl: true, shift: false, alt: false, physicalCtrl: true }
    const forward = { ...back, shift: true }
    expect(matchesBinding(event('-', { ctrlKey: true }), back, 'darwin')).toBe(true)
    expect(matchesBinding(event('_', { ctrlKey: true, shiftKey: true }), forward, 'darwin')).toBe(true)
    expect(matchesBinding(event('-', { metaKey: true }), back, 'darwin')).toBe(false)
    expect(matchesBinding(event('ArrowLeft', { altKey: true }), back, 'darwin')).toBe(false)
    expect(formatShortcut(back, 'darwin')).toBe('Ctrl+-')
    expect(formatShortcut(forward, 'darwin')).toBe('Ctrl+Shift+-')
  })

  it('requires the exact modifier set', () => {
    const ctrlK = bind('Ctrl+K')
    expect(matchesBinding(event('k', { ctrlKey: true }), ctrlK, 'win32')).toBe(true)
    expect(matchesBinding(event('K', { ctrlKey: true }), ctrlK, 'win32')).toBe(true)
    expect(matchesBinding(event('k', { ctrlKey: true, shiftKey: true }), ctrlK, 'win32')).toBe(false)
    expect(matchesBinding(event('k'), ctrlK, 'win32')).toBe(false)
    expect(matchesBinding(event('k', { ctrlKey: true, metaKey: true }), ctrlK, 'win32')).toBe(false)
    expect(matchesBinding(event('k', { metaKey: true }), ctrlK, 'darwin')).toBe(true)
    expect(matchesBinding(event('k', { ctrlKey: true }), ctrlK, 'darwin')).toBe(false)
  })

  it('compares named keys exactly', () => {
    expect(matchesBinding(event('Enter', { ctrlKey: true }), bind('Ctrl+Enter'), 'win32')).toBe(true)
    expect(matchesBinding(event('ArrowLeft', { ctrlKey: true, altKey: true }), bind('Ctrl+Alt+ArrowLeft'), 'win32')).toBe(true)
    expect(matchesBinding(event('ArrowRight', { ctrlKey: true, altKey: true }), bind('Ctrl+Alt+ArrowLeft'), 'win32')).toBe(false)
  })
})

describe('primaryModifierPressed', () => {
  it('uses Command on macOS and Control on other platforms', () => {
    expect(primaryModifierPressed(event('c', { metaKey: true }), 'darwin')).toBe(true)
    expect(primaryModifierPressed(event('c', { ctrlKey: true }), 'darwin')).toBe(false)
    expect(primaryModifierPressed(event('c', { ctrlKey: true }), 'win32')).toBe(true)
    expect(primaryModifierPressed(event('c', { metaKey: true }), 'win32')).toBe(false)
  })
})
