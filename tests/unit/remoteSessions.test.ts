import { describe, expect, it, vi } from 'vitest'
import { startRemoteSession } from '../../src/main/remoteSessions'
import type { Project, SpawnRequest } from '../../src/shared/types'

const project: Project = { id: 'p1', name: 'Project', folder: 'C:/projects/app', defaultAgent: 'codex' }

function setup() {
  const spawn = vi.fn((_request: SpawnRequest) => ({ ok: true as const, pid: 42 }))
  const focusHost = vi.fn()
  const isKnownSession = vi.fn(async () => true)
  const authorizeStart = vi.fn(() => true)
  return { spawn, focusHost, isKnownSession, authorizeStart, deps: { projects: [project], fullAccess: { claude: false, codex: true, gemini: false }, ptys: { spawn }, isKnownSession, focusHost, authorizeStart } }
}

describe('remote session start/resume', () => {
  it('starts only the configured default agent in its configured folder', async () => {
    const context = setup()
    const result = await startRemoteSession({ projectId: 'p1', cols: 100, rows: 30 }, context.deps)
    expect(result.ok).toBe(true)
    expect(context.spawn).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', cwd: project.folder, resume: false, fullAccess: true, desktopVisible: true, remoteManaged: true }))
    expect(context.spawn.mock.calls[0][0]).not.toHaveProperty('command')
    expect(context.focusHost).toHaveBeenCalledOnce()
  })

  it('starts a supported explicitly selected agent for a configured project', async () => {
    const context = setup()
    const result = await startRemoteSession({ projectId: 'p1', agent: 'claude', cols: 100, rows: 30 }, context.deps)
    expect(result.ok).toBe(true)
    expect(context.spawn).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', cwd: project.folder, fullAccess: false }))
  })

  it('validates a resumed session against the explicitly selected agent', async () => {
    const context = setup()
    await startRemoteSession({ projectId: 'p1', agent: 'gemini', sessionId: 'gemini-session', cols: 100, rows: 30 }, context.deps)
    expect(context.isKnownSession).toHaveBeenCalledWith(project, 'gemini', 'gemini-session')
    expect(context.spawn).toHaveBeenCalledWith(expect.objectContaining({ agent: 'gemini', sessionId: 'gemini-session', resume: true }))
  })

  it('does not resume a session that is unknown to the selected project and agent', async () => {
    const context = setup()
    context.isKnownSession.mockResolvedValue(false)
    const result = await startRemoteSession({ projectId: 'p1', agent: 'claude', sessionId: 'other-agent-session', cols: 100, rows: 30 }, context.deps)
    expect(result).toMatchObject({ ok: false })
    expect(context.isKnownSession).toHaveBeenCalledWith(project, 'claude', 'other-agent-session')
    expect(context.spawn).not.toHaveBeenCalled()
  })

  it('rejects unknown projects, arbitrary agents, and unverified resume IDs', async () => {
    const context = setup()
    await expect(startRemoteSession({ projectId: 'missing', cols: 100, rows: 30 }, context.deps)).resolves.toMatchObject({ ok: false })
    await expect(startRemoteSession({ projectId: 'p1', agent: 'shell', cols: 100, rows: 30 } as never, context.deps)).resolves.toMatchObject({ ok: false })
    await expect(startRemoteSession({ projectId: 'p1', agent: 'unknown', cols: 100, rows: 30 } as never, context.deps)).resolves.toMatchObject({ ok: false })
    context.isKnownSession.mockResolvedValue(false)
    await expect(startRemoteSession({ projectId: 'p1', sessionId: 'session-1', cols: 100, rows: 30 }, context.deps)).resolves.toMatchObject({ ok: false })
    expect(context.spawn).not.toHaveBeenCalled()
  })

  it('checks authorization again after validating a resumed session', async () => {
    const context = setup()
    let finishLookup: ((known: boolean) => void) | undefined
    context.isKnownSession.mockImplementation(() => new Promise((resolve) => { finishLookup = resolve }))
    const starting = startRemoteSession({ projectId: 'p1', sessionId: 'session-1', cols: 100, rows: 30 }, context.deps)
    await vi.waitFor(() => expect(finishLookup).toBeTypeOf('function'))
    context.authorizeStart.mockReturnValue(false)
    finishLookup?.(true)
    await expect(starting).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/revoked/i) })
    expect(context.spawn).not.toHaveBeenCalled()
  })
})
