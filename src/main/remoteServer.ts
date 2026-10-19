import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { AGENTS } from '../shared/agents'
import type { AgentKind, Project, ResumeEntry } from '../shared/types'
import type { RemoteAuth } from './remoteAuth'
import { REMOTE_TOKEN_TTL_MS } from './remoteAuth'
import type { RemoteApprovals } from './remoteApprovals'
import type { RemoteTerminalFrame, RemoteTerminalScreen, RemoteTerminalSnapshot } from './remoteTerminalState'

const REMOTE_PREFIX = '/dawsha'
const COOKIE_NAME = 'dawsha_remote'
const REMOTE_API_PATHS = new Set([
  `${REMOTE_PREFIX}/api/pair`,
  `${REMOTE_PREFIX}/api/state`,
  `${REMOTE_PREFIX}/api/terminal/input`,
  `${REMOTE_PREFIX}/api/terminal/resize`,
  `${REMOTE_PREFIX}/api/session`,
  `${REMOTE_PREFIX}/api/session/stop`,
  `${REMOTE_PREFIX}/api/logout`,
  `${REMOTE_PREFIX}/api/terminal/output`,
  `${REMOTE_PREFIX}/api/approvals`,
  `${REMOTE_PREFIX}/api/approvals/answer`,
  `${REMOTE_PREFIX}/api/approvals/stream`
])
const MAX_BODY_BYTES = 16 * 1024
const MAX_TERMINAL_INPUT = 4096
const MAX_REASON_INPUT = 600
const MAX_APPROVAL_CLIENTS = 4
const APPROVALS_DISABLED = 'Answering permission prompts is turned off in Dawsha settings.'
const MAX_OUTPUT_CLIENTS = 8
const MAX_REMOTE_SESSIONS_PER_PROJECT = 15
const RATE_WINDOW_MS = 60_000

export interface RemoteServerHandle {
  port: number
  stop(): Promise<void>
}

export interface RemoteServerOptions {
  getHostName(): string | null
  auth: Pick<RemoteAuth, 'pair' | 'authorize' | 'can' | 'revoke' | 'onRevoke'>
  getProjects(): Project[]
  listSessions(project: Project, agent: AgentKind): Promise<ResumeEntry[]>
  terminals: {
    snapshot(id?: string): RemoteTerminalSnapshot[]
    screen(id: string): Promise<RemoteTerminalScreen | null>
    subscribe(id: string, listener: (frame: RemoteTerminalFrame) => void): (() => void) | null
    write(id: string, data: string): void
  }
  approvals?: RemoteApprovals
  startSession(input: unknown, authorizeStart: () => boolean): Promise<{ ok: boolean; error?: string; id?: string }>
  stopSession(id: string): boolean
  assetDirectory?: string
  heartbeatIntervalMs?: number
  onRequestError?(error: unknown, method: string, pathname: string): void
  onRequestComplete?(method: string, pathname: string, statusCode: number): void
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
  response.end(JSON.stringify(data))
}

function cookieToken(request: IncomingMessage): string | null {
  const cookies = request.headers.cookie?.split(';') ?? []
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=')
    if (name === COOKIE_NAME) return value.join('=') || null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(request: IncomingMessage, response: ServerResponse): Promise<unknown | null> {
  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    sendJson(response, 413, { error: 'Request is too large.' })
    return null
  }
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) tooLarge = true
      else if (!tooLarge) chunks.push(buffer)
    }
  } catch {
    sendJson(response, 400, { error: 'Could not read request body.' })
    return null
  }
  if (tooLarge) {
    sendJson(response, 413, { error: 'Request is too large.' })
    return null
  }
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { error: 'Send a JSON request.' })
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (parsed === null) {
      sendJson(response, 400, { error: 'Request body must be a JSON object.' })
      return null
    }
    return parsed
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON.' })
    return null
  }
}

