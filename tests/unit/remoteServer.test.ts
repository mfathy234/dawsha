import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createRemoteAuth, REMOTE_TOKEN_TTL_MS, type DeviceStore, type StoredDevice } from '../../src/main/remoteAuth'
import type { RemoteActivityInput } from '../../src/shared/remoteActivity'
import { startRemoteServer, type RemoteServerOptions } from '../../src/main/remoteServer'
import type { RemoteTerminalFrame, RemoteTerminalSnapshot } from '../../src/main/remoteTerminalState'
import type { Project } from '../../src/shared/types'

function createStore(): DeviceStore {
  let devices: StoredDevice[] = []
  return { load: () => devices, save: (next) => { devices = next } }
}

const project: Project = { id: 'p1', name: 'Sample', folder: 'C:/private/sample', defaultAgent: 'codex' }

function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<IncomingMessage> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(target.port), path: `${target.pathname}${target.search}`, method: init.method, headers: init.headers }, resolve)
    outgoing.on('error', reject)
    outgoing.end(init.body)
  })
}

async function bodyJson(response: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
}

async function setup(
  assetDirectory?: string,
  onRequestError?: (error: unknown, method: string, pathname: string) => void,
  onRequestComplete?: (method: string, pathname: string, statusCode: number) => void,
  now: () => number = Date.now,
  heartbeatIntervalMs?: number,
  listSessions?: RemoteServerOptions['listSessions'],
  terminalAgent: RemoteTerminalSnapshot['agent'] = 'codex'
) {
  const auth = createRemoteAuth(createStore(), now)
  const pairing = auth.createPairingCode()
  const paired = auth.pair(pairing.code, 'Test browser')!
  auth.setPermissions({ fullOutput: true })
  const terminal: RemoteTerminalSnapshot = { id: 'term-1', startedAt: 1, cols: 80, rows: 24, projectId: 'p1', agent: terminalAgent }
  const outputListeners = new Set<(frame: RemoteTerminalFrame) => void>()
  let screenOutput = 'hello'
  const setScreenOutput = (value: string): void => { screenOutput = value }
  const getProjects = vi.fn(() => [project])
  const write = vi.fn()
  const stopSession = vi.fn(() => true)
  const activity: RemoteActivityInput[] = []
  const startSession = vi.fn(async () => ({ ok: true as const, pid: 123, id: 'new-term' }))
  const server = await startRemoteServer({
    getHostName: () => 'device.trycloudflare.com',
    auth,
    getProjects,
    listSessions: listSessions ?? (async (_project, agent) => agent === 'codex' ? [{ id: 'session-1', title: 'Existing', modifiedAt: 1 }] : []),
    terminals: {
      snapshot: (id?: string) => id ? (id === terminal.id ? [terminal] : []) : [terminal],
      screen: async (id) => id === terminal.id ? { output: screenOutput, cols: terminal.cols, rows: terminal.rows } : null,
      subscribe: (id, listener) => {
        if (id !== terminal.id) return null
        outputListeners.add(listener)
        return () => outputListeners.delete(listener)
      },
      write
    },
    startSession,
    stopSession,
    assetDirectory,
    onActivity: (entry) => activity.push(entry),
    onRequestError,
    onRequestComplete,
    heartbeatIntervalMs
  })
  const base = `http://127.0.0.1:${server.port}/dawsha/api`
  const headers = { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', Cookie: `dawsha_remote=${paired.token}` }
  return { server, base, headers, auth, pairing, paired, activity, getProjects, write, startSession, stopSession, outputListeners, terminal, setScreenOutput }
}

describe('private remote HTTP API', () => {
  it('serves the unpaired browser page before requiring a device cookie', async () => {
    const assetDirectory = mkdtempSync(join(tmpdir(), 'dawsha-remote-assets-'))
    writeFileSync(join(assetDirectory, 'remote.html'), '<!doctype html><title>Pair with Dawsha</title>')
    mkdirSync(join(assetDirectory, 'assets'))
    writeFileSync(join(assetDirectory, 'assets', 'remote-test.js'), 'document.body.dataset.ready = "true"')
    const context = await setup(assetDirectory)
    try {
      const response = await request(`http://127.0.0.1:${context.server.port}/dawsha/`, { headers: { Host: 'device.trycloudflare.com' } })
      const chunks: Buffer[] = []
      for await (const chunk of response) chunks.push(Buffer.from(chunk))
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(Buffer.concat(chunks).toString('utf8')).toContain('Pair with Dawsha')

      const assetResponse = await request(`http://127.0.0.1:${context.server.port}/dawsha/assets/remote-test.js`, { headers: { Host: 'device.trycloudflare.com' } })
      const assetChunks: Buffer[] = []
      for await (const chunk of assetResponse) assetChunks.push(Buffer.from(chunk))
      expect(assetResponse.statusCode).toBe(200)
      expect(assetResponse.headers['content-type']).toContain('text/javascript')
      expect(Buffer.concat(assetChunks).toString('utf8')).toContain('dataset.ready')
    } finally {
      await context.server.stop()
      rmSync(assetDirectory, { recursive: true, force: true })
    }
  })

  it('answers the tunnel health probe without auth and without leaking app state', async () => {
    const context = await setup()
    try {
      const response = await request(`${context.base}/health`, { headers: { Host: 'device.trycloudflare.com' } })
      expect(response.statusCode).toBe(200)
      expect(await bodyJson(response)).toEqual({ ok: true, app: 'dawsha' })
      const wrongHost = await request(`${context.base}/health`, { headers: { Host: 'attacker.example' } })
      expect(wrongHost.statusCode).toBe(403)
      expect(context.getProjects).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('rejects unauthenticated and wrong-origin requests before reading app state', async () => {
    const context = await setup()
    try {
      const denied = await request(`${context.base}/state`, { headers: { Host: 'device.trycloudflare.com' } })
      expect(denied.statusCode).toBe(401)
      const wrongOrigin = await request(`${context.base}/state`, { headers: { ...context.headers, Origin: 'https://attacker.example' } })
      expect(wrongOrigin.statusCode).toBe(403)
      const wrongHost = await request(`${context.base}/state`, { headers: { ...context.headers, Host: 'attacker.example' } })
      expect(wrongHost.statusCode).toBe(403)
      expect(context.getProjects).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('pairs once and places the raw token only in a secure HttpOnly cookie', async () => {
    const context = await setup()
    const nextCode = context.auth.createPairingCode()
    try {
      const response = await request(`${context.base}/pair`, {
        method: 'POST',
        headers: { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: nextCode.code, deviceName: 'Phone' })
      })
      expect(response.statusCode).toBe(200)
      expect(String(response.headers['set-cookie'])).toContain('HttpOnly; Secure; SameSite=Strict')
      const body = await bodyJson(response)
      expect(JSON.stringify(body)).not.toContain('token')
      expect(body.deviceId).toEqual(expect.any(String))
    } finally { await context.server.stop() }
  })

  it('limits guesses per pairing code without letting one browser block later pairing codes', async () => {
    const context = await setup()
    const statuses: number[] = []
    try {
      for (let index = 0; index < 6; index++) {
        const response = await request(`${context.base}/pair`, {
          method: 'POST',
          headers: { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '000000', deviceName: 'Phone' })
        })
        statuses.push(response.statusCode ?? 0)
        await bodyJson(response)
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 401])
      const refreshed = context.auth.createPairingCode()
      const paired = await request(`${context.base}/pair`, {
        method: 'POST',
        headers: { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: refreshed.code, deviceName: 'Phone' })
      })
      expect(paired.statusCode).toBe(200)
    } finally { await context.server.stop() }
  })

  it('records pairing and state response statuses without query strings', async () => {
    const onRequestComplete = vi.fn()
    const context = await setup(undefined, undefined, onRequestComplete)
    try {
      const response = await request(`${context.base}/state?probe=private`, { headers: context.headers })
      expect(response.statusCode).toBe(200)
      await bodyJson(response)
      expect(onRequestComplete).toHaveBeenCalledWith('GET', '/dawsha/api/state', 200)
      const unknown = await request(`${context.base}/special/private-token`, { headers: context.headers })
      expect(unknown.statusCode).toBe(404)
      await bodyJson(unknown)
      expect(onRequestComplete).toHaveBeenCalledWith('GET', 'other', 404)
      expect(JSON.stringify(onRequestComplete.mock.calls)).not.toContain('private-token')
    } finally { await context.server.stop() }
  })

  it('reports failed pairing requests without logging their submitted code', async () => {
    const onRequestError = vi.fn()
    const context = await setup(undefined, onRequestError)
    const nextCode = context.auth.createPairingCode()
    vi.spyOn(context.auth, 'pair').mockImplementation(() => { throw new Error('storage failure') })
    try {
      const response = await request(`${context.base}/pair`, {
        method: 'POST',
        headers: { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: nextCode.code, deviceName: 'Private phone' })
      })
      expect(response.statusCode).toBe(500)
      await bodyJson(response)
      expect(onRequestError).toHaveBeenCalledWith(expect.any(Error), 'POST', '/dawsha/api/pair')
      expect(JSON.stringify(onRequestError.mock.calls)).not.toContain(nextCode.code)
      expect(JSON.stringify(onRequestError.mock.calls)).not.toContain('Private phone')
    } finally { await context.server.stop() }
  })

  it('redacts unknown route paths in failure diagnostics', async () => {
    const onRequestError = vi.fn()
    const context = await setup(undefined, onRequestError)
    context.auth.setPermissions({ sessions: true })
    context.startSession.mockRejectedValue(new Error('session startup failed'))
    try {
      const response = await request(`${context.base}/session?token=private`, {
        method: 'POST',
        headers: { ...context.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', cols: 80, rows: 24 })
      })
      expect(response.statusCode).toBe(500)
      await bodyJson(response)
      expect(onRequestError).toHaveBeenCalledWith(expect.any(Error), 'POST', 'other')
      expect(JSON.stringify(onRequestError.mock.calls)).not.toContain('private')
    } finally { await context.server.stop() }
  })

  it('routes permitted terminal input and session starts', async () => {
    const context = await setup()
    context.auth.setPermissions({ messages: true, sessions: true })
    try {
      const input = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'term-1', data: 'hello' }) })
      const sessionRequest = { projectId: 'p1', agent: 'claude', cols: 80, rows: 24 }
      const session = await request(`${context.base}/session`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(sessionRequest) })
      expect(input.statusCode).toBe(200)
      expect(session.statusCode).toBe(200)
      expect(context.write).toHaveBeenCalledWith('term-1', 'hello')
      expect(context.startSession).toHaveBeenCalledWith(sessionRequest, expect.any(Function))
    } finally { await context.server.stop() }
  })

  it('never resizes host terminals: read-only browsers are refused and older clients are ignored', async () => {
    const onRequestComplete = vi.fn()
    const context = await setup(undefined, undefined, onRequestComplete)
    const body = JSON.stringify({ id: 'term-1', cols: 40, rows: 30 })
    try {
      context.auth.setPermissions({ messages: false })
      const refused = await request(`${context.base}/terminal/resize`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body })
      expect(refused.statusCode).toBe(403)
      expect(onRequestComplete).toHaveBeenCalledWith('POST', '/dawsha/api/terminal/resize', 403)
      context.auth.setPermissions({ messages: true })
      const ignored = await request(`${context.base}/terminal/resize`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body })
      expect(ignored.statusCode).toBe(200)
    } finally { await context.server.stop() }
  })

  it('requires session control to stop a remote session', async () => {
    const context = await setup()
    try {
      const denied = await request(`${context.base}/session/stop`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'new-term' }) })
      expect(denied.statusCode).toBe(403)
      expect(context.stopSession).not.toHaveBeenCalled()
      context.auth.setPermissions({ sessions: true })
      const stopped = await request(`${context.base}/session/stop`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'new-term' }) })
      expect(stopped.statusCode).toBe(200)
      expect(context.stopSession).toHaveBeenCalledWith('new-term')
    } finally { await context.server.stop() }
  })

  it('revokes the paired device token when the browser logs out', async () => {
    const context = await setup()
    try {
      const logout = await request(`${context.base}/logout`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: '{}' })
      expect(logout.statusCode).toBe(200)
      const state = await request(`${context.base}/state`, { headers: context.headers })
      expect(state.statusCode).toBe(401)
      expect(context.auth.listDevices()).toEqual([])
    } finally { await context.server.stop() }
  })

  it('keeps local shell terminals out of browser state and rejects their input', async () => {
    const context = await setup(undefined, undefined, undefined, Date.now, undefined, undefined, 'shell')
    context.auth.setPermissions({ messages: true })
    try {
      const state = await request(`${context.base}/state`, { headers: context.headers })
      const data = await bodyJson(state)
      expect(data.terminals).toEqual([])

      const input = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'term-1', data: 'whoami' }) })
      expect(input.statusCode).toBe(404)
      expect(context.write).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('does not upgrade a browser output stream for a local shell terminal', async () => {
    const context = await setup(undefined, undefined, undefined, Date.now, undefined, undefined, 'shell')
    let socket: WebSocket | undefined
    try {
      const closed = new Promise<number>((resolve) => {
        socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
        socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
        socket.once('open', () => resolve(101))
      })
      await expect(closed).resolves.toBe(403)
    } finally { if (socket?.readyState === WebSocket.OPEN) socket.close(); await context.server.stop() }
  })

  it('rechecks permissions after a control body finishes streaming', async () => {
    const context = await setup()
    context.auth.setPermissions({ messages: true, sessions: true })
    const body = JSON.stringify({ id: 'term-1', data: 'x' })
    try {
      const delayedRequest = (path: string): Promise<IncomingMessage> => new Promise((resolve, reject) => {
        const target = new URL(`${context.base}${path}`)
        const outgoing = httpRequest({
          hostname: '127.0.0.1', port: Number(target.port), path: target.pathname, method: 'POST',
          headers: { ...context.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, resolve)
        outgoing.on('error', reject)
        outgoing.write(body.slice(0, -2))
        setTimeout(() => {
          context.auth.setPermissions({ messages: false, sessions: false })
          outgoing.end(body.slice(-2))
        }, 20)
      })
      const input = await delayedRequest('/terminal/input')
      expect(input.statusCode).toBe(403)
      await bodyJson(input)
      expect(context.write).not.toHaveBeenCalled()

      context.auth.setPermissions({ messages: true, sessions: true })
      const sessionBody = JSON.stringify({ projectId: 'p1', cols: 80, rows: 24 })
      const target = new URL(`${context.base}/session`)
      const pendingSession = new Promise<IncomingMessage>((resolve, reject) => {
        const outgoing = httpRequest({
          hostname: '127.0.0.1', port: Number(target.port), path: target.pathname, method: 'POST',
          headers: { ...context.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sessionBody) }
        }, resolve)
        outgoing.on('error', reject)
        outgoing.write(sessionBody.slice(0, -2))
        setTimeout(() => {
          context.auth.revoke(context.paired.deviceId)
          outgoing.end(sessionBody.slice(-2))
        }, 20)
      })
      const session = await pendingSession
      expect(session.statusCode).toBe(401)
      await bodyJson(session)
      expect(context.startSession).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('rate-limits repeated state reads per paired browser', async () => {
    const context = await setup()
    let last: IncomingMessage | undefined
    try {
      for (let index = 0; index < 41; index++) {
        last = await request(`${context.base}/state`, { headers: context.headers })
        await bodyJson(last)
      }
      expect(last?.statusCode).toBe(429)
    } finally { await context.server.stop() }
  })

  it('keeps paired read-only devices from input or session controls', async () => {
    const context = await setup()
    try {
      const state = await request(`${context.base}/state`, { headers: context.headers })
      expect(state.statusCode).toBe(200)
      const data = await bodyJson(state) as { projects: unknown[]; terminals: unknown[]; permissions: { terminalInput: boolean } }
      expect(data.projects).toEqual([{ id: 'p1', name: 'Sample', defaultAgent: 'codex', sessions: [{ id: 'session-1', title: 'Existing', modifiedAt: 1, agent: 'codex' }] }])
      expect(JSON.stringify(data)).not.toContain('C:/private/sample')
      expect(data.permissions.terminalInput).toBe(false)

      const input = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'term-1', data: 'x' }) })
      const start = await request(`${context.base}/session`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'p1', cols: 80, rows: 24 }) })
      expect(input.statusCode).toBe(403)
      expect(start.statusCode).toBe(403)
      expect(context.write).not.toHaveBeenCalled()
      expect(context.startSession).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('returns bounded newest-first resumable sessions tagged by agent without project paths', async () => {
    const listSessions: RemoteServerOptions['listSessions'] = async (_project, agent) => Array.from({ length: 10 }, (_, index) => ({
      id: `${agent}-session-${index}`,
      title: `${agent} session ${index}`,
      modifiedAt: (agent === 'gemini' ? 100 : agent === 'codex' ? 50 : 0) + index
    }))
    const context = await setup(undefined, undefined, undefined, Date.now, undefined, listSessions)
    try {
      const response = await request(`${context.base}/state`, { headers: context.headers })
      const data = await bodyJson(response) as { projects: Array<{ folder?: string; sessions: Array<{ id: string; title: string; modifiedAt: number; agent: string }> }> }
      const sessions = data.projects[0].sessions
      expect(sessions).toHaveLength(15)
      expect(sessions[0]).toMatchObject({ id: 'gemini-session-9', agent: 'gemini', modifiedAt: 109 })
      expect(sessions.at(-1)).toMatchObject({ id: 'codex-session-5', agent: 'codex', modifiedAt: 55 })
      expect(sessions.map((session) => session.modifiedAt)).toEqual([...sessions.map((session) => session.modifiedAt)].sort((a, b) => b - a))
      expect(sessions.every((session) => ['claude', 'codex', 'gemini'].includes(session.agent))).toBe(true)
      expect(data.projects[0]).not.toHaveProperty('folder')
      expect(JSON.stringify(data)).not.toContain('C:/private/sample')
    } finally { await context.server.stop() }
  })

  it('rejects malformed or oversized control requests before invoking a terminal', async () => {
    const context = await setup()
    context.auth.setPermissions({ messages: true })
    try {
      const nullBody = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: 'null' })
      const malformed = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '../other', data: 'x' }) })
      const oversized = await request(`${context.base}/terminal/input`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'term-1', data: 'x'.repeat(20000) }) })
      expect(nullBody.statusCode).toBe(400)
      await bodyJson(nullBody)
      expect(malformed.statusCode).toBe(400)
      expect(oversized.statusCode).toBe(413)
      expect(context.write).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('streams active output and removes the subscription when the client disconnects', async () => {
    const context = await setup()
    let socket: WebSocket | undefined
    try {
      socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      const firstFrame = new Promise<string>((resolve) => socket!.once('message', (value) => resolve(value.toString())))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      const frame = await firstFrame
      expect(JSON.parse(frame)).toMatchObject({ event: 'snapshot', data: { output: 'hello', cols: 80, rows: 24 } })
      expect(context.outputListeners.size).toBe(1)
      socket.terminate()
      await vi.waitFor(() => expect(context.outputListeners.size).toBe(0))
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('sends the serialized screen first, then output and PTY resizes in order', async () => {
    const context = await setup()
    let socket: WebSocket | undefined
    const frames: Array<{ event: string; data: unknown }> = []
    try {
      socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      socket.on('message', (value) => frames.push(JSON.parse(value.toString())))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      for (const listener of context.outputListeners) {
        listener({ type: 'output', data: 'after' })
        listener({ type: 'resize', cols: 48, rows: 29 })
      }
      await vi.waitFor(() => expect(frames).toHaveLength(3))
      expect(frames.map((frame) => frame.event)).toEqual(['snapshot', 'output', 'resize'])
      expect(frames[1].data).toBe('after')
      expect(frames[2].data).toEqual({ cols: 48, rows: 29 })
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('ends a live stream immediately when its device is revoked', async () => {
    const context = await setup()
    let socket: WebSocket | undefined
    try {
      socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      const frames: string[] = []
      socket.on('message', (value) => frames.push(value.toString()))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      await vi.waitFor(() => expect(frames.some((frame) => frame.includes('"event":"snapshot"'))).toBe(true))
      context.auth.revoke(context.paired.deviceId)
      await vi.waitFor(() => expect(frames.some((frame) => frame.includes('"event":"revoked"'))).toBe(true))
      await vi.waitFor(() => expect(context.outputListeners.size).toBe(0))
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('ends a live stream when its paired token expires', async () => {
    let now = 1000
    const context = await setup(undefined, undefined, undefined, () => now, 5)
    let socket: WebSocket | undefined
    const frames: string[] = []
    try {
      socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      socket.on('message', (value) => frames.push(value.toString()))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      await vi.waitFor(() => expect(frames.some((frame) => frame.includes('snapshot'))).toBe(true))
      now = 1000 + REMOTE_TOKEN_TTL_MS
      await vi.waitFor(() => expect(socket!.readyState).toBe(WebSocket.CLOSED), { timeout: 200, interval: 10 })
      expect(frames.some((frame) => frame.includes('revoked'))).toBe(true)
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('closes a live stream if a heartbeat authorization check throws', async () => {
    const context = await setup(undefined, undefined, undefined, Date.now, 5)
    let socket: WebSocket | undefined
    let closeCode: number | undefined
    try {
      socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      socket.on('close', (code) => { closeCode = code })
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      vi.spyOn(context.auth, 'authorize').mockImplementation(() => { throw new Error('store write failed') })
      await vi.waitFor(() => expect(socket!.readyState).toBe(WebSocket.CLOSED), { timeout: 200, interval: 10 })
      expect(closeCode).toBe(1011)
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('returns an HTTP error instead of throwing when authorization fails during stream upgrade', async () => {
    const onRequestError = vi.fn()
    const context = await setup(undefined, onRequestError)
    vi.spyOn(context.auth, 'authorize').mockImplementation(() => { throw new Error('store write failed') })
    let socket: WebSocket | undefined
    try {
      const status = new Promise<number>((resolve) => {
        socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
        socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
        socket.once('open', () => resolve(101))
      })
      await expect(status).resolves.toBe(503)
      expect(onRequestError).toHaveBeenCalledWith(expect.any(Error), 'GET', '/dawsha/api/terminal/output')
    } finally { if (socket?.readyState === WebSocket.OPEN) socket.close(); await context.server.stop() }
  })

  it('closes the loopback listener when stopped', async () => {
    const context = await setup()
    const address = `http://127.0.0.1:${context.server.port}/dawsha/api/state`
    await context.server.stop()
    await expect(request(address)).rejects.toThrow()
    await context.server.stop()
  })
})

describe('phone capabilities are enforced by the server', () => {
  const post = (context: Awaited<ReturnType<typeof setup>>, path: string, body: unknown) =>
    request(`${context.base}${path}`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('refuses a message to a session while that capability is off, and says so in the activity log', async () => {
    const context = await setup()
    try {
      const denied = await post(context, '/terminal/input', { id: 'term-1', data: 'hello\r' })
      expect(denied.statusCode).toBe(403)
      expect((await bodyJson(denied)).error).toMatch(/turned off/)
      expect(context.write).not.toHaveBeenCalled()
      expect(context.activity).toEqual([{ device: 'Test browser', action: 'blocked', session: 'Codex · Sample', detail: 'sending a message' }])
    } finally { await context.server.stop() }
  })

  it('sends the message and logs it once the capability is on, and logs a Ctrl+C as an interrupt', async () => {
    const context = await setup()
    context.auth.setPermissions({ messages: true })
    try {
      expect((await post(context, '/terminal/input', { id: 'term-1', data: 'run the tests' })).statusCode).toBe(200)
      expect(context.activity).toEqual([])
      expect((await post(context, '/terminal/input', { id: 'term-1', data: '\r' })).statusCode).toBe(200)
      expect((await post(context, '/terminal/input', { id: 'term-1', data: '\u0003' })).statusCode).toBe(200)
      expect(context.write).toHaveBeenCalledTimes(3)
      expect(context.activity.map((entry) => entry.action)).toEqual(['message', 'interrupt'])
    } finally { await context.server.stop() }
  })

  it('refuses to start a session without the sessions capability and logs the attempt', async () => {
    const context = await setup()
    try {
      const denied = await post(context, '/session', { projectId: 'p1', cols: 80, rows: 24 })
      expect(denied.statusCode).toBe(403)
      expect(context.startSession).not.toHaveBeenCalled()
      expect(context.activity.map((entry) => [entry.action, entry.detail])).toEqual([['blocked', 'starting a session']])
      context.auth.setPermissions({ sessions: true })
      expect((await post(context, '/session', { projectId: 'p1', cols: 80, rows: 24 })).statusCode).toBe(200)
      expect(context.activity.at(-1)).toMatchObject({ action: 'session-started' })
    } finally { await context.server.stop() }
  })

  it('refuses the output stream while full terminal output is off, and allows it when on', async () => {
    const context = await setup()
    context.auth.setPermissions({ fullOutput: false })
    const connect = (): Promise<{ status: number; socket: WebSocket }> => new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/dawsha/api/terminal/output?id=term-1`, { headers: { ...context.headers, host: 'device.trycloudflare.com' } })
      socket.once('unexpected-response', (_request, response) => resolve({ status: response.statusCode ?? 0, socket }))
      socket.once('open', () => resolve({ status: 101, socket }))
    })
    try {
      const refused = await connect()
      expect(refused.status).toBe(403)
      context.auth.setPermissions({ fullOutput: true })
      const accepted = await connect()
      expect(accepted.status).toBe(101)
      accepted.socket.close()
    } finally { await context.server.stop() }
  })

  it('reports each capability to the phone so it can show or hide its controls', async () => {
    const context = await setup()
    context.auth.setPermissions({ fullOutput: false, messages: true })
    try {
      const state = await bodyJson(await request(`${context.base}/state`, { headers: context.headers }))
      expect(state.permissions).toEqual({ read: true, terminalInput: true, sessionControl: false, crew: false, approvals: false, commands: false, answers: false, fullOutput: false })
    } finally { await context.server.stop() }
  })
})
