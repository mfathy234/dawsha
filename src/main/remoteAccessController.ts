import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentKind, RemoteAccessSettings, RemoteAccessState, Settings, Project, SpawnRequest, SpawnResult } from '../shared/types'
import { IPC } from '../shared/ipc'
import { createFileDeviceStore, createRemoteAuth, type DeviceStore, type RemoteAuth } from './remoteAuth'
import { createCloudflareQuickTunnel, type QuickTunnelHandle } from './cloudflareQuickTunnel'
import { createCloudflaredInstaller } from './cloudflaredInstaller'
import { waitForTunnelHostname, type ReachabilityOptions } from './tunnelReachability'
import { startRemoteServer, type RemoteServerHandle, type RemoteServerOptions } from './remoteServer'
import { startRemoteSession } from './remoteSessions'
import { listClaudeSessions, listCodexSessions, listGeminiSessions } from './projectSessions'
import { createRemoteApprovals, type RemoteApprovals } from './remoteApprovals'
import { clampAwayMinutes } from '../shared/settingsSchema'
import type { RemoteTerminalFrame, RemoteTerminalScreen, RemoteTerminalSnapshot } from './remoteTerminalState'

interface SettingsStoreLike {
  get(): Settings
  update(patch: Partial<Settings>): Settings
}

interface RemotePtys {
  remoteSnapshot(id?: string): RemoteTerminalSnapshot[]
  remoteScreen(id: string): Promise<RemoteTerminalScreen | null>
  remoteTail(id: string): Promise<string | null>
  subscribeRemoteOutput(id: string, listener: (frame: RemoteTerminalFrame) => void): (() => void) | null
  write(id: string, data: string): void
  kill(id: string): void
  spawn(request: SpawnRequest): SpawnResult
}

interface HostWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  webContents: { send(channel: string, session: { id: string; projectId: string; agent: AgentKind; pid: number; sessionId?: string }): void }
}

const SAFE_REMOTE_PATHS = new Set([
  '/dawsha/api/pair',
  '/dawsha/api/state',
  '/dawsha/api/terminal/input',
  '/dawsha/api/session',
  '/dawsha/api/session/stop',
  '/dawsha/api/logout',
  '/dawsha/api/terminal/output',
  '/dawsha/api/approvals',
  '/dawsha/api/approvals/answer',
  '/dawsha/api/approvals/stream'
])

const FIRST_REACHABLE_WINDOW_MS = 45_000
const SECOND_REACHABLE_WINDOW_MS = 90_000
const READY_GRACE_MS = 4_000
const UNREACHABLE_MESSAGE = 'Cloudflare created a tunnel, but its public address is still not reachable after about two minutes. This is usually a temporary Cloudflare or DNS problem. Start Remote Access again to retry.'

const PERMISSION_KEYS = new Set(['terminalInput', 'sessionControl', 'approvals', 'approvalsNotify', 'approvalsOnlyWhenAway', 'approvalsAwayMinutes', 'approvalsAllowConfigEdits'])

function appendRemoteDiagnostic(userDataDir: string, record: Record<string, unknown>): void {
  const filePath = join(userDataDir, 'remote-access.log')
  try {
    if (existsSync(filePath) && statSync(filePath).size > 64 * 1024) writeFileSync(filePath, '', { encoding: 'utf8', mode: 0o600 })
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Logging failures must not affect the local remote-control server.
  }
}

function safeRemotePath(pathname: string): string {
  return SAFE_REMOTE_PATHS.has(pathname) ? pathname : 'other'
}

export interface RemoteAccessControllerOptions {
  userDataDir: string
  assetDirectory: string
  settings: SettingsStoreLike
  ptys: RemotePtys
  getWindow(): HostWindow | null
  idleSeconds?(): number
  tunnel?: ReturnType<typeof createCloudflareQuickTunnel>
  createServer?: (options: RemoteServerOptions) => Promise<RemoteServerHandle>
  waitForHostname?: (hostname: string, options: ReachabilityOptions) => Promise<boolean>
  readyGraceMs?: number
}

