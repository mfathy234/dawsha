import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createRemoteAuth, type DeviceStore, type StoredDevice } from '../../src/main/remoteAuth'
import type { RemoteApprovals } from '../../src/main/remoteApprovals'
import { startRemoteServer } from '../../src/main/remoteServer'
import type { ApprovalsPayload } from '../../src/shared/approvals'

function createStore(): DeviceStore {
  let devices: StoredDevice[] = []
  return { load: () => devices, save: (next) => { devices = next } }
}

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

const payload: ApprovalsPayload = {
  items: [{ id: 't1', projectId: 'p1', projectName: 'billing-api', agent: 'codex', title: 'Codex needs you', text: 'Bash command\n npm test', kind: 'command', summary: 'npm test', fingerprint: '0123456789abcdef', since: 1, restriction: null, canAllow: true }],
  history: [],
  notify: true
}

async function setup(assetDirectory?: string, heartbeatIntervalMs?: number) {
  const auth = createRemoteAuth(createStore())
  const paired = auth.pair(auth.createPairingCode().code, 'Pixel 8')!
  const listeners = new Set<(next: ApprovalsPayload) => void>()
  const approvals: RemoteApprovals = {
    snapshot: vi.fn(async () => payload),
    answer: vi.fn(async () => ({ ok: true as const, reasonSent: true })),
    recordDesktopAnswer: vi.fn(async () => undefined),
    subscribe: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener) }),
    stop: vi.fn()
  }
  const write = vi.fn()
  const server = await startRemoteServer({
    getHostName: () => 'device.trycloudflare.com',
    auth,
    getProjects: () => [],
    listSessions: async () => [],
    terminals: { snapshot: () => [], screen: async () => null, subscribe: () => null, write },
    startSession: async () => ({ ok: true }),
    stopSession: () => true,
    approvals,
    assetDirectory,
    heartbeatIntervalMs
  })
  const base = `http://127.0.0.1:${server.port}/dawsha/api`
  const headers = { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', Cookie: `dawsha_remote=${paired.token}` }
  const json = { ...headers, 'Content-Type': 'application/json' }
  const answerBody = { id: 't1', fingerprint: '0123456789abcdef', allow: true }
  return { server, base, headers, json, auth, approvals, write, listeners, answerBody, paired }
}

describe('approval endpoints', () => {
  it('refuse every approval route while the permission is off, even with terminal input on', async () => {
    const context = await setup()
    context.auth.setPermissions({ terminalInput: true, sessionControl: true })
    try {
      const list = await request(`${context.base}/approvals`, { headers: context.headers })
      const answer = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify(context.answerBody) })
      expect(list.statusCode).toBe(403)
      expect(answer.statusCode).toBe(403)
      expect((await bodyJson(answer)).error).toMatch(/turned off/)
      expect(context.approvals.snapshot).not.toHaveBeenCalled()
      expect(context.approvals.answer).not.toHaveBeenCalled()
      expect(context.write).not.toHaveBeenCalled()
      const state = await bodyJson(await request(`${context.base}/state`, { headers: context.headers }))
      expect(state.permissions.approvals).toBe(false)
    } finally { await context.server.stop() }
  })

  it('require a paired device, a same-origin request and a JSON body', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    try {
      const anonymous = await request(`${context.base}/approvals`, { headers: { Host: 'device.trycloudflare.com' } })
      expect(anonymous.statusCode).toBe(401)
      const noOrigin = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: { ...context.json, Origin: 'https://attacker.example' }, body: JSON.stringify(context.answerBody) })
      expect(noOrigin.statusCode).toBe(403)
      const missingOrigin = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: { Host: 'device.trycloudflare.com', Cookie: context.headers.Cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(context.answerBody) })
      expect(missingOrigin.statusCode).toBe(403)
      const text = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'text/plain' }, body: JSON.stringify(context.answerBody) })
      expect(text.statusCode).toBe(415)
      expect(context.approvals.answer).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('list and answer when the permission is on, naming the paired device', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    try {
      const state = await bodyJson(await request(`${context.base}/state`, { headers: context.headers }))
      expect(state.permissions).toMatchObject({ approvals: true, terminalInput: false })
      const list = await request(`${context.base}/approvals`, { headers: context.headers })
      expect(list.statusCode).toBe(200)
      expect((await bodyJson(list)).items[0]).toMatchObject({ id: 't1', summary: 'npm test' })
      const answer = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify({ ...context.answerBody, allow: false, reason: 'Use pnpm' }) })
      expect(answer.statusCode).toBe(200)
      expect(await bodyJson(answer)).toEqual({ ok: true, reasonSent: true })
      expect(context.approvals.answer).toHaveBeenCalledWith({ id: 't1', fingerprint: '0123456789abcdef', allow: false, reason: 'Use pnpm', device: 'Pixel 8' })
      expect(context.write).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('reject malformed answers before reaching the service', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    try {
      const bad = [
        { ...context.answerBody, fingerprint: 'nope' },
        { ...context.answerBody, id: '../x' },
        { ...context.answerBody, allow: 'yes' },
        { ...context.answerBody, reason: 'x'.repeat(601) },
        { ...context.answerBody, reason: 7 },
        { id: 't1' }
      ]
      for (const body of bad) {
        const response = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify(body) })
        expect(response.statusCode).toBe(400)
      }
      expect(context.approvals.answer).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('pass through a stale-prompt refusal with its status and message', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    vi.mocked(context.approvals.answer).mockResolvedValueOnce({ ok: false, status: 409, error: 'That prompt changed.' })
    try {
      const response = await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify(context.answerBody) })
      expect(response.statusCode).toBe(409)
      expect((await bodyJson(response)).error).toBe('That prompt changed.')
    } finally { await context.server.stop() }
  })

  it('rate-limit answers per device', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    try {
      let last = 0
      for (let index = 0; index < 61; index += 1) {
        last = (await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify(context.answerBody) })).statusCode ?? 0
      }
      expect(last).toBe(429)
    } finally { await context.server.stop() }
  })

  it('stop working as soon as the permission is turned off again', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    try {
      expect((await request(`${context.base}/approvals`, { headers: context.headers })).statusCode).toBe(200)
      context.auth.setPermissions({ approvals: false })
      expect((await request(`${context.base}/approvals`, { headers: context.headers })).statusCode).toBe(403)
      expect((await request(`${context.base}/approvals/answer`, { method: 'POST', headers: context.json, body: JSON.stringify(context.answerBody) })).statusCode).toBe(403)
    } finally { await context.server.stop() }
  })
})