function safeHost(hostName: string): boolean {
  return /^[a-zA-Z0-9.-]+$/.test(hostName) && !hostName.startsWith('.') && !hostName.endsWith('.')
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

async function serveAsset(options: RemoteServerOptions, pathname: string, response: ServerResponse): Promise<boolean> {
  if (!options.assetDirectory) return false
  let filePath: string
  if (pathname === '/') filePath = resolve(options.assetDirectory, 'remote.html')
  else if (pathname === '/sw.js') filePath = resolve(options.assetDirectory, 'remote-sw.js')
  else if (pathname.startsWith('/assets/')) {
    const fileName = pathname.slice('/assets/'.length)
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName) || basename(fileName) !== fileName || fileName.includes('..')) return false
    filePath = resolve(options.assetDirectory, 'assets', fileName)
  } else return false

  try {
    const body = await readFile(filePath)
    if (pathname === '/sw.js') {
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Service-Worker-Allowed': `${REMOTE_PREFIX}/`,
        'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      })
      response.end(body)
      return true
    }
    response.writeHead(200, {
      'Content-Type': filePath.endsWith('remote.html') ? 'text/html; charset=utf-8' : contentType(filePath),
      'Cache-Control': filePath.endsWith('remote.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://${options.getHostName()}; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    })
    response.end(body)
    return true
  } catch {
    return false
  }
}

export async function startRemoteServer(options: RemoteServerOptions): Promise<RemoteServerHandle> {
  const streams = new Set<WebSocket>()
  const approvalStreams = new Set<WebSocket>()
  const cleanups = new Map<WebSocket, () => void>()
  const rateLimits = new Map<string, Map<string, { windowStarted: number; count: number }>>()
  let stopped = false

  function withinRateLimit(deviceId: string, operation: string, max: number): boolean {
    const now = Date.now()
    const operations = rateLimits.get(deviceId) ?? new Map<string, { windowStarted: number; count: number }>()
    const current = operations.get(operation)
    if (!current || now - current.windowStarted >= RATE_WINDOW_MS) {
      operations.set(operation, { windowStarted: now, count: 1 })
      rateLimits.set(deviceId, operations)
      return true
    }
    if (current.count >= max) return false
    current.count += 1
    return true
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const hostname = options.getHostName()?.toLowerCase() ?? ''
    if (!safeHost(hostname) || !hostname.endsWith('.trycloudflare.com')) {
      sendJson(response, 503, { error: 'Cloudflare Quick Tunnel is not ready.' })
      return
    }
    const expectedHosts = new Set([hostname, `${hostname}:443`])
    const origin = `https://${hostname}`
    const requestHost = request.headers.host?.toLowerCase()
    if (!requestHost || !expectedHosts.has(requestHost)) {
      sendJson(response, 403, { error: 'This host is not allowed.' })
      return
    }
    if (request.headers.origin && request.headers.origin !== origin) {
      sendJson(response, 403, { error: 'This origin is not allowed.' })
      return
    }
    if (request.method !== 'GET' && request.headers.origin !== origin) {
      sendJson(response, 403, { error: 'A same-origin request is required.' })
      return
    }

    let url: URL
    try { url = new URL(request.url ?? '/', `http://${hostname}`) } catch {
      sendJson(response, 400, { error: 'Invalid request path.' })
      return
    }
    if (url.pathname === REMOTE_PREFIX) {
      response.writeHead(308, { Location: `${REMOTE_PREFIX}/`, 'Cache-Control': 'no-store' })
      response.end()
      return
    }
    if (!url.pathname.startsWith(`${REMOTE_PREFIX}/`)) {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }
    const path = url.pathname.slice(REMOTE_PREFIX.length) || '/'
    if (request.method === 'GET' && await serveAsset(options, path, response)) return
    if (request.method === 'GET' && path === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(JSON.stringify({ ok: true, app: 'dawsha' }))
      return
    }

    if (request.method === 'POST' && path === '/api/pair') {
      const body = await readJson(request, response)
      if (body === null || response.writableEnded) return
      if (!isRecord(body) || typeof body.code !== 'string' || typeof body.deviceName !== 'string' || body.code.length > 12 || body.deviceName.length > 80) {
        sendJson(response, 400, { error: 'Invalid pairing request.' })
        return
      }
      const paired = options.auth.pair(body.code, body.deviceName)
      if (!paired) {
        sendJson(response, 401, { error: 'That pairing code is invalid or expired.' })
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE_NAME}=${paired.token}; Path=${REMOTE_PREFIX}; Max-Age=${Math.floor(REMOTE_TOKEN_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`,
        'X-Content-Type-Options': 'nosniff'
      })
      response.end(JSON.stringify({ deviceId: paired.deviceId }))
      return
    }

    const token = cookieToken(request)
    const device = token ? options.auth.authorize(token) : null
    if (!token || !device || !options.auth.can(token, 'read')) {
      sendJson(response, 401, { error: 'Pair this browser with Dawsha to continue.' })
      return
    }

    if (request.method === 'GET' && path === '/api/state') {
      if (!withinRateLimit(device.id, 'state', 40)) {
        sendJson(response, 429, { error: 'Too many requests. Try again shortly.' })
        return
      }
      const projects = options.getProjects()
      const safeProjects = await Promise.all(projects.map(async (project) => {
        const sessionsByAgent = await Promise.all(AGENTS.map(async (agent) =>
          (await options.listSessions(project, agent)).map((session) => ({
            id: session.id,
            title: session.title,
            modifiedAt: session.modifiedAt,
            agent
          }))
        ))
        const sessions = sessionsByAgent.flat()
          .sort((a, b) => b.modifiedAt - a.modifiedAt)
          .slice(0, MAX_REMOTE_SESSIONS_PER_PROJECT)
        return { id: project.id, name: project.name, defaultAgent: project.defaultAgent, sessions }
      }))
      sendJson(response, 200, {
        device: { id: device.id, name: device.name },
        projects: safeProjects,
        terminals: options.terminals.snapshot().filter((terminal) => terminal.agent !== null && terminal.agent !== 'shell'),
        permissions: {
          read: true,
          terminalInput: options.auth.can(token, 'terminalInput'),
          sessionControl: options.auth.can(token, 'sessionControl'),
          approvals: Boolean(options.approvals) && options.auth.can(token, 'approvals')
        }
      })
      return
    }

    if (request.method === 'GET' && path === '/api/terminal/output') {
      if (!withinRateLimit(device.id, 'stream', 30)) {
        sendJson(response, 429, { error: 'Too many terminal streams were opened recently.' })
        return
      }
      sendJson(response, 426, { error: 'Terminal output requires a WebSocket connection.' })
      return
    }

    if (request.method === 'POST' && path.startsWith('/api/terminal/')) {
      if (!withinRateLimit(device.id, 'terminal-control', 600)) {
        sendJson(response, 429, { error: 'Too many terminal controls. Try again shortly.' })
        return
      }
      const body = await readJson(request, response)
      if (body === null || response.writableEnded) return
      if (!isRecord(body) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) {
        sendJson(response, 400, { error: 'Invalid terminal request.' })
        return
      }
      const terminal = options.terminals.snapshot(body.id)[0]
      if (!terminal || terminal.agent === null || terminal.agent === 'shell') {
        sendJson(response, 404, { error: 'That terminal is no longer active.' })
        return
      }
      if (path === '/api/terminal/input' && typeof body.data === 'string' && body.data.length <= MAX_TERMINAL_INPUT) {
        if (!options.auth.authorize(token)) {
          sendJson(response, 401, { error: 'Pair this browser again.' })
          return
        }
        if (!options.auth.can(token, 'terminalInput')) {
          sendJson(response, 403, { error: 'Terminal control is disabled in Dawsha settings.' })
          return
        }
        options.terminals.write(body.id, body.data)
        sendJson(response, 200, { ok: true })
        return
      }
      if (path === '/api/terminal/resize' && Number.isInteger(body.cols) && Number.isInteger(body.rows) && (body.cols as number) >= 2 && (body.cols as number) <= 400 && (body.rows as number) >= 1 && (body.rows as number) <= 200) {
        if (!options.auth.authorize(token)) {
          sendJson(response, 401, { error: 'Pair this browser again.' })
          return
        }
        if (!options.auth.can(token, 'terminalInput')) {
          sendJson(response, 403, { error: 'Terminal control is disabled in Dawsha settings.' })
          return
        }
        // Browsers mirror the desktop size and no longer resize the PTY: an agent redrawn for a
        // phone-width PTY garbled the desktop pane. Accept old clients' requests and ignore them.
        sendJson(response, 200, { ok: true })
        return
      }
      sendJson(response, 400, { error: 'Invalid terminal control request.' })
      return
    }

    if (path === '/api/approvals' && request.method === 'GET') {
      if (!options.approvals || !options.auth.can(token, 'approvals')) {
        sendJson(response, 403, { error: APPROVALS_DISABLED })
        return
      }
      if (!withinRateLimit(device.id, 'approvals', 120)) {
        sendJson(response, 429, { error: 'Too many requests. Try again shortly.' })
        return
      }
      sendJson(response, 200, await options.approvals.snapshot())
      return
    }

    if (path === '/api/approvals/answer' && request.method === 'POST') {
      if (!options.approvals || !options.auth.can(token, 'approvals')) {
        sendJson(response, 403, { error: APPROVALS_DISABLED })
        return
      }
      if (!withinRateLimit(device.id, 'approvals-answer', 60)) {
        sendJson(response, 429, { error: 'Too many answers. Try again shortly.' })
        return
      }
      const body = await readJson(request, response)
      if (body === null || response.writableEnded) return
      if (!isRecord(body) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id) ||
          typeof body.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(body.fingerprint) || typeof body.allow !== 'boolean' ||
          (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > MAX_REASON_INPUT))) {
        sendJson(response, 400, { error: 'Invalid approval request.' })
        return
      }
      if (!options.auth.authorize(token) || !options.auth.can(token, 'approvals')) {
        sendJson(response, 403, { error: APPROVALS_DISABLED })
        return
      }
      const result = await options.approvals.answer({ id: body.id, fingerprint: body.fingerprint, allow: body.allow, reason: body.reason, device: device.name })
      if (!result.ok) {
        sendJson(response, result.status, { error: result.error })
        return
      }
      sendJson(response, 200, { ok: true, reasonSent: result.reasonSent, ...(result.reasonFailure ? { reasonFailure: result.reasonFailure } : {}) })
      return
    }

    if (request.method === 'POST' && path === '/api/session') {
      if (!options.auth.can(token, 'sessionControl')) {
        sendJson(response, 403, { error: 'Remote session control is disabled in Dawsha settings.' })
        return
      }
      if (!withinRateLimit(device.id, 'session-control', 5)) {
        sendJson(response, 429, { error: 'Too many session starts. Try again shortly.' })
        return
      }
      const body = await readJson(request, response)
      if (body === null || response.writableEnded) return
      if (!options.auth.authorize(token)) {
        sendJson(response, 401, { error: 'Pair this browser again.' })
        return
      }
      if (!options.auth.can(token, 'sessionControl')) {
        sendJson(response, 403, { error: 'Remote session control is disabled in Dawsha settings.' })
        return
      }
      const result = await options.startSession(body, () => Boolean(options.auth.authorize(token)) && options.auth.can(token, 'sessionControl'))
      if (!result.ok) {
        sendJson(response, 400, { error: result.error ?? 'Could not start the session.' })
        return
      }
      sendJson(response, 200, { id: result.id })
      return
    }

    if (request.method === 'POST' && path === '/api/session/stop') {
      if (!options.auth.can(token, 'sessionControl')) {
        sendJson(response, 403, { error: 'Remote session control is disabled in Dawsha settings.' })
        return
      }
      if (!withinRateLimit(device.id, 'session-control', 5)) {
        sendJson(response, 429, { error: 'Too many session controls. Try again shortly.' })
        return
      }
      const body = await readJson(request, response)
      if (body === null || response.writableEnded) return
      if (!isRecord(body) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) {
        sendJson(response, 400, { error: 'Invalid session request.' })
        return
      }
      if (!options.auth.authorize(token) || !options.auth.can(token, 'sessionControl')) {
        sendJson(response, 401, { error: 'Pair this browser again.' })
        return
      }
      if (!options.stopSession(body.id)) {
        sendJson(response, 404, { error: 'That remote session is no longer active.' })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && path === '/api/logout') {
      options.auth.revoke(device.id)
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE_NAME}=; Path=${REMOTE_PREFIX}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
      })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    sendJson(response, 404, { error: 'Not found.' })
  }

  const server = createServer((request, response) => {
    response.once('finish', () => {
      try {
        const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname
        if (requestPath.startsWith(`${REMOTE_PREFIX}/api/`)) {
          const pathname = REMOTE_API_PATHS.has(requestPath) ? requestPath : 'other'
          options.onRequestComplete?.(request.method ?? 'UNKNOWN', pathname, response.statusCode)
        }
      } catch {
        // Diagnostics must never affect a completed request.
      }
    })
    void handle(request, response).catch((error: unknown) => {
      try {
        const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname
        const pathname = requestPath === `${REMOTE_PREFIX}/api/pair` || requestPath === `${REMOTE_PREFIX}/api/state`
          ? requestPath
          : 'other'
        options.onRequestError?.(error, request.method ?? 'UNKNOWN', pathname)
      } catch {
        // Diagnostics must never prevent the generic error response.
      }
      if (!response.headersSent) sendJson(response, 500, { error: 'The remote request could not be completed.' })
      else response.end()
    })
  })
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
  server.on('upgrade', (request, socket, head) => {
    const hostname = options.getHostName()?.toLowerCase() ?? ''
    const expectedHosts = new Set([hostname, `${hostname}:443`])
    const origin = `https://${hostname}`
    let url: URL
    try { url = new URL(request.url ?? '/', `http://${hostname || 'localhost'}`) } catch { socket.destroy(); return }
    const token = cookieToken(request)
    let device: ReturnType<RemoteServerOptions['auth']['authorize']> = null
    try {
      device = token ? options.auth.authorize(token) : null
    } catch (error) {
      try { options.onRequestError?.(error, 'GET', `${REMOTE_PREFIX}/api/terminal/output`) } catch { /* diagnostics must not crash the upgrade handler */ }
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.pathname === `${REMOTE_PREFIX}/api/approvals/stream`) {
      acceptApprovalsStream(request, socket, head, { hostname, expectedHosts, origin, token, device })
      return
    }
    const id = url.searchParams.get('id')
    const valid = !stopped && safeHost(hostname) && hostname.endsWith('.trycloudflare.com') &&
      expectedHosts.has(request.headers.host?.toLowerCase() ?? '') && request.headers.origin === origin &&
      request.method === 'GET' && url.pathname === `${REMOTE_PREFIX}/api/terminal/output` &&
      Boolean(token && device && options.auth.can(token, 'read')) &&
      Boolean(device && withinRateLimit(device.id, 'stream', 30)) &&
      typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id) && Boolean(id && options.terminals.snapshot(id).some((terminal) => terminal.agent !== null && terminal.agent !== 'shell')) &&
      streams.size < MAX_OUTPUT_CLIENTS
    if (!valid || !token || !device || !id) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    websocketServer.handleUpgrade(request, socket, head, (ws) => {
      streams.add(ws)
      let alive = true
      ws.on('pong', () => { alive = true })
      const send = (event: string, data: unknown): void => {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify({ event, data }))
        else if (ws.readyState === WebSocket.OPEN) ws.close(1013, 'Output buffer exceeded')
      }
      const forward = (frame: RemoteTerminalFrame): void => {
        if (frame.type === 'resize') { send('resize', { cols: frame.cols, rows: frame.rows }); return }
        for (let offset = 0; offset < frame.data.length; offset += 8192) send('output', frame.data.slice(offset, offset + 8192))
      }
      // Frames that arrive while the screen is being serialized are held, then sent after the snapshot.
      let pending: RemoteTerminalFrame[] | null = []
      const cleanupBase = options.terminals.subscribe(id, (frame) => {
        if (pending) pending.push(frame)
        else forward(frame)
      })
      if (!cleanupBase) { ws.close(1008, 'Terminal is no longer active'); streams.delete(ws); return }
      void options.terminals.screen(id).then((screen) => {
        if (!screen) { send('closed', {}); ws.close(1000, 'Terminal ended'); return }
        send('snapshot', { ...options.terminals.snapshot(id)[0], ...screen })
        const queued = pending ?? []
        pending = null
        for (const frame of queued) forward(frame)
      }, () => ws.close(1011, 'Terminal screen could not be read'))
      const removeRevoke = options.auth.onRevoke((revokedId) => {
        if (revokedId === device.id) { send('revoked', {}); ws.close(1008, 'Device revoked') }
      })
      const heartbeat = setInterval(() => {
        try {
          if (!options.auth.authorize(token)) { send('revoked', {}); ws.close(1008, 'Device authorization expired') }
          else if (!options.terminals.snapshot(id).length) { send('closed', {}); ws.close(1000, 'Terminal ended') }
          else if (ws.readyState === WebSocket.OPEN) {
            if (!alive) { ws.terminate(); return }
            alive = false
            ws.ping()
          }
        } catch {
          // Fail closed if authorization persistence fails; never let a timer exception crash Electron.
          if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Authorization check failed')
        }
      }, options.heartbeatIntervalMs ?? 15000)
      heartbeat.unref()
      const cleanup = (): void => { clearInterval(heartbeat); cleanupBase(); removeRevoke(); streams.delete(ws); cleanups.delete(ws) }
      cleanups.set(ws, cleanup)
      ws.on('message', () => ws.close(1008, 'Output socket does not accept commands'))
      ws.on('close', cleanup)
      ws.on('error', cleanup)
    })
  })
  function acceptApprovalsStream(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: { hostname: string; expectedHosts: Set<string>; origin: string; token: string | null; device: ReturnType<RemoteServerOptions['auth']['authorize']> }
  ): void {
    const { hostname, expectedHosts, origin, token, device } = context
    const approvals = options.approvals
    const valid = !stopped && Boolean(approvals) && safeHost(hostname) && hostname.endsWith('.trycloudflare.com') &&
      expectedHosts.has(request.headers.host?.toLowerCase() ?? '') && request.headers.origin === origin && request.method === 'GET' &&
      Boolean(token && device && options.auth.can(token, 'approvals')) &&
      Boolean(device && withinRateLimit(device.id, 'approvals-stream', 30)) && approvalStreams.size < MAX_APPROVAL_CLIENTS
    if (!valid || !approvals || !token || !device) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    websocketServer.handleUpgrade(request, socket, head, (ws) => {
      streams.add(ws)
      approvalStreams.add(ws)
      let alive = true
      ws.on('pong', () => { alive = true })
      const send = (event: string, data: unknown): void => {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify({ event, data }))
        else if (ws.readyState === WebSocket.OPEN) ws.close(1013, 'Output buffer exceeded')
      }
      const stillAllowed = (): boolean => Boolean(options.auth.authorize(token)) && options.auth.can(token, 'approvals')
      const removeSubscription = approvals.subscribe((payload) => {
        try {
          if (stillAllowed()) send('approvals', payload)
          else { send('denied', {}); ws.close(1008, 'Approvals are turned off') }
        } catch { ws.close(1011, 'Authorization check failed') }
      })
      void approvals.snapshot().then((payload) => send('approvals', payload), () => ws.close(1011, 'Approvals could not be read'))
      const removeRevoke = options.auth.onRevoke((revokedId) => {
        if (revokedId === device.id) { send('revoked', {}); ws.close(1008, 'Device revoked') }
      })
      const heartbeat = setInterval(() => {
        try {
          if (!options.auth.authorize(token)) { send('revoked', {}); ws.close(1008, 'Device authorization expired') }
          else if (!options.auth.can(token, 'approvals')) { send('denied', {}); ws.close(1008, 'Approvals are turned off') }
          else if (ws.readyState === WebSocket.OPEN) {
            if (!alive) { ws.terminate(); return }
            alive = false
            ws.ping()
          }
        } catch {
          if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Authorization check failed')
        }
      }, options.heartbeatIntervalMs ?? 15000)
      heartbeat.unref()
      const cleanup = (): void => { clearInterval(heartbeat); removeSubscription(); removeRevoke(); streams.delete(ws); approvalStreams.delete(ws); cleanups.delete(ws) }
      cleanups.set(ws, cleanup)
      ws.on('message', () => ws.close(1008, 'Approvals socket does not accept commands'))
      ws.on('close', cleanup)
      ws.on('error', cleanup)
    })
  }
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not determine the local remote-control port.')
  const port = address.port

  return {
    port,
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      for (const ws of streams) {
        cleanups.get(ws)?.()
        ws.close(1001, 'Remote Access stopped')
        ws.terminate()
      }
      websocketServer.close()
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
    }
  }
}
