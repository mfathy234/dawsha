import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { proxyFromEnv, withProxyEnv } from './proxyConfig'

export interface TunnelProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type TunnelSpawn = (command: string, args: string[], options: { shell: false; windowsHide: true; stdio: ['ignore', 'pipe', 'pipe']; env?: NodeJS.ProcessEnv }) => TunnelProcess

export interface QuickTunnelHandle {
  url: string
  stop(): Promise<void>
  onExit(listener: (error: Error) => void): () => void
}

const START_TIMEOUT_MS = 20_000
const MAX_LOG_BYTES = 64 * 1024

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function parseTunnelUrl(log: string): string | null {
  const match = log.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i)
  if (!match || match[1].length > 253) return null
  return `https://${match[1].toLowerCase()}`
}

export function createCloudflareQuickTunnel(
  run: TunnelSpawn = (command, args, options) => spawn(command, args, options) as unknown as TunnelProcess,
  resolveExecutable: () => Promise<string> = async () => 'cloudflared',
  env: NodeJS.ProcessEnv = process.env
) {
  async function start(port: number, email?: string): Promise<QuickTunnelHandle> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The local remote-control port is invalid.')
    if (email !== undefined && !validEmail(email)) throw new Error('Enter a valid email address for the Cloudflare PIN gate.')
    let child: TunnelProcess
    try {
      const executable = await resolveExecutable()
      const args = ['tunnel', '--url', `http://127.0.0.1:${port}`]
      if (email) args.push('--allowed-mail', email)
      const proxy = proxyFromEnv(env)
      if (proxy) args.push('--protocol', 'http2')
      child = run(executable, args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        ...(proxy ? { env: withProxyEnv(env, proxy) } : {})
      })
    } catch (error) {
      throw new Error(`Cloudflare Tunnel could not start. ${(error as Error).message}`)
    }

    let logs = ''
    let logBytes = 0
    const exitState: { error: Error | null } = { error: null }
    let exited = false
    let spawnError = false
    let resolveChanged: (() => void) | null = null
    const listeners = new Set<(error: Error) => void>()
    const changed = (): void => { resolveChanged?.(); resolveChanged = null }
    const append = (chunk: Buffer | string): void => {
      const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = MAX_LOG_BYTES - logBytes
      if (remaining > 0) {
        const bounded = input.subarray(0, remaining)
        logs += bounded.toString('utf8')
        logBytes += bounded.byteLength
      }
      changed()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => { exitState.error = error; spawnError = true; changed() })
    child.once('exit', (code) => {
      exited = true
      exitState.error = new Error(`cloudflared exited with code ${code ?? 'unknown'}.`)
      changed()
      if (exitState.error) for (const listener of listeners) listener(exitState.error)
    })

    async function terminateChild(): Promise<void> {
      if (exited) return
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill()
      const finished = await Promise.race([stopped.then(() => true), delay(1000).then(() => false)])
      if (!finished) {
        child.kill('SIGKILL')
        await Promise.race([stopped, delay(500)])
      }
    }

    const deadline = Date.now() + START_TIMEOUT_MS
    let url: string | null = null
    while (!url && !exited && !spawnError && Date.now() < deadline) {
      url = parseTunnelUrl(logs)
      if (!url) await Promise.race([new Promise<void>((resolve) => { resolveChanged = resolve }), delay(Math.min(200, Math.max(1, deadline - Date.now())))])
    }
    if (!url) {
      await terminateChild()
      if (exitState.error?.message.includes('ENOENT')) throw new Error('Cloudflare Tunnel could not be found. Check the app-local installation or your PATH binary.')
      if (exitState.error) throw new Error(`Cloudflare Quick Tunnel failed to start: ${exitState.error.message}`)
      if (exited) throw new Error('cloudflared exited before returning a Quick Tunnel URL. Check its version and the --allowed-mail option.')
      throw new Error('Timed out waiting for the Cloudflare Quick Tunnel URL.')
    }
    return {
      url,
      onExit(listener) { listeners.add(listener); if (exitState.error) listener(exitState.error); return () => listeners.delete(listener) },
      stop: terminateChild
    }
  }
  return { start }
}
