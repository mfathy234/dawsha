import { describe, expect, it } from 'vitest'
import { bind } from '../../src/shared/shortcuts'
import { commandForEvent, registerCommands } from '../../src/renderer/commands/registry'
import type { AppState } from '../../src/renderer/state'

const state = { view: 'grid' } as AppState
const event = { key: 'R', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }
let inTerminal = false

registerCommands(
  { id: 'test.resume', title: 'Resume', group: 'Actions', keys: [bind('Ctrl+Shift+R')], run: () => undefined },
  { id: 'test.reading', title: 'Reading', group: 'Actions', keys: [bind('Ctrl+Shift+R')], keyWhen: () => inTerminal, run: () => undefined }
)

describe('keys that only count in some places', () => {
  it('lets the place-specific command win where it applies and the plain one elsewhere', () => {
    inTerminal = true
    expect(commandForEvent(event, state)?.id).toBe('test.reading')
    inTerminal = false
    expect(commandForEvent(event, state)?.id).toBe('test.resume')
  })
})
