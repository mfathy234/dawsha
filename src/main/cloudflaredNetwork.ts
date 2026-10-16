import { proxyFromEnv } from './proxyConfig'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface InstallerSession {
  setProxy(config: { proxyRules: string; proxyBypassRules: string }): Promise<void>
  fetch(url: string, init?: RequestInit): Promise<Response>
}

type Loader = () => Promise<{ session: InstallerSession | null; systemFetch: Fetcher | null }>

async function loadElectron(): Promise<{ session: InstallerSession | null; systemFetch: Fetcher | null }> {
  try {
    const electron = await import('electron')
    const partition = electron.session?.fromPartition?.('cloudflared-install') as unknown as InstallerSession | undefined
    const systemFetch = typeof electron.net?.fetch === 'function' ? ((url: string, init?: RequestInit) => electron.net.fetch(url, init)) : null
    return { session: partition ?? null, systemFetch }
  } catch {
    return { session: null, systemFetch: null }
  }
}

// A dedicated session keeps the env proxy away from the rest of the app; with no env proxy the system proxy is used.
export function createInstallerFetch(
  env: NodeJS.ProcessEnv,
  log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  load: Loader = loadElectron
): Fetcher {
  const proxy = proxyFromEnv(env)
  let ready: Promise<{ session: InstallerSession | null; systemFetch: Fetcher | null }> | null = null
  const prepare = (): Promise<{ session: InstallerSession | null; systemFetch: Fetcher | null }> => {
    ready ??= (async () => {
      const loaded = await load()
      if (proxy && loaded.session) {
        try {
          await loaded.session.setProxy({ proxyRules: proxy.proxyRules, proxyBypassRules: proxy.proxyBypassRules })
          log('proxy-configured', { rules: proxy.proxyRules.replace(/\/\/[^@/]*@/g, '//***@'), bypass: proxy.proxyBypassRules })
          return loaded
        } catch (error) {
          log('proxy-setup-failed', { message: (error as Error).message })
          return { session: null, systemFetch: loaded.systemFetch }
        }
      }
      return { session: null, systemFetch: loaded.systemFetch }
    })()
    return ready
  }
  return async (url, init) => {
    const { session, systemFetch } = await prepare()
    if (session) return session.fetch(url, init)
    return (systemFetch ?? fetch)(url, init)
  }
}
