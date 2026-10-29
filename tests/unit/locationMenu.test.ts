import { describe, expect, it, vi } from 'vitest'
import { locationEntries, sendEntries, type LocationContext } from '../../src/renderer/files/locationMenu'
import type { ContextEntry } from '../../src/renderer/components/contextMenu'

const items = (entries: ContextEntry[]) => entries.filter((entry): entry is Exclude<ContextEntry, 'separator' | { heading: string }> => entry !== 'separator' && !('heading' in entry))
const headings = (entries: ContextEntry[]) => entries.flatMap((entry) => (entry !== 'separator' && 'heading' in entry ? [entry.heading] : []))

const context = (over: Partial<LocationContext> = {}): LocationContext => ({
  projects: [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }],
  projectId: 'a',
  projectName: 'Acme',
  folder: 'C:\\w\\acme',
  checkouts: [
    { folder: 'C:\\w\\acme', branch: 'main', head: '1', detached: false, unavailable: false, main: true },
    { folder: 'C:\\w\\acme-dark', branch: 'feat/dark', head: '2', detached: false, unavailable: false, main: false },
    { folder: 'C:\\w\\gone', branch: 'old', head: '3', detached: false, unavailable: true, main: false }
  ],
  linked: [],
  switchProject: vi.fn(), switchCheckout: vi.fn(), openLinked: vi.fn(), copyPath: vi.fn(), reveal: vi.fn(),
  ...over
})

describe('locationEntries', () => {
  it('lists projects, then checkouts, then Copy path and Reveal', () => {
    const entries = locationEntries(context())
    expect(headings(entries)).toEqual(['Projects', 'Worktrees'])
    expect(items(entries).map((entry) => entry.label)).toEqual(['Acme', 'Beta', 'main', 'feat/dark', 'old', 'Copy path', 'Reveal in File Explorer'])
    expect(entries[entries.length - 3]).toBe('separator')
  })
  it('marks the current project and checkout and runs the others', () => {
    const ctx = context()
    const found = items(locationEntries(ctx))
    expect(found.filter((entry) => entry.current).map((entry) => entry.label)).toEqual(['Acme', 'main'])
    found.find((entry) => entry.label === 'Beta')?.run()
    found.find((entry) => entry.label === 'feat/dark')?.run()
    found.find((entry) => entry.label === 'Acme')?.run()
    expect(ctx.switchProject).toHaveBeenCalledTimes(1)
    expect(ctx.switchProject).toHaveBeenCalledWith('b')
    expect(ctx.switchCheckout).toHaveBeenCalledWith('C:\\w\\acme-dark')
  })
  it('disables an unavailable checkout and says why', () => {
    const gone = items(locationEntries(context())).find((entry) => entry.label === 'old')
    expect(gone?.disabled).toBe(true)
    expect(gone?.detail).toMatch(/pruned/)
  })
  it('adds Linked repos only when there are some, disabled when no project accepts them', () => {
    const entries = locationEntries(context({ linked: [{ folder: 'C:\\w\\kc', name: 'Keycloak', projectId: 'b' }, { folder: 'C:\\w\\x', name: 'Stranger', projectId: null }] }))
    expect(headings(entries)).toContain('Linked repos')
    const [open, stranger] = items(entries).filter((entry) => entry.label === 'Keycloak' || entry.label === 'Stranger')
    expect(open.disabled).toBe(false)
    expect(stranger.disabled).toBe(true)
    expect(stranger.detail).toMatch(/Not a project/)
    expect(headings(locationEntries(context()))).not.toContain('Linked repos')
  })
})

describe('sendEntries', () => {
  it('lists sessions by their full names, then a new session and the mention', () => {
    const sendTo = vi.fn()
    const entries = sendEntries({ sessions: [{ paneId: 'p1', title: 'Fix the long running sidebar filter bug' }], sendTo, newSession: vi.fn(), copyMention: vi.fn() })
    expect(items(entries).map((entry) => entry.label)).toEqual(['Fix the long running sidebar filter bug', 'New session with this file…', 'Copy as @mention'])
    items(entries)[0].run()
    expect(sendTo).toHaveBeenCalledWith('p1')
  })
  it('says so when no session is live', () => {
    const first = items(sendEntries({ sessions: [], sendTo: vi.fn(), newSession: vi.fn(), copyMention: vi.fn() }))[0]
    expect(first.label).toBe('No live session in this project')
    expect(first.disabled).toBe(true)
  })
})

describe('Worktrees section', () => {
  const main = { folder: 'C:\w\acme', branch: 'main', head: '1', detached: false, unavailable: false, main: true }
  it('shows the only-main message instead of an empty section', () => {
    const entries = locationEntries(context({ checkouts: [main] }))
    const note = items(entries).find((entry) => entry.label === 'Only the main checkout.')
    expect(note?.disabled).toBe(true)
    expect(note?.detail).toMatch(/git worktree add/)
  })
  it('says Current in words on the current checkout', () => {
    const current = items(locationEntries(context())).find((entry) => entry.label === 'main')
    expect(current?.current).toBe(true)
    expect(current?.detail).toBe('Current · acme')
  })
  it('puts Worktrees first when asked', () => {
    expect(headings(locationEntries(context({ worktreesFirst: true })))).toEqual(['Worktrees', 'Projects'])
  })
  it('shows loading and a retry row', () => {
    const retry = vi.fn()
    expect(items(locationEntries(context({ worktrees: 'loading' }))).some((entry) => entry.label === 'Loading worktrees…' && entry.disabled)).toBe(true)
    const failed = items(locationEntries(context({ worktrees: 'failed', retryWorktrees: retry }))).find((entry) => entry.label.includes('Retry'))
    failed?.run()
    expect(retry).toHaveBeenCalled()
  })
  it('explains a folder that is not a repository', () => {
    const entries = locationEntries(context({ git: false, checkouts: [main] }))
    expect(items(entries).some((entry) => entry.label === 'Not a Git repository.')).toBe(true)
  })
})
