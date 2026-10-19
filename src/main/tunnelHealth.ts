import { request } from 'node:https'

const HEALTH_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000
const FAILURES_BEFORE_RECONNECT = 2

export type HealthReason = 'failures' | 'resume'

export interface TunnelHealthOptions {
  probe(): Promise<boolean>
  onUnhealthy(reason: HealthReason): void
  onResult?(healthy: boolean, consecutiveFailures: number): void
  intervalMs?: number
}

export interface TunnelHealthMonitor {
  start(): void
  stop(): void
  // afterResume: a single failure is enough (the tunnel rarely survives sleep).
  check(afterResume?: boolean): Promise<boolean>
}

export function createTunnelHealthMonitor(options: TunnelHealthOptions): TunnelHealthMonitor {
  let timer: ReturnType<typeof setInterval> | null = null
  let failures = 0
  let inFlight: Promise<boolean> | null = null
  let running = false

  async function run(afterResume: boolean): Promise<boolean> {
    let healthy = false
    try { healthy = await options.probe() } catch { healthy = false }
    if (!running) return healthy
    failures = healthy ? 0 : failures + 1
    options.onResult?.(healthy, failures)
    if (!healthy && (afterResume || failures >= FAILURES_BEFORE_RECONNECT)) {
      failures = 0
      options.onUnhealthy(afterResume ? 'resume' : 'failures')
    }
    return healthy
  }

  function check(afterResume = false): Promise<boolean> {
    if (!running) return Promise.resolve(true)
    if (inFlight) return inFlight
    const current = run(afterResume).finally(() => { if (inFlight === current) inFlight = null })
    inFlight = current
    return current
  }

  return {
    start() {
      if (running) return
      running = true
      failures = 0
      timer = setInterval(() => { void check() }, options.intervalMs ?? HEALTH_INTERVAL_MS)
      timer.unref?.()
    },
    stop() {
      running = false
      failures = 0
      inFlight = null
      if (timer) clearInterval(timer)
      timer = null
    },
    check
  }
}

// End-to-end probe: public DNS -> Cloudflare -> tunnel -> our local server. Only ever contacts the tunnel host.
export function probeTunnel(hostname: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: hostname, port: 443, path: '/dawsha/api/health', method: 'GET', timeout: timeoutMs, headers: { Accept: 'application/json' } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { if (chunks.reduce((n, c) => n + c.length, 0) < 1024) chunks.push(chunk) })
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: unknown; app?: unknown }
          resolve(response.statusCode === 200 && body.ok === true && body.app === 'dawsha')
        } catch { resolve(false) }
      })
      response.on('error', () => resolve(false))
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
    req.end()
  })
}