describe('approval stream', () => {
  const open = (port: number, headers: Record<string, string>): WebSocket => new WebSocket(`ws://127.0.0.1:${port}/dawsha/api/approvals/stream`, { headers: { ...headers, host: 'device.trycloudflare.com' } })

  it('is refused without the permission and with a foreign origin', async () => {
    const context = await setup()
    try {
      const refused = open(context.server.port, context.headers)
      await expect(new Promise((resolve, reject) => { refused.once('open', resolve); refused.once('error', reject) })).rejects.toBeTruthy()
      context.auth.setPermissions({ approvals: true })
      const foreign = open(context.server.port, { ...context.headers, Origin: 'https://attacker.example' })
      await expect(new Promise((resolve, reject) => { foreign.once('open', resolve); foreign.once('error', reject) })).rejects.toBeTruthy()
      expect(context.approvals.subscribe).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('sends the current prompts, pushes changes, and unsubscribes on disconnect', async () => {
    const context = await setup()
    context.auth.setPermissions({ approvals: true })
    let socket: WebSocket | undefined
    try {
      socket = open(context.server.port, context.headers)
      const frames: Array<{ event: string; data: ApprovalsPayload }> = []
      socket.on('message', (value) => frames.push(JSON.parse(value.toString())))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      expect(frames[0]).toMatchObject({ event: 'approvals', data: { items: [{ id: 't1' }] } })
      for (const listener of context.listeners) listener({ ...payload, items: [] })
      await vi.waitFor(() => expect(frames).toHaveLength(2))
      expect(frames[1].data.items).toEqual([])
      socket.terminate()
      await vi.waitFor(() => expect(context.listeners.size).toBe(0))
    } finally { socket?.terminate(); await context.server.stop() }
  })

  it('closes when the permission is turned off', async () => {
    const context = await setup(undefined, 10)
    context.auth.setPermissions({ approvals: true })
    let socket: WebSocket | undefined
    try {
      socket = open(context.server.port, context.headers)
      const frames: string[] = []
      socket.on('message', (value) => frames.push(value.toString()))
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      context.auth.setPermissions({ approvals: false })
      await vi.waitFor(() => expect(frames.some((frame) => frame.includes('"event":"denied"'))).toBe(true))
      await vi.waitFor(() => expect(context.listeners.size).toBe(0))
    } finally { socket?.terminate(); await context.server.stop() }
  })
})

describe('service worker file', () => {
  it('is served without a cookie, scoped to the remote prefix, with its own strict CSP', async () => {
    const assetDirectory = mkdtempSync(join(tmpdir(), 'dawsha-remote-sw-'))
    writeFileSync(join(assetDirectory, 'remote-sw.js'), 'self.addEventListener("install", () => undefined)')
    const context = await setup(assetDirectory)
    try {
      const response = await request(`http://127.0.0.1:${context.server.port}/dawsha/sw.js`, { headers: { Host: 'device.trycloudflare.com' } })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/javascript')
      expect(response.headers['service-worker-allowed']).toBe('/dawsha/')
      expect(response.headers['content-security-policy']).toBe("default-src 'none'; connect-src 'self'")
      expect(response.headers['cache-control']).toBe('no-cache')
      const wrongHost = await request(`http://127.0.0.1:${context.server.port}/dawsha/sw.js`, { headers: { Host: 'attacker.example' } })
      expect(wrongHost.statusCode).toBe(403)
    } finally {
      await context.server.stop()
      rmSync(assetDirectory, { recursive: true, force: true })
    }
  })
})
