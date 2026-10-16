export interface EnvProxy {
  url: string
  proxyRules: string
  proxyBypassRules: string
}

function pick(env: NodeJS.ProcessEnv, ...names: string[]): string {
  for (const name of names) {
    for (const key of [name, name.toLowerCase()]) {
      const value = env[key]?.trim()
      if (value) return value
    }
  }
  return ''
}

function bypassRules(noProxy: string): string {
  return noProxy
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((entry) => entry.startsWith('.') ? `*${entry}` : entry)
    .join(',')
}

export function proxyFromEnv(env: NodeJS.ProcessEnv): EnvProxy | null {
  const url = pick(env, 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY')
  if (!url) return null
  const http = pick(env, 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')
  return {
    url,
    proxyRules: `https=${url};http=${http}`,
    proxyBypassRules: bypassRules(pick(env, 'NO_PROXY'))
  }
}

export function withProxyEnv(env: NodeJS.ProcessEnv, proxy: EnvProxy | null): NodeJS.ProcessEnv {
  if (!proxy) return env
  return { ...env, HTTPS_PROXY: proxy.url, https_proxy: proxy.url }
}
