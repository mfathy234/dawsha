import { describe, expect, it, vi } from 'vitest'
import { createInstallerFetch, type InstallerSession } from '../../src/main/cloudflaredNetwork'
import { proxyFromEnv, withProxyEnv } from '../../src/main/proxyConfig'

describe('proxy environment', () => {
  it('returns null when no proxy variable is set', () => {
    expect(proxyFromEnv({})).toBeNull()
    expect(proxyFromEnv({ HTTPS_PROXY: '  ' })).toBeNull()
  })

  it('reads upper and lower case variables and builds Chromium proxy rules', () => {
    expect(proxyFromEnv({ https_proxy: 'http://p:8080', no_proxy: 'localhost,.corp.local' })).toEqual({
      url: 'http://p:8080',
      proxyRules: 'https=http://p:8080;http=http://p:8080',
      proxyBypassRules: 'localhost,*.corp.local'
    })
    expect(proxyFromEnv({ HTTPS_PROXY: 'http://s:1', HTTP_PROXY: 'http://h:2' })?.proxyRules).toBe('https=http://s:1;http=http://h:2')
    expect(proxyFromEnv({ HTTP_PROXY: 'http://h:2' })?.url).toBe('http://h:2')
  })

  it('adds the HTTPS proxy to a child environment only when configured', () => {
    const env = { PATH: 'x' }
    expect(withProxyEnv(env, null)).toBe(env)
    expect(withProxyEnv(env, proxyFromEnv({ HTTP_PROXY: 'http://h:2' }))).toMatchObject({ PATH: 'x', HTTPS_PROXY: 'http://h:2', https_proxy: 'http://h:2' })
  })
})

describe('installer fetch', () => {
  function fakeSession(failSetup = false): InstallerSession & { setProxy: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> } {
    return {
      setProxy: vi.fn(async () => { if (failSetup) throw new Error('bad rules') }),
      fetch: vi.fn(async () => new Response('via session'))
    }
  }

  it('routes through a dedicated session configured once from the environment proxy', async () => {
    const session = fakeSession()
    const systemFetch = vi.fn(async () => new Response('system'))
    const log = vi.fn()
    const fetcher = createInstallerFetch({ HTTPS_PROXY: 'http://user:pw@p:8080', NO_PROXY: '.corp' }, log, async () => ({ session, systemFetch }))
    expect(await (await fetcher('https://github.com/x')).text()).toBe('via session')
    await fetcher('https://github.com/y')
    expect(session.setProxy).toHaveBeenCalledOnce()
    expect(session.setProxy).toHaveBeenCalledWith({ proxyRules: 'https=http://user:pw@p:8080;http=http://user:pw@p:8080', proxyBypassRules: '*.corp' })
    expect(systemFetch).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('pw@')
  })

  it('uses the system network stack when no proxy is set and the session is untouched', async () => {
    const session = fakeSession()
    const systemFetch = vi.fn(async () => new Response('system'))
    const fetcher = createInstallerFetch({}, undefined, async () => ({ session, systemFetch }))
    expect(await (await fetcher('https://github.com/x')).text()).toBe('system')
    expect(session.setProxy).not.toHaveBeenCalled()
  })

  it('falls back to the system stack if the proxy rules are rejected', async () => {
    const session = fakeSession(true)
    const systemFetch = vi.fn(async () => new Response('system'))
    const log = vi.fn()
    const fetcher = createInstallerFetch({ HTTPS_PROXY: 'http://p:1' }, log, async () => ({ session, systemFetch }))
    expect(await (await fetcher('https://github.com/x')).text()).toBe('system')
    expect(log).toHaveBeenCalledWith('proxy-setup-failed', expect.anything())
  })
})
