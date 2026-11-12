import { request as httpRequest, type IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '../../src/shared/chatLog'
import { REMOTE_CHAT_ITEMS_MAX, REMOTE_CHAT_SEND_MAX, REMOTE_CHAT_SENDS_PER_MINUTE, checkChatSend, flattenMessage, toRemoteChat } from '../../src/shared/remoteChat'
import { createRemoteChatHost, type RemoteChatDependencies } from '../../src/main/remoteChat'
import { createRemoteAuth, type DeviceStore, type StoredDevice } from '../../src/main/remoteAuth'
import { startRemoteServer } from '../../src/main/remoteServer'
import type { Project } from '../../src/shared/types'

const tool = (extra: Record<string, unknown>): ChatItem => ({ kind: 'tool', id: 't1', activity: 'create', verb: 'Created', target: 'retry.test.ts', output: 'SECRET OUTPUT', outputTruncated: false, done: true, added: 64, path: 'C:\\work\\retry.test.ts', ...extra }) as ChatItem
const message = (id: string, role: 'user' | 'agent', text: string): ChatItem => ({ kind: 'message', id, role, text })

describe('toRemoteChat', () => {
  const items = [message('u1', 'user', 'Write tests'), tool({}), tool({ id: 't2', activity: 'edit', verb: 'Edited', target: 'a.ts', added: 3, removed: 1, path: 'a.ts' }), message('a1', 'agent', '<b>4 tests pass</b>')]

  it('keeps messages, one row per tool, and the reply summary, as plain text', () => {
    const payload = toRemoteChat(items, 'v1', 0)
    expect(payload.status).toBe('ok')
    if (payload.status !== 'ok') return
    expect(payload.items.map((item) => item.k)).toEqual(['you', 'tool', 'tool', 'say', 'sum'])
    expect(payload.items[1]).toMatchObject({ k: 'tool', verb: 'Created', target: 'retry.test.ts', add: 64 })
    expect(payload.items[4]).toEqual({ k: 'sum', id: 'a1:sum', files: 2, add: 67, del: 1 })
    expect(payload.items[3]).toMatchObject({ text: '<b>4 tests pass</b>' })
  })

  it('never carries tool output, full paths or commands', () => {
    const text = JSON.stringify(toRemoteChat(items, 'v1', 0))
    expect(text).not.toContain('SECRET OUTPUT')
    expect(text).not.toContain('C:\\\\work')
  })

  it('keeps only the newest items and counts the rest as earlier', () => {
    const many = Array.from({ length: REMOTE_CHAT_ITEMS_MAX + 30 }, (_, index) => message(`m${index}`, 'user', `hi ${index}`))
    const payload = toRemoteChat(many, 'v', 5)
    if (payload.status !== 'ok') throw new Error('expected ok')
    expect(payload.items).toHaveLength(REMOTE_CHAT_ITEMS_MAX)
    expect(payload.earlier).toBe(35)
    expect(payload.items.at(-1)?.id).toBe(`m${REMOTE_CHAT_ITEMS_MAX + 29}`)
  })

  it('strips control characters and cuts long text', () => {
    const payload = toRemoteChat([message('u', 'user', `a${String.fromCharCode(7)}b${'x'.repeat(9000)}`)], 'v', 0)
    if (payload.status !== 'ok' || payload.items[0].k !== 'you') throw new Error('expected a message')
    expect(payload.items[0].text.startsWith('abx')).toBe(true)
    expect(payload.items[0].text.length).toBeLessThan(4100)
  })
})

describe('checkChatSend', () => {
  it('accepts an id and text and flattens line breaks', () => {
    expect(checkChatSend({ id: 'term-1', text: 'Yes,\nand then commit ' })).toEqual({ ok: true, id: 'term-1', text: 'Yes, and then commit' })
    expect(flattenMessage('a\r\n\r\nb')).toBe('a b')
  })

  it('rejects bad ids, extra keys, empty and over-long text', () => {
    expect(checkChatSend(null).ok).toBe(false)
    expect(checkChatSend({ id: '../x', text: 'hi' }).ok).toBe(false)
    expect(checkChatSend({ id: 't', text: 'hi', cwd: 'C:\\' }).ok).toBe(false)
    expect(checkChatSend({ id: 't', text: '  \n ' }).ok).toBe(false)
    expect(checkChatSend({ id: 't', text: 5 }).ok).toBe(false)
    expect(checkChatSend({ id: 't', text: 'x'.repeat(REMOTE_CHAT_SEND_MAX + 1) }).ok).toBe(false)
    expect(checkChatSend({ id: 't', text: 'x'.repeat(REMOTE_CHAT_SEND_MAX) }).ok).toBe(true)
  })
})

const project = { id: 'p1', name: 'Platforms', folder: 'C:\\work', defaultAgent: 'claude' } as Project

function hostSetup(agent: 'claude' | 'codex' | 'shell' = 'claude') {
  const writes: string[] = []
  const tasks: Array<() => void> = []
  const dependencies: RemoteChatDependencies = {
    terminals: {
      snapshot: (id) => (id === undefined || id === 'term-1' ? [{ id: 'term-1', startedAt: 10_000, cols: 80, rows: 24, projectId: 'p1', agent }] : []),
      tail: async () => '',
      write: (_id, data) => { writes.push(data) }
    },
    getProjects: () => [project],
    listSessions: async () => [{ id: 'old', title: 'Old', modifiedAt: 1000 }, { id: 'live', title: 'Live', modifiedAt: 20_000 }] as never,
    readChat: vi.fn(async () => ({ status: 'ok' as const, items: [message('u1', 'user', 'hi')], version: 'claude:live#1', earlier: 0, background: [] })),
    schedule: (task) => { tasks.push(task) }
  }
  return { host: createRemoteChatHost(dependencies), writes, tasks, dependencies }
}

describe('remote chat host', () => {
  it('reads the session that has been written since the terminal started', async () => {
    const { host, dependencies } = hostSetup()
    const payload = await host.read('term-1')
    expect(payload.status).toBe('ok')
    expect(dependencies.readChat).toHaveBeenCalledWith({ agent: 'claude', sessionId: 'live', folder: 'C:\\work' })
  })

  it('refuses shells and unknown terminals', async () => {
    expect((await hostSetup('shell').host.read('term-1')).status).toBe('failed')
    expect((await hostSetup().host.read('nope')).status).toBe('failed')
  })

  it('types the message and presses Enter later, and checks permission before typing', () => {
    const { host, writes, tasks } = hostSetup()
    expect(host.send('term-1', 'hello', () => false)).toMatchObject({ ok: false, status: 403 })
    expect(writes).toEqual([])
    expect(host.send('term-1', 'hello', () => true)).toEqual({ ok: true })
    expect(writes).toEqual(['hello'])
    tasks[0]()
    expect(writes).toEqual(['hello', '\r'])
  })

  it('does not send to shells or ended terminals', () => {
    expect(hostSetup('shell').host.send('term-1', 'x', () => true)).toMatchObject({ ok: false, status: 404 })
    expect(hostSetup().host.send('gone', 'x', () => true)).toMatchObject({ ok: false, status: 404 })
  })
})

function createStore(): DeviceStore {
  let devices: StoredDevice[] = []
  return { load: () => devices, save: (next) => { devices = next } }
}

function http(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<IncomingMessage> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(target.port), path: target.pathname + target.search, method: init.method, headers: init.headers }, resolve)
    outgoing.on('error', reject)
    outgoing.end(init.body)
  })
}

