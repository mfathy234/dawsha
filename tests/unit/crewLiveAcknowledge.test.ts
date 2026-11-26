import { beforeEach, describe, expect, it, vi } from 'vitest'

const markRead = vi.hoisted(() => vi.fn())

vi.mock('../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../src/renderer/sessionCare', () => ({ markRead }))
vi.mock('../../src/renderer/crewActions', () => ({ patchRuns: vi.fn() }))
vi.mock('../../src/renderer/terminals', () => ({ getTerminal: vi.fn() }))
vi.mock('../../src/renderer/state', () => ({ store: { state: { panes: [], settings: {} }, subscribe: vi.fn(), set: vi.fn() } }))
vi.mock('../../src/renderer/derive', () => ({ derivePanes: vi.fn(() => []), matchAll: vi.fn(), primaryTab: vi.fn(), sessionIdOf: vi.fn() }))

import { acknowledgeRun } from '../../src/renderer/crewLive'

describe('acknowledging a crew run', () => {
  beforeEach(() => markRead.mockClear())

  it('marks the pane read so its unread flag clears too', () => {
    acknowledgeRun('run-1', 'pane-1')
    expect(markRead).toHaveBeenCalledWith('pane-1')
  })
})
