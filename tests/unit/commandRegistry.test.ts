import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bind } from '../../src/shared/shortcuts'
import type { AppState } from '../../src/renderer/state'

const stateOf = (view: string, extra: Record<string, unknown> = {}): AppState => ({ view, ...extra }) as unknown as AppState
const key = (k: string, mods: Record<string, boolean> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('command registry', () => {
  let registry: typeof import('../../src/renderer/commands/registry')

  beforeEach(async () => {
    vi.resetModules()
    registry = await import('../../src/renderer/commands/registry')
  })

  it('lists static commands and provider commands, hiding disabled ones', () => {
    registry.registerCommands(
      { id: 'a', title: 'A', group: 'Actions', run: () => undefined },
      { id: 'b', title: 'B', group: 'Actions', enabled: () => false, run: () => undefined }
    )
    registry.registerProvider(() => [{ id: 'p', title: 'P', group: 'Projects', run: () => undefined }])
    expect(registry.listCommands(stateOf('grid')).map((c) => c.id)).toEqual(['a', 'p'])
    expect(registry.findCommand(stateOf('grid'), 'p')?.title).toBe('P')
    expect(registry.findCommand(stateOf('grid'), 'b')).toBeUndefined()
  })

  it('finds the command bound to a key event and respects the grid scope', () => {
    const mac = navigator.platform.toLowerCase().includes('mac')
    const primary: Record<string, boolean> = mac ? { metaKey: true } : { ctrlKey: true }
    registry.registerCommands(
      { id: 'new', title: 'New', group: 'Actions', keys: [bind('Ctrl+N')], run: () => undefined },
      { id: 'max', title: 'Max', group: 'Actions', keys: [bind('Ctrl+Enter')], scope: 'grid', run: () => undefined }
    )
    expect(registry.commandForEvent(key('n', primary), stateOf('projects'))?.id).toBe('new')
    expect(registry.commandForEvent(key('Enter', primary), stateOf('grid'))?.id).toBe('max')
    expect(registry.commandForEvent(key('Enter', primary), stateOf('projects'))).toBeNull()
    expect(registry.commandForEvent(key('n'), stateOf('grid'))).toBeNull()
  })

  it('finds provider commands with keys', () => {
    registry.registerProvider(() => [
      { id: 'alt-one', title: 'S', group: 'Actions', keys: [bind('Alt+1')], run: () => undefined }
    ])
    expect(registry.commandForEvent(key('1', { altKey: true }), stateOf('grid'))?.id).toBe('alt-one')
  })
})
