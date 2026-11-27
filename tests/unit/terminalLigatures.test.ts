import type { ITerminalAddon, Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { TerminalRendering } from '../../src/renderer/terminalRendering'

function terminalHost() {
  const joiners = new Map<number, (text: string) => [number, number][]>()
  let nextId = 0
  const host = {
    element: undefined as { style: { fontFeatureSettings: string } } | undefined,
    options: { fontFamily: 'monospace' },
    rows: 24,
    loadAddon: (addon: ITerminalAddon) => addon.activate(host as unknown as Terminal),
    registerCharacterJoiner: (joiner: (text: string) => [number, number][]) => {
      const id = nextId++
      joiners.set(id, joiner)
      return id
    },
    deregisterCharacterJoiner: (id: number) => joiners.delete(id),
    refresh: () => undefined
  }
  return { host, joiners, rendering: new TerminalRendering(host as unknown as Terminal) }
}

describe('terminal programming ligatures', () => {
  it('uses real addon fallback ranges without Node or font access', () => {
    const { host, joiners, rendering } = terminalHost()
    host.element = { style: { fontFeatureSettings: '' } }
    rendering.setLigatures(true)
    const join = [...joiners.values()][0]
    expect(join('=== != => -> <=')).toEqual([[0, 3], [4, 6], [7, 9], [10, 12], [13, 15]])
    expect(join('normal text')).toEqual([])
    rendering.dispose()
    expect(joiners.size).toBe(0)
  })

  it('enables after mount and removes joining immediately when toggled off', () => {
    const { host, joiners, rendering } = terminalHost()
    rendering.setLigatures(true)
    expect(joiners.size).toBe(0)
    host.element = { style: { fontFeatureSettings: '' } }
    rendering.setLigatures(true)
    rendering.setLigatures(true)
    expect(joiners.size).toBe(1)
    expect(host.element.style.fontFeatureSettings).toBe('"calt" on, "liga" on')
    rendering.setLigatures(false)
    expect(joiners.size).toBe(0)
    expect(host.element.style.fontFeatureSettings).toBe('')
    rendering.setLigatures(true)
    expect(joiners.size).toBe(1)
    rendering.dispose()
    expect(joiners.size).toBe(0)
  })
})
