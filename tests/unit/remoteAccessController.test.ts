import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteAccessController } from '../../src/main/remoteAccessController'
import type { RemoteServerOptions } from '../../src/main/remoteServer'
import { defaultSettings } from '../../src/shared/settingsSchema'
import type { Settings } from '../../src/shared/types'

function fixture(waitForHostname: (host: string, o: { timeoutMs: number }) => Promise<boolean> = async () => true) {
  let settings: Settings = { ...defaultSettings(), remoteAccess: { ...defaultSettings().remoteAccess, allowedEmail: 'owner@example.com' } }
  const store = { get: () => settings, update: (patch: Partial<Settings>) => (settings = { ...settings, ...patch }) }
  const tunnelHandle = { url: 'https://brisk-fox.trycloudflare.com', stop: vi.fn(async () => undefined), onExit: vi.fn(() => () => undefined) }
  const tunnel = { start: vi.fn(async () => tunnelHandle) }
  const server = { port: 41234, stop: vi.fn(async () => undefined) }
  const createServer = vi.fn(async (_options: RemoteServerOptions) => server)
  const remoteIds = new Set<string>()
  const kill = vi.fn((id: string) => { remoteIds.delete(id) })
  const spawn = vi.fn((request: { id: string }) => { remoteIds.add(request.id); return { ok: true as const, pid: 42 } })
  const assetDirectory = join(tmpdir(), 'dawsha-private-renderer')
  const userDataDir = mkdtempSync(join(tmpdir(), 'dawsha-remote-controller-'))
  const controller = createRemoteAccessController({
    userDataDir,
    settings: store,
    ptys: { remoteSnapshot: (id?: string) => [...remoteIds].filter((entry) => id === undefined || id === entry).map((id) => ({ id, startedAt: 1, cols: 80, rows: 24, projectId: 'p1', agent: 'codex' as const, remoteManaged: true })), remoteScreen: async () => null, remoteTail: async () => null, subscribeRemoteOutput: () => null, write: () => undefined, kill, spawn },
    getWindow: () => null,
    tunnel,
    createServer,
    assetDirectory,
    waitForHostname,
    readyGraceMs: 5
  })
  return { controller, waitForHostname, settings: () => settings, store, tunnelHandle, tunnel, server, createServer, assetDirectory, userDataDir, remoteIds, kill, spawn }
}

