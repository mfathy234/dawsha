import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/shared/types'
import type { ToastAction } from '../../src/renderer/components/toast'

const fake = vi.hoisted(() => ({ toast: vi.fn(), updateSettings: vi.fn(async () => undefined) }))
vi.mock('../../src/renderer/api', () => ({ api: { updateSettings: fake.updateSettings } }))
vi.mock('../../src/renderer/components/toast', () => ({ toast: fake.toast }))
vi.mock('../../src/renderer/terminals', () => ({ disposeTerminal: vi.fn(), getTerminal: vi.fn() }))

import { moveProjectFromDisplay, reorderProjectFromDisplay } from '../../src/renderer/actions'
import { store } from '../../src/renderer/state'

const projects: Project[] = ['a', 'b', 'c'].map((id) => ({ id, name: id, folder: `/${id}`, defaultAgent: 'claude' }))

describe('switching from a sorted project list', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    fake.toast.mockClear()
    fake.updateSettings.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['recent', 'name'] as const)('can undo a drag from %s sort, restoring the saved order and sort', (sidebarSort) => {
    store.set((s) => ({ ...s, settings: { ...s.settings, projects, sidebarSort } }))
    reorderProjectFromDisplay(['c', 'b', 'a'], 'c', 'b')
    expect(store.state.settings.projects.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(store.state.settings.sidebarSort).toBe('manual')
    expect(fake.toast).toHaveBeenCalledWith(
      'Switched to your own order, starting from this list. Your earlier order was replaced.',
      'info', expect.objectContaining({ label: 'Undo' }))
    const action = fake.toast.mock.calls[0][2] as ToastAction
    action.run()
    expect(store.state.settings.projects).toEqual(projects)
    expect(store.state.settings.sidebarSort).toBe(sidebarSort)
    expect(fake.updateSettings).toHaveBeenLastCalledWith({ projects, sidebarSort })
  })

  it('offers the same undo for an Alt+Arrow move', () => {
    store.set((s) => ({ ...s, settings: { ...s.settings, projects, sidebarSort: 'name' } }))
    moveProjectFromDisplay(['c', 'b', 'a'], 'c', 1)
    expect(store.state.settings.projects.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    const action = fake.toast.mock.calls[0][2] as ToastAction
    expect(action?.label).toBe('Undo')
    action.run()
    expect(store.state.settings.projects).toEqual(projects)
    expect(store.state.settings.sidebarSort).toBe('name')
  })

  it('does not switch sort or offer undo for a move past the end', () => {
    store.set((s) => ({ ...s, settings: { ...s.settings, projects, sidebarSort: 'recent' } }))
    moveProjectFromDisplay(['c', 'b', 'a'], 'c', -1)
    expect(store.state.settings.projects).toEqual(projects)
    expect(store.state.settings.sidebarSort).toBe('recent')
    expect(fake.toast).not.toHaveBeenCalled()
    expect(fake.updateSettings).not.toHaveBeenCalled()
  })

  it('keeps later additions, removals and project edits when undoing the order', () => {
    store.set((s) => ({ ...s, settings: { ...s.settings, projects, sidebarSort: 'recent' } }))
    reorderProjectFromDisplay(['c', 'b', 'a'], 'c', 'b')
    const added: Project = { id: 'd', name: 'New', folder: '/d', defaultAgent: 'codex' }
    store.set((s) => ({ ...s, settings: { ...s.settings, projects: [
      { ...projects[2], name: 'Renamed' }, projects[0], added
    ] } }))
    const action = fake.toast.mock.calls[0][2] as ToastAction
    action.run()
    expect(store.state.settings.projects).toEqual([projects[0], { ...projects[2], name: 'Renamed' }, added])
    expect(store.state.settings.sidebarSort).toBe('recent')
    expect(fake.updateSettings).toHaveBeenLastCalledWith({ projects: store.state.settings.projects, sidebarSort: 'recent' })
  })
})
