import { Resolver, lookup } from 'node:dns/promises'
import { setTimeout as delay } from 'node:timers/promises'

export const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8']
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 5_000

export interface ReachabilityOptions {
  resolve?: (hostname: string) => Promise<unknown>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs: number
  isCancelled?: () => boolean
  onAttempt?: (attempt: number, error: unknown) => void
}

async function resolvePublic(hostname: string): Promise<unknown> {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 })
  resolver.setServers(PUBLIC_DNS_SERVERS)
  try {
    return await resolver.resolve4(hostname)
  } finally {
    resolver.cancel()
  }
}

// Public resolvers avoid the ISP/router negative cache; the system resolver covers networks that block outbound DNS.
export function resolveTunnelHostname(hostname: string): Promise<unknown> {
  return Promise.any([resolvePublic(hostname), lookup(hostname, { family: 4 })])
}

export async function waitForTunnelHostname(hostname: string, options: ReachabilityOptions): Promise<boolean> {
  const resolve = options.resolve ?? resolveTunnelHostname
  const sleep = options.sleep ?? ((ms: number) => delay(ms))
  const now = options.now ?? Date.now
  const deadline = now() + options.timeoutMs
  let wait = FIRST_RETRY_MS
  for (let attempt = 1; ; attempt++) {
    if (options.isCancelled?.()) return false
    try {
      await resolve(hostname)
      return true
    } catch (error) {
      options.onAttempt?.(attempt, error)
    }
    const remaining = deadline - now()
    if (remaining <= 0) return false
    await sleep(Math.min(wait, remaining))
    wait = Math.min(Math.round(wait * 1.5), MAX_RETRY_MS)
  }
}