export function createRemoteAccessController(options: RemoteAccessControllerOptions) {
  let storageError: string | null = null
  let auth: RemoteAuth
  try {
    auth = createRemoteAuth(createFileDeviceStore(join(options.userDataDir, 'remote-devices.json')))
  } catch (error) {
    let memoryDevices: ReturnType<DeviceStore['load']> = []
    const memoryStore: DeviceStore = { load: () => memoryDevices, save: (next) => { memoryDevices = next } }
    auth = createRemoteAuth(memoryStore)
    storageError = `Paired-device data could not be read. Remote Access is disabled until it is repaired: ${(error as Error).message}`
  }
  const installer = options.tunnel ? null : createCloudflaredInstaller({ userDataDir: options.userDataDir, log: (event, detail) => log(`installer-${event}`, detail) })
  const tunnelFactory = options.tunnel ?? createCloudflareQuickTunnel(undefined, () => installer!.ensureExecutable())
  const createServer = options.createServer ?? startRemoteServer
  auth.setPermissions(options.settings.get().remoteAccess)
  let server: RemoteServerHandle | null = null
  let url: string | null = null
  let hostname: string | null = null
  let tunnel: QuickTunnelHandle | null = null
  let localPort = 0
  let ready = false
  let generation = 0
  const waitForHostname = options.waitForHostname ?? waitForTunnelHostname
  const log = (event: string, detail: Record<string, unknown> = {}): void => appendRemoteDiagnostic(options.userDataDir, { time: new Date().toISOString(), event, ...detail })
  let removeTunnelExit: (() => void) | null = null
  let pairing: { code: string; expiresAt: number } | null = null
  let setupError: string | null = storageError
  let enabling: Promise<RemoteAccessState> | null = null
  let disabling: Promise<void> | null = null
  let stopping = false
  let stoppingOperation: Promise<void> | null = null
  const remoteSessionIds = new Set<string>()
  const approvals: RemoteApprovals = createRemoteApprovals({
    terminals: {
      snapshot: (id) => options.ptys.remoteSnapshot(id),
      tail: (id) => options.ptys.remoteTail(id),
      write: (id, data) => options.ptys.write(id, data)
    },
    getProjects: () => options.settings.get().projects,
    getConfig: () => {
      const access = options.settings.get().remoteAccess
      return { allowConfigEdits: access.approvalsAllowConfigEdits, notify: access.approvalsNotify, onlyWhenAway: access.approvalsOnlyWhenAway, awayMinutes: access.approvalsAwayMinutes }
    },
    idleSeconds: () => options.idleSeconds?.() ?? 0
  })

  async function sessions(project: Project, agent: AgentKind) {
    if (agent === 'claude') return listClaudeSessions(project.folder)
    if (agent === 'codex') return listCodexSessions(project.folder)
    return listGeminiSessions(project.folder)
  }

  function sessionExists(project: Project, agent: AgentKind, id: string): Promise<boolean> {
    return sessions(project, agent).then((entries) => entries.some((entry) => entry.id === id))
  }

  function focusHost(): void {
    const window = options.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  async function getState(): Promise<RemoteAccessState> {
    const enabled = server !== null && url !== null
    if (ready && pairing && pairing.expiresAt <= Date.now()) pairing = auth.createPairingCode()
    const status: RemoteAccessState['status'] = enabled
      ? (ready ? 'available' : 'connecting')
      : setupError ? 'setup-required' : 'off'
    const message = status === 'connecting'
      ? 'Cloudflare is publishing your tunnel address. This can take up to a minute; this page updates on its own.'
      : status === 'available'
      ? options.settings.get().remoteAccess.allowedEmail.trim()
        ? 'Cloudflare email PIN and Dawsha pairing are both required.'
        : 'Dawsha pairing is required. Keep this public tunnel URL and its short-lived code private.'
      : status === 'setup-required' ? setupError ?? 'Cloudflare Quick Tunnel needs setup.' : 'Remote Access is off.'
    return {
      status,
      enabled,
      url: ready ? url : null,
      message,
      devices: auth.listDevices(),
      pairing: ready && pairing && pairing.expiresAt > Date.now() ? pairing : null,
      permissions: options.settings.get().remoteAccess
    }
  }

  function adopt(active: QuickTunnelHandle): void {
    const parsed = new URL(active.url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
        !/^[a-z0-9-]+.trycloudflare.com$/.test(parsed.hostname)) throw new Error('cloudflared returned an unsupported Quick Tunnel URL.')
    hostname = parsed.hostname
    url = `${active.url}/dawsha/`
    removeTunnelExit?.()
    removeTunnelExit = active.onExit((error) => {
      log('tunnel-exit', { message: error.message })
      setupError = `Cloudflare Quick Tunnel stopped: ${error.message}`
      void deactivate().catch(() => undefined)
    })
  }

  async function connect(email: string | undefined): Promise<boolean> {
    const mine = ++generation
    const cancelled = (): boolean => mine !== generation || !server
    for (const window of [FIRST_REACHABLE_WINDOW_MS, SECOND_REACHABLE_WINDOW_MS]) {
      const host = hostname
      if (!host) return false
      const reachable = await waitForHostname(host, {
        timeoutMs: window,
        isCancelled: cancelled,
        onAttempt: (attempt, error) => log('hostname-wait', { host, attempt, error: error instanceof Error ? error.message : String(error) })
      })
      if (cancelled()) return false
      if (reachable) {
        ready = true
        pairing = auth.createPairingCode()
        log('hostname-ready', { host })
        return true
      }
      if (window === SECOND_REACHABLE_WINDOW_MS) break
      log('hostname-restart', { host })
      try {
        const old = tunnel
        removeTunnelExit?.()
        removeTunnelExit = null
        tunnel = null
        if (old) await old.stop().catch(() => undefined)
        const next = await tunnelFactory.start(localPort, email)
        if (cancelled()) { await next.stop().catch(() => undefined); return false }
        tunnel = next
        adopt(next)
      } catch (error) {
        log('hostname-restart-failed', { message: (error as Error).message })
        return fail((error as Error).message || UNREACHABLE_MESSAGE, mine)
      }
    }
    log('hostname-unreachable', { host: hostname })
    return fail(UNREACHABLE_MESSAGE, mine)
  }

  async function fail(message: string, mine: number): Promise<false> {
    if (mine !== generation) return false
    await deactivate().catch(() => undefined)
    setupError = message
    return false
  }

  async function enableOnce(): Promise<RemoteAccessState> {
    if (storageError) throw new Error(storageError)
    if (server) return getState()
    const email = options.settings.get().remoteAccess.allowedEmail.trim()
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new Error('Enter a valid email address for the Cloudflare PIN gate in Remote Access settings, or leave it blank to use Dawsha pairing only.')

    let localServer: RemoteServerHandle | null = null
    try {
      localServer = await createServer({
        getHostName: () => hostname,
        auth,
        getProjects: () => options.settings.get().projects,
        listSessions: sessions,
        terminals: {
          snapshot: (id) => options.ptys.remoteSnapshot(id),
          screen: (id) => options.ptys.remoteScreen(id),
          subscribe: (id, listener) => options.ptys.subscribeRemoteOutput(id, listener),
          write: (id, data) => options.ptys.write(id, data)
        },
        startSession: async (input, authorizeStart) => {
          const result = await startRemoteSession(input, {
            projects: options.settings.get().projects,
            fullAccess: options.settings.get().fullAccess,
            ptys: options.ptys,
            isKnownSession: sessionExists,
            focusHost,
            authorizeStart,
            onStarted: (session) => {
              const window = options.getWindow()
              if (window && !window.isDestroyed()) window.webContents.send(IPC.remoteSessionStarted, session)
            }
          })
          if (result.ok && 'id' in result) remoteSessionIds.add(result.id)
          return result
        },
        stopSession: (id) => {
          if (!remoteSessionIds.has(id) || !options.ptys.remoteSnapshot(id).length) return false
          remoteSessionIds.delete(id)
          options.ptys.kill(id)
          return true
        },
        approvals,
        assetDirectory: options.assetDirectory,
        onRequestError: (error, method, pathname) => {
          const record = {
            time: new Date().toISOString(),
            method,
            pathname: safeRemotePath(pathname),
            error: error instanceof Error ? error.name : 'UnknownError',
            code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
              ? error.code
              : undefined
          }
          appendRemoteDiagnostic(options.userDataDir, record)
        },
        onRequestComplete: (method, pathname, statusCode) => {
          appendRemoteDiagnostic(options.userDataDir, {
            time: new Date().toISOString(),
            method,
            pathname: safeRemotePath(pathname),
            statusCode
          })
        }
      })
      localPort = localServer.port
      const activeTunnel = await tunnelFactory.start(localPort, email || undefined)
      tunnel = activeTunnel
      adopt(activeTunnel)
      server = localServer
      ready = false
      setupError = null
      const connection = connect(email || undefined)
      const grace = options.readyGraceMs ?? READY_GRACE_MS
      let graceTimer: NodeJS.Timeout | undefined
      const outcome = await Promise.race([connection, new Promise<'pending'>((resolve) => { graceTimer = setTimeout(() => resolve('pending'), grace) })])
      clearTimeout(graceTimer)
      if (outcome === false) throw new Error(setupError ?? UNREACHABLE_MESSAGE)
      return getState()
    } catch (error) {
      if (localServer) await localServer.stop().catch(() => undefined)
      if (tunnel) { await tunnel.stop().catch(() => undefined); tunnel = null }
      hostname = null
      server = null
      url = null
      ready = false
      generation += 1
      log('enable-failed', { message: (error as Error).message })
      setupError = (error as Error).message || 'Cloudflare Quick Tunnel could not be started.'
      throw error
    }
  }

  async function enable(): Promise<RemoteAccessState> {
    if (stopping) throw new Error('Remote Access is stopping with the app.')
    if (disabling) {
      await disabling
      return enable()
    }
    if (enabling) return enabling
    const operation = enableOnce()
    enabling = operation
    try { return await operation } finally {
      if (enabling === operation) enabling = null
    }
  }

  async function deactivate(): Promise<void> {
    const localServer = server
    server = null
    url = null
    hostname = null
    pairing = null
    ready = false
    generation += 1
    approvals.stop()
    for (const id of remoteSessionIds) options.ptys.kill(id)
    remoteSessionIds.clear()
    let failure: unknown
    const activeTunnel = tunnel
    tunnel = null
    removeTunnelExit?.()
    removeTunnelExit = null
    if (activeTunnel) { try { await activeTunnel.stop() } catch (error) { failure ??= error } }
    if (localServer) {
      try { await localServer.stop() } catch (error) { failure ??= error }
    }
    if (failure) {
      setupError = `Remote Access stopped locally, but cloudflared could not stop cleanly: ${(failure as Error).message}`
      throw failure
    }
  }

  async function disable(): Promise<RemoteAccessState> {
    if (stoppingOperation) {
      await stoppingOperation
      return getState()
    }
    if (disabling) {
      await disabling
      return getState()
    }
    const operation = (async () => {
      if (enabling) await enabling.catch(() => undefined)
      await deactivate()
    })()
    disabling = operation
    try { await operation } finally {
      if (disabling === operation) disabling = null
    }
    return getState()
  }

  function stop(): Promise<void> {
    if (stoppingOperation) return stoppingOperation
    stopping = true
    const operation = (async () => {
      if (disabling) {
        try {
          await disabling
          return
        } catch {
          // Retry deactivation below if the in-flight disable could not finish cleanup.
        }
      }
      if (enabling) await enabling.catch(() => undefined)
      await deactivate()
    })()
    stoppingOperation = operation
    return operation
  }

  async function refreshPairing(): Promise<RemoteAccessState> {
    if (!server) throw new Error('Enable Remote Access before creating a pairing code.')
    pairing = auth.createPairingCode()
    return getState()
  }

  async function setPermissions(next: Partial<RemoteAccessSettings>): Promise<RemoteAccessState> {
    if (!next || typeof next !== 'object' || Object.keys(next).some((key) => !PERMISSION_KEYS.has(key)) ||
        Object.entries(next).some(([key, value]) => key === 'approvalsAwayMinutes' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'boolean')) throw new Error('Invalid Remote Access permissions.')
    const remoteAccess = { ...options.settings.get().remoteAccess, ...next }
    remoteAccess.approvalsAwayMinutes = clampAwayMinutes(remoteAccess.approvalsAwayMinutes, 3)
    options.settings.update({ remoteAccess })
    auth.setPermissions(remoteAccess)
    return getState()
  }

  async function setAllowedEmail(email: string): Promise<RemoteAccessState> {
    if (stopping || server || enabling || disabling) throw new Error('Wait for Remote Access to stop before changing the Cloudflare PIN email.')
    if (typeof email !== 'string' || email.length > 254 || (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address for the Cloudflare PIN gate.')
    const remoteAccess = { ...options.settings.get().remoteAccess, allowedEmail: email.trim() }
    options.settings.update({ remoteAccess })
    return getState()
  }

  async function revoke(deviceId: string): Promise<RemoteAccessState> {
    if (typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) throw new Error('Invalid paired-device ID.')
    auth.revoke(deviceId)
    return getState()
  }

  async function recordDesktopApproval(terminalId: string, allowed: boolean, tail?: string): Promise<void> {
    if (!server || typeof terminalId !== 'string' || typeof allowed !== 'boolean') return
    await approvals.recordDesktopAnswer(terminalId, allowed, typeof tail === 'string' ? tail : undefined)
  }

  return { getState, recordDesktopApproval, enable, disable, refreshPairing, setPermissions, setAllowedEmail, revoke, stop }
}