describe('Remote Access controller', () => {
  it('starts only after explicit enable and exposes a pairing code and temporary URL', async () => {
    const context = fixture()
    expect((await context.controller.getState()).status).toBe('off')
    expect(context.createServer).not.toHaveBeenCalled()
    const state = await context.controller.enable()
    expect(state).toMatchObject({ status: 'available', enabled: true, url: 'https://brisk-fox.trycloudflare.com/dawsha/' })
    expect(state.pairing?.code).toMatch(/^\d{6}$/)
    expect(context.tunnel.start).toHaveBeenCalledWith(41234, 'owner@example.com')
  })

  it('starts with Dawsha pairing alone when no Cloudflare PIN email is configured', async () => {
    const context = fixture()
    await context.controller.setAllowedEmail('')
    const state = await context.controller.enable()
    expect(state).toMatchObject({ enabled: true, url: 'https://brisk-fox.trycloudflare.com/dawsha/' })
    expect(state.message).toMatch(/Dawsha pairing/)
    expect(context.tunnel.start).toHaveBeenCalledWith(41234, undefined)
  })

  it('automatically replaces an expired pairing code when its state is requested', async () => {
    vi.useFakeTimers()
    const context = fixture()
    try {
      const state = await context.controller.enable()
      const expiredCode = state.pairing!
      vi.setSystemTime(expiredCode.expiresAt + 1)
      const refreshed = await context.controller.getState()
      expect(refreshed.pairing).not.toBeNull()
      expect(refreshed.pairing?.code).not.toBe(expiredCode.code)
      expect(refreshed.pairing?.expiresAt).toBeGreaterThan(Date.now())
    } finally { vi.useRealTimers() }
  })

  it('serves the remote browser from the renderer directory supplied by the main entry', async () => {
    const context = fixture()
    await context.controller.enable()
    expect(context.createServer).toHaveBeenCalledWith(expect.objectContaining({ assetDirectory: context.assetDirectory }))
  })

  it('writes secret-free remote request diagnostics into the private app profile', async () => {
    const context = fixture()
    await context.controller.enable()
    const serverOptions = context.createServer.mock.calls[0]![0]
    serverOptions.onRequestError!(Object.assign(new Error('sensitive request detail'), { code: 'EACCES' }), 'POST', '/dawsha/api/pair')
    serverOptions.onRequestComplete!('GET', '/dawsha/api/state', 502)
    serverOptions.onRequestError!(new Error('unknown path'), 'GET', '/dawsha/api/session/secret-token')
    const log = readFileSync(join(context.userDataDir, 'remote-access.log'), 'utf8')
    expect(log).toContain('"method":"POST"')
    expect(log).toContain('"pathname":"/dawsha/api/pair"')
    expect(log).toContain('"code":"EACCES"')
    expect(log).toContain('"statusCode":502')
    expect(log).toContain('"pathname":"/dawsha/api/state"')
    expect(log).toContain('"pathname":"other"')
    expect(log).not.toContain('secret-token')
    expect(log).not.toContain('sensitive request detail')
  })

  it('rejects invalid email before starting a listener', async () => {
    const context = fixture()
    await expect(context.controller.setAllowedEmail('invalid')).rejects.toThrow(/valid email/i)
    expect(context.createServer).not.toHaveBeenCalled()
  })

  it('stops both tunnel and loopback server when remote access is disabled', async () => {
    const context = fixture()
    await context.controller.enable()
    await context.controller.disable()
    expect(context.tunnelHandle.stop).toHaveBeenCalledOnce()
    expect(context.server.stop).toHaveBeenCalledOnce()
    expect((await context.controller.getState()).status).toBe('off')
  })

  it('stops every remotely started PTY when remote access is disabled', async () => {
    const context = fixture()
    context.store.update({
      projects: [{ id: 'p1', name: 'Project', folder: 'C:/projects/app', defaultAgent: 'codex' }],
      remoteAccess: { ...context.settings().remoteAccess, sessionControl: true }
    })
    await context.controller.enable()
    const options = context.createServer.mock.calls[0]![0]
    await options.startSession({ projectId: 'p1', cols: 80, rows: 24 }, () => true)
    const [sessionId] = context.remoteIds
    expect(sessionId).toBeTruthy()
    await context.controller.disable()
    expect(context.kill).toHaveBeenCalledWith(sessionId)
    expect(context.remoteIds.size).toBe(0)
  })

  it('stops the local server if tunnel startup fails', async () => {
    const context = fixture()
    context.tunnel.start.mockRejectedValue(new Error('cloudflared missing'))
    await expect(context.controller.enable()).rejects.toThrow(/cloudflared missing/)
    expect(context.server.stop).toHaveBeenCalledOnce()
    expect((await context.controller.getState()).status).toBe('setup-required')
  })

  it('coalesces overlapping enable requests into one tunnel and server', async () => {
    const context = fixture()
    let finish!: (handle: typeof context.tunnelHandle) => void
    context.tunnel.start.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = context.controller.enable()
    const second = context.controller.enable()
    await vi.waitFor(() => expect(context.createServer).toHaveBeenCalledOnce())
    finish(context.tunnelHandle)
    await Promise.all([first, second])
    expect(context.tunnel.start).toHaveBeenCalledOnce()
  })

  it('does not let the allowed email change while startup is using it', async () => {
    const context = fixture()
    let finish!: (handle: typeof context.tunnelHandle) => void
    context.tunnel.start.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const enabling = context.controller.enable()
    await vi.waitFor(() => expect(context.tunnel.start).toHaveBeenCalledOnce())
    await expect(context.controller.setAllowedEmail('other@example.com')).rejects.toThrow(/wait for Remote Access to stop/i)
    expect(context.settings().remoteAccess.allowedEmail).toBe('owner@example.com')
    finish(context.tunnelHandle)
    await enabling
  })

  it('stores allowed email and permission settings', async () => {
    const context = fixture()
    await context.controller.setAllowedEmail('new@example.com')
    const state = await context.controller.setPermissions({ terminalInput: true })
    expect(state.permissions).toMatchObject({ allowedEmail: 'new@example.com', terminalInput: true, sessionControl: false, approvals: false })
    expect(context.settings().remoteAccess).toEqual(state.permissions)
  })

  it('stores the approval settings, keeps them off by default and clamps the idle minutes', async () => {
    const context = fixture()
    expect((await context.controller.getState()).permissions).toMatchObject({ approvals: false, approvalsAllowConfigEdits: false, approvalsOnlyWhenAway: false })
    const state = await context.controller.setPermissions({ approvals: true, approvalsOnlyWhenAway: true, approvalsAwayMinutes: 500, approvalsAllowConfigEdits: true })
    expect(state.permissions).toMatchObject({ approvals: true, approvalsOnlyWhenAway: true, approvalsAwayMinutes: 60, approvalsAllowConfigEdits: true, terminalInput: false })
    expect(context.settings().remoteAccess.approvals).toBe(true)
  })

  it('rejects unknown or mistyped permission keys', async () => {
    const context = fixture()
    await expect(context.controller.setPermissions({ approvals: 'yes' } as never)).rejects.toThrow('Invalid Remote Access permissions.')
    await expect(context.controller.setPermissions({ approvalsAwayMinutes: '3' } as never)).rejects.toThrow('Invalid Remote Access permissions.')
    await expect(context.controller.setPermissions({ allowedEmail: 'x@y.com' } as never)).rejects.toThrow('Invalid Remote Access permissions.')
    expect(context.settings().remoteAccess.approvals).toBe(false)
  })

  it('returns a connecting state instead of failing while the hostname is still propagating, then becomes available', async () => {
    let release!: (value: boolean) => void
    const context = fixture(() => new Promise<boolean>((resolve) => { release = resolve }))
    const state = await context.controller.enable()
    expect(state).toMatchObject({ status: 'connecting', enabled: true, url: null, pairing: null })
    release(true)
    await vi.waitFor(async () => expect(await context.controller.getState()).toMatchObject({ status: 'available', url: 'https://brisk-fox.trycloudflare.com/dawsha/' }))
    expect((await context.controller.getState()).pairing).not.toBeNull()
  })

  it('restarts cloudflared once for a fresh hostname when the first never resolves', async () => {
    const waits: number[] = []
    let calls = 0
    const context = fixture(async (_host, o) => { waits.push(o.timeoutMs); return ++calls > 1 })
    await context.controller.enable()
    await vi.waitFor(async () => expect((await context.controller.getState()).status).toBe('available'))
    expect(context.tunnel.start).toHaveBeenCalledTimes(2)
    expect(context.tunnelHandle.stop).toHaveBeenCalledOnce()
    expect(waits).toEqual([45_000, 90_000])
  })

  it('reports a friendly setup error and stops everything if no hostname ever becomes reachable', async () => {
    const context = fixture(async () => false)
    await expect(context.controller.enable()).rejects.toThrow(/still not reachable/i)
    expect((await context.controller.getState()).status).toBe('setup-required')
    expect((await context.controller.getState()).message).toMatch(/still not reachable.*again to retry/i)
    expect(context.server.stop).toHaveBeenCalled()
  })
})

