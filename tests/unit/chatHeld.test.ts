import { describe, expect, it } from 'vitest'
import { newPending, holdPending, releaseHeld, removeHeld, type PendingMessage } from '../../src/shared/chatPending'

const make = (id: string): PendingMessage => newPending(id, id, 0, [], false, false)
describe('Dawsha-held messages', () => {
  it('holds while working and releases in order only when fully idle', () => {
    const held = holdPending(holdPending([], make('a')), make('b'))
    expect(releaseHeld(held, true, false, false).message).toBeNull()
    expect(releaseHeld(held, false, true, false).message).toBeNull()
    expect(releaseHeld(held, false, false, true).message).toBeNull()
    const released = releaseHeld(held, false, false, false)
    expect(released.message?.id).toBe('a')
    expect(released.pending.map((m) => m.id)).toEqual(['a', 'b'])
    expect(released.pending[0].held).toBe(false)
    const next = releaseHeld(released.pending.filter((m) => m.id !== 'a'), false, false, false)
    expect(next.message?.id).toBe('b')
  })
  it('removes held messages for edit or cancel', () => {
    const held = holdPending(holdPending([], make('a')), make('b'))
    expect(removeHeld(held, 'a').map((m) => m.id)).toEqual(['b'])
    expect(removeHeld([make('c')], 'c').map((m) => m.id)).toEqual(['c'])
  })
})
