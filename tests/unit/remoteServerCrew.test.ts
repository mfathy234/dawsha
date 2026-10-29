import { request as httpRequest, type IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteAuth, type DeviceStore, type StoredDevice } from '../../src/main/remoteAuth'
import type { RemoteCrewHost } from '../../src/main/remoteCrew'
import { startRemoteServer } from '../../src/main/remoteServer'
import type { RemoteActivityInput } from '../../src/shared/remoteActivity'

function createStore(): DeviceStore {
  let devices: StoredDevice[] = []
  return { load: () => devices, save: (next) => { devices = next } }
}

function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<IncomingMessage> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(target.port), path: target.pathname, method: init.method, headers: init.headers }, resolve)
    outgoing.on('error', reject)
    outgoing.end(init.body)
  })
}

async function bodyJson(response: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
}

async function setup() {
  const auth = createRemoteAuth(createStore())
  const paired = auth.pair(auth.createPairingCode().code, 'Pixel 9')!
  const activity: RemoteActivityInput[] = []
  const crew: RemoteCrewHost = {
    list: vi.fn(() => ({ members: [{ id: 'rami', name: 'Rami', role: 'Reviews', initials: 'RA', colour: 'green' as const, fields: ['pr'], models: ['default' as const], projects: [], state: 'idle' as const }], jobs: [], goal: null })),
    run: vi.fn(async () => ({ ok: true as const, runId: 'run1', member: 'Rami', project: 'Platforms' }))
  }
  const server = await startRemoteServer({
    getHostName: () => 'device.trycloudflare.com',
    auth,
    getProjects: () => [],
    listSessions: async () => [],
    terminals: { snapshot: () => [], screen: async () => null, subscribe: () => null, write: vi.fn() },
    startSession: async () => ({ ok: true }),
    stopSession: () => true,
    crew,
    onActivity: (entry) => activity.push(entry)
  })
  const base = `http://127.0.0.1:${server.port}/dawsha/api`
  const headers = { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', Cookie: `dawsha_remote=${paired.token}` }
  const json = { ...headers, 'Content-Type': 'application/json' }
  const runBody = JSON.stringify({ member: 'rami', project: 'p1', fields: { pr: '1' } })
  return { server, base, headers, json, auth, crew, activity, runBody }
}

describe('crew endpoints', () => {
  it('refuse both routes while the capability is off, even with sessions and messages on, and log the blocked run', async () => {
    const context = await setup()
    context.auth.setPermissions({ messages: true, sessions: true, commands: true, answers: true, fullOutput: true })
    try {
      const list = await request(`${context.base}/crew`, { headers: context.headers })
      const run = await request(`${context.base}/crew/run`, { method: 'POST', headers: context.json, body: context.runBody })
      expect(list.statusCode).toBe(403)
      expect(run.statusCode).toBe(403)
      expect((await bodyJson(run)).error).toMatch(/turned off/)
      expect(context.crew.list).not.toHaveBeenCalled()
      expect(context.crew.run).not.toHaveBeenCalled()
      expect(context.activity).toEqual([{ device: 'Pixel 9', action: 'blocked', session: null, detail: 'running an agent' }])
      const state = await bodyJson(await request(`${context.base}/state`, { headers: context.headers }))
      expect(state.permissions.crew).toBe(false)
    } finally { await context.server.stop() }
  })

  it('need a paired device, a same-origin request and a JSON body', async () => {
    const context = await setup()
    context.auth.setPermissions({ crew: true })
    try {
      expect((await request(`${context.base}/crew`, { headers: { Host: 'device.trycloudflare.com' } })).statusCode).toBe(401)
      expect((await request(`${context.base}/crew/run`, { method: 'POST', headers: { ...context.json, Origin: 'https://attacker.example' }, body: context.runBody })).statusCode).toBe(403)
      expect((await request(`${context.base}/crew/run`, { method: 'POST', headers: { ...context.headers, 'Content-Type': 'text/plain' }, body: context.runBody })).statusCode).toBe(415)
      expect(context.crew.run).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })

  it('list the agents and start a run when the capability is on, naming the phone in the activity log', async () => {
    const context = await setup()
    context.auth.setPermissions({ crew: true })
    try {
      const state = await bodyJson(await request(`${context.base}/state`, { headers: context.headers }))
      expect(state.permissions).toMatchObject({ crew: true, terminalInput: false })
      const list = await request(`${context.base}/crew`, { headers: context.headers })
      expect(list.statusCode).toBe(200)
      expect((await bodyJson(list)).members[0]).toMatchObject({ id: 'rami', fields: ['pr'] })
      const run = await request(`${context.base}/crew/run`, { method: 'POST', headers: context.json, body: context.runBody })
      expect(run.statusCode).toBe(200)
      expect(await bodyJson(run)).toEqual({ runId: 'run1' })
      expect(context.crew.run).toHaveBeenCalledWith({ member: 'rami', project: 'p1', fields: { pr: '1' } })
      expect(context.activity).toEqual([{ device: 'Pixel 9', action: 'crew-run', session: 'Platforms', detail: 'Rami' }])
    } finally { await context.server.stop() }
  })

  it('answer a refused run with 400 and the reason, and log nothing', async () => {
    const context = await setup()
    context.auth.setPermissions({ crew: true })
    vi.mocked(context.crew.run).mockResolvedValueOnce({ ok: false, error: 'Rami is limited to Billing.' })
    try {
      const run = await request(`${context.base}/crew/run`, { method: 'POST', headers: context.json, body: context.runBody })
      expect(run.statusCode).toBe(400)
      expect((await bodyJson(run)).error).toBe('Rami is limited to Billing.')
      expect(context.activity).toEqual([])
    } finally { await context.server.stop() }
  })

  it('stop at once when the capability is switched off after pairing', async () => {
    const context = await setup()
    context.auth.setPermissions({ crew: true })
    try {
      expect((await request(`${context.base}/crew`, { headers: context.headers })).statusCode).toBe(200)
      context.auth.setPermissions({ crew: false })
      expect((await request(`${context.base}/crew/run`, { method: 'POST', headers: context.json, body: context.runBody })).statusCode).toBe(403)
      expect(context.crew.run).not.toHaveBeenCalled()
    } finally { await context.server.stop() }
  })
})
