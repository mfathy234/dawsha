import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudflaredInstaller } from '../../src/main/cloudflaredInstaller'

const dirs: string[] = []
async function tempDir() { const dir = await mkdtemp(join(tmpdir(), 'dawsha-cloudflared-')); dirs.push(dir); return dir }
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

describe('private cloudflared installer', () => {
  it('downloads the exact Windows asset, verifies its published digest, and caches it in app data', async () => {
    const dir = await tempDir()
    const binary = Buffer.from('verified executable')
    const fetcher = vi.fn(async (url: string) => url.includes('/latest')
      ? new Response(JSON.stringify({ tag_name: '2026.10.0', assets: [{ name: 'cloudflared-windows-amd64.exe', digest: `sha256:${hash(binary)}`, browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-windows-amd64.exe' }] }))
      : new Response(binary))
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'win32', arch: 'x64', env: {}, fetch: fetcher, probe: async () => true })
    const executable = await installer.ensureExecutable()
    expect(executable).toBe(join(dir, 'bin', 'cloudflared.exe'))
    expect(await readFile(executable)).toEqual(binary)
    expect(await stat(executable)).toBeTruthy()
    await installer.ensureExecutable()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects a digest mismatch without installing the binary', async () => {
    const dir = await tempDir()
    const fetcher = vi.fn(async (url: string) => url.includes('/latest')
      ? new Response(JSON.stringify({ tag_name: '2026.10.0', assets: [{ name: 'cloudflared-linux-amd64', digest: `sha256:${'0'.repeat(64)}`, browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-amd64' }] }))
      : new Response('unverified'))
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'linux', arch: 'x64', env: {}, fetch: fetcher, probe: async () => false, retryDelayMs: 1 })
    await expect(installer.ensureExecutable()).rejects.toThrow(/SHA-256/i)
    await expect(stat(join(dir, 'bin', 'cloudflared'))).rejects.toThrow()
  })

  it('reuses a compatible executable found on PATH without downloading', async () => {
    const dir = await tempDir()
    const pathDir = join(dir, 'path')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(pathDir)
    await writeFile(join(pathDir, 'cloudflared'), 'system binary', { mode: 0o755 })
    const fetcher = vi.fn()
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'linux', arch: 'x64', env: { PATH: pathDir }, fetch: fetcher, probe: async (path) => path.includes(pathDir) })
    expect(await installer.ensureExecutable()).toBe(join(pathDir, 'cloudflared'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('verifies a macOS archive before extracting only the expected binary', async () => {
    const dir = await tempDir()
    const archive = Buffer.from('verified gzip archive fixture')
    const executableBytes = Buffer.from('macOS executable')
    const fetcher = vi.fn(async (url: string) => url.includes('/latest')
      ? new Response(JSON.stringify({ tag_name: '2026.10.0', assets: [{ name: 'cloudflared-darwin-arm64.tgz', digest: `sha256:${hash(archive)}`, browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-darwin-arm64.tgz' }] }))
      : new Response(archive))
    const { writeFile } = await import('node:fs/promises')
    const extractArchive = vi.fn(async (_archivePath: string, executablePath: string) => writeFile(executablePath, executableBytes))
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'darwin', arch: 'arm64', env: {}, fetch: fetcher, probe: async () => true, extractArchive })
    const executablePath = await installer.ensureExecutable()
    expect(executablePath).toBe(join(dir, 'bin', 'cloudflared'))
    expect(await readFile(executablePath)).toEqual(executableBytes)
    expect(extractArchive).toHaveBeenCalledOnce()
  })

  it('rejects unsupported architectures and non-Cloudflare asset URLs', async () => {
    const unsupportedDir = await tempDir()
    const unsupported = createCloudflaredInstaller({ userDataDir: unsupportedDir, platform: 'linux', arch: 'arm', env: {}, fetch: vi.fn(), probe: async () => false, retryDelayMs: 1 })
    await expect(unsupported.ensureExecutable()).rejects.toThrow(/does not support/i)
    const dir = await tempDir()
    const binary = Buffer.from('binary')
    const fetcher = vi.fn(async (url: string) => url.includes('/latest')
      ? new Response(JSON.stringify({ tag_name: '2026.10.0', assets: [{ name: 'cloudflared-linux-amd64', digest: `sha256:${hash(binary)}`, browser_download_url: 'https://example.com/evil' }] }))
      : new Response(binary))
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'linux', arch: 'x64', env: {}, fetch: fetcher, probe: async () => false, retryDelayMs: 1 })
    await expect(installer.ensureExecutable()).rejects.toThrow(/official Cloudflare/i)
  })

  it('rejects release API redirects and bounds a stalled metadata request', async () => {
    const redirectDir = await tempDir()
    const redirectedFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/metadata' } }))
    const redirected = createCloudflaredInstaller({ userDataDir: redirectDir, platform: 'linux', arch: 'x64', env: {}, fetch: redirectedFetch, probe: async () => false, retryDelayMs: 1 })
    await expect(redirected.ensureExecutable()).rejects.toThrow(/HTTP 302/)
    expect(redirectedFetch).toHaveBeenCalledOnce()

    const timeoutDir = await tempDir()
    const stalledFetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const stalled = createCloudflaredInstaller({ userDataDir: timeoutDir, platform: 'linux', arch: 'x64', env: {}, fetch: stalledFetch, probe: async () => false, requestTimeoutMs: 5, retryDelayMs: 1 })
    await expect(stalled.ensureExecutable()).rejects.toThrow(/timed out/i)

    const bodyDir = await tempDir()
    const stalledBodyFetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }) }
    })))
    const stalledBody = createCloudflaredInstaller({ userDataDir: bodyDir, platform: 'linux', arch: 'x64', env: {}, fetch: stalledBodyFetch, probe: async () => false, requestTimeoutMs: 5, retryDelayMs: 1 })
    await expect(stalledBody.ensureExecutable()).rejects.toThrow(/metadata request timed out/i)
  })

  function releaseFetch(asset: string, binary: Buffer, failFirst = 0) {
    let failures = failFirst
    return vi.fn(async (url: string) => {
      if (url.includes('/latest')) return new Response(JSON.stringify({ tag_name: '2026.10.0', assets: [{ name: asset, digest: `sha256:${hash(binary)}`, browser_download_url: `https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/${asset}` }] }))
      if (failures-- > 0) throw new TypeError('fetch failed')
      return new Response(new Uint8Array(binary))
    })
  }

  it('retries a flaky download and still verifies the digest', async () => {
    const dir = await tempDir()
    const binary = Buffer.from('flaky network executable')
    const fetcher = releaseFetch('cloudflared-windows-amd64.exe', binary, 2)
    const log = vi.fn()
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'win32', arch: 'x64', env: {}, fetch: fetcher, probe: async () => true, retryDelayMs: 1, log })
    expect(await readFile(await installer.ensureExecutable())).toEqual(binary)
    expect(log).toHaveBeenCalledWith('download-retry', expect.objectContaining({ attempt: 1 }))
  })

  it('picks the 32-bit asset for ia32 Windows and the x64 asset for arm64 Windows or WOW64', async () => {
    const binary = Buffer.from('binary')
    for (const [arch, env, asset] of [['ia32', {}, 'cloudflared-windows-386.exe'], ['arm64', {}, 'cloudflared-windows-amd64.exe'], ['ia32', { PROCESSOR_ARCHITEW6432: 'AMD64' }, 'cloudflared-windows-amd64.exe']] as const) {
      const dir = await tempDir()
      const fetcher = releaseFetch(asset, binary)
      const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'win32', arch, env, fetch: fetcher, probe: async () => true })
      await expect(installer.ensureExecutable()).resolves.toBe(join(dir, 'bin', 'cloudflared.exe'))
    }
  })

  it('reuses cloudflared from a common install location when it is not on PATH', async () => {
    const dir = await tempDir()
    const { mkdir, writeFile } = await import('node:fs/promises')
    const programFiles = join(dir, 'Program Files')
    await mkdir(join(programFiles, 'cloudflared'), { recursive: true })
    const installed = join(programFiles, 'cloudflared', 'cloudflared.exe')
    await writeFile(installed, 'system binary')
    const fetcher = vi.fn()
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'win32', arch: 'x64', env: { ProgramFiles: programFiles }, fetch: fetcher, probe: async (path) => path === installed })
    expect(await installer.ensureExecutable()).toBe(installed)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('re-downloads a corrupt cached binary whose probe fails', async () => {
    const dir = await tempDir()
    const binary = Buffer.from('good executable')
    const fetcher = releaseFetch('cloudflared-linux-amd64', binary)
    const probe = vi.fn(async () => true)
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'linux', arch: 'x64', env: {}, fetch: fetcher, probe })
    const path = await installer.ensureExecutable()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, 'truncated')
    expect(await installer.ensureExecutable()).toBe(path)
    expect(await readFile(path)).toEqual(binary)
  })

  it('explains how to install cloudflared manually when automatic setup fails', async () => {
    const dir = await tempDir()
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
    const log = vi.fn()
    const installer = createCloudflaredInstaller({ userDataDir: dir, platform: 'win32', arch: 'x64', env: {}, fetch: fetcher, probe: async () => false, retryDelayMs: 1, log })
    await expect(installer.ensureExecutable()).rejects.toThrow(/could not set up Cloudflare Tunnel.*developers.cloudflare.com.*winget install/is)
    expect(log).toHaveBeenCalledWith('install-failed', expect.objectContaining({ platform: 'win32' }))
  })
})
