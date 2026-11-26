import { describe, expect, it } from 'vitest'
import { miniSession, type MiniSessionInput } from '../../src/shared/miniWindow'

const input = (patch: Partial<MiniSessionInput> = {}): MiniSessionInput => ({
  paneId: 'p', agent: 'claude', title: 'Tenant export', project: 'Platforms', status: 'idle', attention: 'done', tail: '', recap: '', tool: '', idleFor: '', changed: null, todos: [], ...patch
})

describe('Mini window unread', () => {
  it('marks a session that finished unseen as unread, and leaves the rest alone', () => {
    expect(miniSession(input({ unread: true })).unread).toBe(true)
    expect(miniSession(input()).unread).toBe(false)
  })

  it('still reads as done while it is unread', () => {
    expect(miniSession(input({ unread: true })).state).toBe('done')
  })
})