async function serverSetup() {
  const auth = createRemoteAuth(createStore())
  const paired = auth.pair(auth.createPairingCode().code, 'Pixel 9')!
  const { host, writes } = hostSetup()
  const server = await startRemoteServer({
    getHostName: () => 'device.trycloudflare.com',
    auth,
    getProjects: () => [project],
    listSessions: async () => [],
    terminals: { snapshot: () => [], screen: async () => null, subscribe: () => null, write: vi.fn() },
    startSession: async () => ({ ok: true }),
    stopSession: () => true,
    chat: host
  })
  const base = `http://127.0.0.1:${server.port}/dawsha/api`
  const headers = { Host: 'device.trycloudflare.com', Origin: 'https://device.trycloudflare.com', Cookie: `dawsha_remote=${paired.token}` }
  return { server, auth, base, headers, json: { ...headers, 'Content-Type': 'application/json' }, writes }
}

describe('chat endpoints', () => {
  it('let any paired browser read the chat', async () => {
    const context = await serverSetup()
    try {
      const response = await http(`${context.base}/chat?id=term-1`, { headers: context.headers })
      expect(response.statusCode).toBe(200)
      expect((await http(`${context.base}/chat?id=..%2F`, { headers: context.headers })).statusCode).toBe(400)
      expect((await http(`${context.base}/chat?id=term-1`, { headers: { Host: 'device.trycloudflare.com' } })).statusCode).toBe(401)
    } finally { await context.server.stop() }
  })

  it('refuse a send without Terminal input, on every send, and type nothing', async () => {
    const context = await serverSetup()
    try {
      const body = JSON.stringify({ id: 'term-1', text: 'hello' })
      const refused = await http(`${context.base}/chat/send`, { method: 'POST', headers: context.json, body })
      expect(refused.statusCode).toBe(403)
      context.auth.setPermissions({ messages: true })
      expect((await http(`${context.base}/chat/send`, { method: 'POST', headers: context.json, body })).statusCode).toBe(200)
      expect(context.writes).toEqual(['hello'])
      context.auth.setPermissions({ messages: false })
      expect((await http(`${context.base}/chat/send`, { method: 'POST', headers: context.json, body })).statusCode).toBe(403)
      expect(context.writes).toEqual(['hello'])
    } finally { await context.server.stop() }
  })

  it('validate the body and rate limit sends per device', async () => {
    const context = await serverSetup()
    context.auth.setPermissions({ messages: true })
    try {
      const bad = await http(`${context.base}/chat/send`, { method: 'POST', headers: context.json, body: JSON.stringify({ id: 'term-1', text: 'x'.repeat(REMOTE_CHAT_SEND_MAX + 1) }) })
      expect(bad.statusCode).toBe(400)
      const ok = JSON.stringify({ id: 'term-1', text: 'hi' })
      let last = 0
      for (let index = 0; index < REMOTE_CHAT_SENDS_PER_MINUTE + 1; index += 1) last = (await http(`${context.base}/chat/send`, { method: 'POST', headers: context.json, body: ok })).statusCode ?? 0
      expect(last).toBe(429)
    } finally { await context.server.stop() }
  })
})
