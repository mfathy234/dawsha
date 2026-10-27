import { describe, expect, it } from 'vitest'
import { linkAction, quickOpenChoice, treeClickPins } from '../../src/shared/fileOpenMode'

const mods = (extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })

describe('treeClickPins', () => {
  it('previews on a plain click and pins a new tab on Ctrl or Cmd click', () => {
    expect(treeClickPins(mods())).toBe(false)
    expect(treeClickPins(mods({ shiftKey: true }))).toBe(false)
    expect(treeClickPins(mods({ ctrlKey: true }))).toBe(true)
    expect(treeClickPins(mods({ metaKey: true }))).toBe(true)
  })
})

describe('quickOpenChoice', () => {
  it('maps Enter, Ctrl+Enter, Alt+Enter and Ctrl+Shift+Enter', () => {
    expect(quickOpenChoice(mods())).toBe('open')
    expect(quickOpenChoice(mods({ ctrlKey: true }))).toBe('new-tab')
    expect(quickOpenChoice(mods({ metaKey: true }))).toBe('new-tab')
    expect(quickOpenChoice(mods({ altKey: true }))).toBe('prompt')
    expect(quickOpenChoice(mods({ ctrlKey: true, shiftKey: true }))).toBe('code')
  })
})

describe('linkAction', () => {
  it('ignores a click without Ctrl or Cmd', () => {
    expect(linkAction(mods(), 'src/a.ts', true)).toBeNull()
    expect(linkAction(mods({ shiftKey: true }), 'src/a.ts', true)).toBeNull()
  })

  it('opens text files in Files on Ctrl+click and keeps pictures and web pages with the system', () => {
    expect(linkAction(mods({ ctrlKey: true }), 'src/a.ts', true)).toBe('files')
    expect(linkAction(mods({ metaKey: true }), 'README.md', true)).toBe('files')
    expect(linkAction(mods({ ctrlKey: true }), 'photo.png', true)).toBe('default')
    expect(linkAction(mods({ ctrlKey: true }), 'preview.html', true)).toBe('default')
  })

  it('Ctrl+Shift+click always picks Files, but a path outside the project stays with the system', () => {
    expect(linkAction(mods({ ctrlKey: true, shiftKey: true }), 'photo.png', true)).toBe('files')
    expect(linkAction(mods({ ctrlKey: true, shiftKey: true }), 'C:/notes.md', false)).toBe('default')
    expect(linkAction(mods({ ctrlKey: true }), 'C:/notes.md', false)).toBe('default')
  })
})