describe('Remote Access tunnel health', () => {
  type Wait = (host: string, o: { timeoutMs: number }) => Promise<boolean>
  async function enabled(probeResults: boolean[], waitForHostname?: Wait) {
    const context = fixture(waitForHostname)
    const queue = [...probeResults]
    const probe = vi.fn(async () => (queue.length ? queue.shift()! : true))
    const second = { url: 'https://calm-owl.trycloudflare.com', stop: vi.fn(async () => undefined), onExit: vi.fn(() => () => undefined) }
    context.tunnel.start.mockResolvedValueOnce(context.tunnelHandle).mockResolvedValueOnce(second)
    const controller = createRemoteAccessController({
      userDataDir: context.userDataDir,
      settings: context.store,
      ptys: { remoteSnapshot: () => [], remoteScreen: async () => null, remoteTail: async () => null, subscribeRemoteOutput: () => null, write: () => undefined, kill: () => undefined, spawn: () => ({ ok: true as const, pid: 1 }) },
      getWindow: () => null,
      tunnel: context.tunnel,
      createServer: context.createServer,
      assetDirectory: context.assetDirectory,
      waitForHostname: context.waitForHostname,
      readyGraceMs: 5,
      probe
    })
    await controller.enable()
    return { ...context, controller, probe }
  }

  it('keeps the link when verify finds a healthy tunnel', async () => {
    const context = await enabled([true])
    const state = await context.controller.verify()
    expect(state).toMatchObject({ status: 'available', url: 'https://brisk-fox.trycloudflare.com/dawsha/', notice: null })
    expect(context.tunnel.start).toHaveBeenCalledTimes(1)
    await context.controller.disable()
  })

  it('retries once on a single failure without reconnecting', async () => {
    const context = await enabled([false, true])
    expect((await context.controller.verify()).status).toBe('available')
    expect(context.tunnel.start).toHaveBeenCalledTimes(1)
    await context.controller.disable()
  })

  it('reconnects after two failures, hides the stale link, then shows the new link with a re-scan notice', async () => {
    let release!: (value: boolean) => void
    let calls = 0
    const context = await enabled([false, false], () => (++calls === 1 ? Promise.resolve(true) : new Promise<boolean>((resolve) => { release = resolve })))
    const state = await context.controller.verify()
    expect(state).toMatchObject({ status: 'reconnecting', url: null, pairing: null, message: 'The connection dropped. Reconnecting…' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release(true)
    await vi.waitFor(async () => expect((await context.controller.getState()).status).toBe('available'))
    const after = await context.controller.getState()
    expect(after.url).toBe('https://calm-owl.trycloudflare.com/dawsha/')
    expect(after.notice).toBe('The address changed. Scan the new code on your phone.')
    expect(after.pairing?.code).toMatch(/^\d{6}$/)
    expect(context.tunnelHandle.stop).toHaveBeenCalled()
    await context.controller.disable()
  })

  it('reconnects after a single failed check following resume', async () => {
    const context = await enabled([false])
    context.controller.onSystemResume()
    await vi.waitFor(() => expect(context.tunnel.start).toHaveBeenCalledTimes(2))
    await vi.waitFor(async () => expect((await context.controller.getState()).url).toBe('https://calm-owl.trycloudflare.com/dawsha/'))
    await context.controller.disable()
  })

  it('ends in the setup error with Try again when the reconnect never becomes reachable, and stops checking', async () => {
    let calls = 0
    const context = await enabled([false, false], async () => ++calls === 1)
    await context.controller.verify()
    await vi.waitFor(async () => expect((await context.controller.getState()).status).toBe('setup-required'))
    const state = await context.controller.getState()
    expect(state).toMatchObject({ enabled: false, url: null })
    expect(state.message).toMatch(/not reachable/)
    const before = context.probe.mock.calls.length
    await context.controller.verify()
    expect(context.probe.mock.calls.length).toBe(before)
  })

  it('logs health failures and the reconnect', async () => {
    const context = await enabled([false, false])
    await context.controller.verify()
    await vi.waitFor(() => expect(readFileSync(join(context.userDataDir, 'remote-access.log'), 'utf8')).toContain('tunnel-reconnect'))
    expect(readFileSync(join(context.userDataDir, 'remote-access.log'), 'utf8')).toContain('tunnel-health-failed')
    await context.controller.disable()
  })
})
