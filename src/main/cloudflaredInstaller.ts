import { createHash } from 'node:crypto'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { renameWithRetry, withRetry } from './installRetry'
import { createInstallerFetch, type Fetcher } from './cloudflaredNetwork'
import { assetDownloadUrl, digestFromHtml, expandedAssetsUrl, latestReleaseUrl, releasePageUrl, tagFromLocation } from './cloudflaredRelease'

const RELEASE_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
const MAX_METADATA_BYTES = 1024 * 1024
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const INSTALL_TIMEOUT_MS = 90_000
const EXTRACT_TIMEOUT_MS = 15_000
const ALLOWED_ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const DOWNLOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 1500
const MANUAL_INSTALL_URL = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
const execFile = promisify(nodeExecFile)

type Platform = 'win32' | 'darwin' | 'linux'

interface InstallerOptions {
  userDataDir: string
  platform?: NodeJS.Platform
  arch?: string
  env?: NodeJS.ProcessEnv
  fetch?: Fetcher
  probe?: (executable: string) => Promise<boolean>
  versionCheck?: (executable: string) => Promise<boolean>
  extractArchive?: (archive: string, output: string) => Promise<void>
  requestTimeoutMs?: number
  installTimeoutMs?: number
  retryDelayMs?: number
  log?: (event: string, detail: Record<string, unknown>) => void
}

interface ReleaseAsset { name: string; digest: string; browser_download_url: string }
interface Release { tag_name: string; assets: ReleaseAsset[] }
interface ResolvedRelease { tag: string; digest: string | null; url: string }
interface TimedResponse { response: Response; dispose(): void; timedOut(): boolean }

async function fetchTimed(fetcher: Fetcher, url: string, init: RequestInit, deadline: number, timeoutMs: number): Promise<TimedResponse> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Cloudflare Tunnel setup timed out.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining))
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal })
    return { response, dispose: () => clearTimeout(timeout), timedOut: () => controller.signal.aborted }
  } catch (error) {
    clearTimeout(timeout)
    if (controller.signal.aborted) throw new Error('Cloudflare release request timed out.')
    throw error
  }
}

function targetFor(platform: NodeJS.Platform, arch: string): { asset: string; executable: string; archive: boolean } {
  const normalized = platform as Platform
  if (normalized === 'win32' && (arch === 'x64' || arch === 'arm64')) return { asset: 'cloudflared-windows-amd64.exe', executable: 'cloudflared.exe', archive: false }
  if (normalized === 'win32' && arch === 'ia32') return { asset: 'cloudflared-windows-386.exe', executable: 'cloudflared.exe', archive: false }
  if (normalized === 'darwin' && arch === 'x64') return { asset: 'cloudflared-darwin-amd64.tgz', executable: 'cloudflared', archive: true }
  if (normalized === 'darwin' && arch === 'arm64') return { asset: 'cloudflared-darwin-arm64.tgz', executable: 'cloudflared', archive: true }
  if (normalized === 'linux' && (arch === 'x64' || arch === 'arm64')) return { asset: `cloudflared-linux-${arch === 'x64' ? 'amd64' : 'arm64'}`, executable: 'cloudflared', archive: false }
  throw new Error(`Cloudflare Tunnel does not support automatic installation for ${platform}/${arch}.`)
}

async function readBounded(response: Response, limit: number, label: string): Promise<Buffer> {
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}.`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) throw new Error(`${label} exceeds the allowed download size.`)
  if (!response.body) throw new Error(`${label} response did not provide a bounded stream.`)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) { await reader.cancel(); throw new Error(`${label} exceeds the allowed download size.`) }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  return Buffer.concat(chunks, total)
}

function validAssetUrl(value: string, releaseTag: string, assetName: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Cloudflare release metadata contains an invalid asset URL.') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port ||
      url.pathname !== `/cloudflare/cloudflared/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}` || url.search || url.hash) {
    throw new Error('Only the exact official Cloudflare release asset can be installed.')
  }
  return url
}

async function fetchAsset(fetcher: Fetcher, start: URL, deadline: number, timeoutMs: number): Promise<TimedResponse> {
  let url = start
  for (let redirects = 0; redirects <= 5; redirects++) {
    const timed = await fetchTimed(fetcher, url.href, { redirect: 'manual' }, deadline, timeoutMs)
    const response = timed.response
    if (response.status < 300 || response.status >= 400) return timed
    const location = response.headers.get('location')
    timed.dispose()
    await response.body?.cancel().catch(() => undefined)
    if (!location) throw new Error('Cloudflare release download returned an invalid redirect.')
    const next = new URL(location, url)
    if (next.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(next.hostname) || next.username || next.password || next.port) {
      throw new Error('Cloudflare release download redirected outside the official asset hosts.')
    }
    url = next
  }
  throw new Error('Cloudflare release download exceeded the redirect limit.')
}

async function defaultVersionCheck(executable: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFile(executable, ['--version'], { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 })
    return /\d+\.\d+\.\d+/.test(`${stdout}\n${stderr}`)
  } catch { return false }
}

async function defaultProbe(executable: string): Promise<boolean> {
  try {
    await execFile(executable, ['--version'], { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 })
    const { stdout, stderr } = await execFile(executable, ['tunnel', '--help'], { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 })
    return `${stdout}\n${stderr}`.includes('--allowed-mail')
  } catch { return false }
}

async function defaultExtract(archive: string, output: string): Promise<void> {
  const { stdout } = await execFile('/usr/bin/tar', ['-xOzf', archive, 'cloudflared'], { timeout: EXTRACT_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_EXTRACTED_BYTES, encoding: 'buffer' })
  await writeFile(output, stdout, { flag: 'wx' })
}

async function findPathBinary(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string | null> {
  const filename = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, filename)
    try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate } catch { /* continue */ }
  }
  return null
}

function commonLocations(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((root): root is string => Boolean(root))
    const local = env.LOCALAPPDATA
    return [
      ...roots.map((root) => join(root, 'cloudflared', 'cloudflared.exe')),
      ...(local ? [join(local, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'), join(local, 'Microsoft', 'WindowsApps', 'cloudflared.exe')] : [])
    ]
  }
  return ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared']
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

export function createCloudflaredInstaller(options: InstallerOptions) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const rawArch = options.arch ?? process.arch
  const arch = platform === 'win32' && rawArch === 'ia32' && (env.PROCESSOR_ARCHITEW6432 === 'AMD64' || env.PROCESSOR_ARCHITEW6432 === 'ARM64') ? 'x64' : rawArch
  const log = options.log ?? (() => undefined)
  const fetcher = options.fetch ?? createInstallerFetch(env, log)
  const versionCheck = options.versionCheck ?? defaultVersionCheck
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS
  const probe = options.probe ?? defaultProbe
  const extractArchive = options.extractArchive ?? defaultExtract
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const installTimeoutMs = options.installTimeoutMs ?? INSTALL_TIMEOUT_MS
  let resolving: Promise<string> | null = null

  async function readText(url: string, label: string, deadline: number): Promise<{ text: string; location: string | null }> {
    const timed = await fetchTimed(fetcher, url, { redirect: 'manual' }, deadline, requestTimeoutMs)
    try {
      const status = timed.response.status
      if (status >= 300 && status < 400) {
        await timed.response.body?.cancel().catch(() => undefined)
        return { text: '', location: timed.response.headers.get('location') }
      }
      return { text: (await readBounded(timed.response, MAX_METADATA_BYTES, label)).toString('utf8'), location: null }
    } catch (error) {
      if (timed.timedOut()) throw new Error(`${label} request timed out.`)
      throw error
    } finally { timed.dispose() }
  }

  async function resolveViaApi(assetName: string, deadline: number): Promise<ResolvedRelease> {
    let metadataTimed: TimedResponse
    try { metadataTimed = await fetchTimed(fetcher, RELEASE_API, { headers: { accept: 'application/vnd.github+json' }, redirect: 'manual' }, deadline, requestTimeoutMs) }
    catch (error) { throw new Error(`Could not reach Cloudflare's official release service: ${(error as Error).message}`) }
    let metadataBytes: Buffer
    try { metadataBytes = await readBounded(metadataTimed.response, MAX_METADATA_BYTES, 'Cloudflare release metadata') }
    catch (error) { if (metadataTimed.timedOut()) throw new Error('Cloudflare release metadata request timed out.'); throw error }
    finally { metadataTimed.dispose() }
    let release: Release
    try { release = JSON.parse(metadataBytes.toString('utf8')) as Release } catch { throw new Error('Cloudflare returned invalid release metadata.') }
    if (!release || typeof release.tag_name !== 'string' || !/^\d{4}\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) {
      throw new Error('Cloudflare returned invalid release metadata.')
    }
    const asset = release.assets.find((entry) => entry?.name === assetName)
    if (!asset) throw new Error('Cloudflare release does not list this platform.')
    const digest = typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? asset.digest.slice('sha256:'.length) : null
    return { tag: release.tag_name, digest, url: asset.browser_download_url }
  }

  async function digestFromWeb(tag: string, assetName: string, deadline: number): Promise<string | null> {
    for (const url of [expandedAssetsUrl(tag), releasePageUrl(tag)]) {
      try {
        const { text } = await readText(url, 'Cloudflare release page', deadline)
        const digest = digestFromHtml(text, tag, assetName)
        if (digest) return digest
      } catch (error) { log('checksum-page-failed', { url, message: (error as Error).message }) }
    }
    return null
  }

  async function resolveViaWeb(assetName: string, deadline: number): Promise<ResolvedRelease> {
    const { location } = await readText(latestReleaseUrl, 'Cloudflare latest release', deadline)
    const tag = tagFromLocation(location)
    if (!tag) throw new Error('Cloudflare latest release page did not name a valid version.')
    return { tag, digest: await digestFromWeb(tag, assetName, deadline), url: assetDownloadUrl(tag, assetName) }
  }

  async function resolveRelease(assetName: string, deadline: number): Promise<ResolvedRelease> {
    try {
      const resolved = await resolveViaApi(assetName, deadline)
      return resolved.digest ? resolved : { ...resolved, digest: await digestFromWeb(resolved.tag, assetName, deadline) }
    } catch (apiError) {
      log('release-api-failed', { message: (apiError as Error).message })
      try { return await resolveViaWeb(assetName, deadline) }
      catch (webError) { throw new Error(`${(apiError as Error).message} (release page fallback also failed: ${(webError as Error).message})`) }
    }
  }

  async function downloadRelease(assetName: string): Promise<{ downloaded: Buffer; tag: string; digest: string; checksumKnown: boolean }> {
    const deadline = Date.now() + installTimeoutMs
    const release = await resolveRelease(assetName, deadline)
    const assetUrl = validAssetUrl(release.url, release.tag, assetName)
    let downloadTimed: TimedResponse
    try { downloadTimed = await fetchAsset(fetcher, assetUrl, deadline, requestTimeoutMs) }
    catch (error) { throw new Error(`Could not download Cloudflare Tunnel: ${(error as Error).message}`) }
    let downloaded: Buffer
    try { downloaded = await readBounded(downloadTimed.response, MAX_DOWNLOAD_BYTES, 'Cloudflare Tunnel') }
    catch (error) { if (downloadTimed.timedOut()) throw new Error('Cloudflare Tunnel download timed out.'); throw error }
    finally { downloadTimed.dispose() }
    const digest = createHash('sha256').update(downloaded).digest('hex')
    if (release.digest && digest !== release.digest) throw new Error('Cloudflare Tunnel SHA-256 verification failed; the file was not installed.')
    return { downloaded, tag: release.tag, digest, checksumKnown: release.digest !== null }
  }

  async function installManaged(): Promise<string> {
    const target = targetFor(platform, arch)
    const executablePath = join(options.userDataDir, 'bin', target.executable)
    const manifestPath = join(options.userDataDir, 'bin', 'cloudflared-manifest.json')
    const manifestBytes = await readFile(manifestPath).catch(() => null)
    if (manifestBytes) {
      try {
        const manifest = JSON.parse(manifestBytes.toString('utf8')) as { executable: string; digest: string }
        if (manifest.executable === target.executable && /^[a-f0-9]{64}$/.test(manifest.digest)) {
          const cached = await readFile(executablePath)
          if (createHash('sha256').update(cached).digest('hex') === manifest.digest && await probe(executablePath)) return executablePath
        }
      } catch { /* replace an absent or invalid managed cache */ }
    }

    const { downloaded, tag, checksumKnown } = await withRetry(() => downloadRelease(target.asset), {
      attempts: DOWNLOAD_ATTEMPTS,
      delayMs: retryDelayMs,
      onRetry: (attempt, error) => log('download-retry', { attempt, message: (error as Error).message })
    })

    const binDir = join(options.userDataDir, 'bin')
    await mkdir(binDir, { recursive: true })
    const nonce = `${process.pid}-${Date.now()}`
    const downloadPath = join(binDir, `.cloudflared-${nonce}.download`)
    const extractedPath = join(binDir, `.cloudflared-${nonce}.extracted`)
    const executableTemp = target.archive ? extractedPath : downloadPath
    try {
      await writeFile(downloadPath, downloaded, { flag: 'wx' })
      if (target.archive) await extractArchive(downloadPath, extractedPath)
      const executable = await readFile(executableTemp)
      if (executable.length === 0 || executable.length > MAX_EXTRACTED_BYTES) throw new Error('Cloudflare Tunnel executable has an invalid size.')
      if (platform !== 'win32') await chmod(executableTemp, 0o755)
      const verifiedDigest = createHash('sha256').update(executable).digest('hex')
      await renameWithRetry(executableTemp, executablePath)
      if (!checksumKnown) {
        log('checksum-unavailable', { tag, asset: target.asset })
        if (!await versionCheck(executablePath)) {
          await unlink(executablePath).catch(() => undefined)
          throw new Error('The downloaded Cloudflare Tunnel could not be verified (no published checksum was reachable and it did not report a version); it was not installed.')
        }
      }
      const manifestTemp = join(binDir, `.cloudflared-manifest-${nonce}.tmp`)
      await writeFile(manifestTemp, JSON.stringify({ version: tag, executable: target.executable, digest: verifiedDigest }), { flag: 'wx' })
      await renameWithRetry(manifestTemp, manifestPath)
    } finally {
      await Promise.all([downloadPath, extractedPath].map((path) => unlink(path).catch(() => undefined)))
    }
    if (!await probe(executablePath)) throw new Error('The installed Cloudflare Tunnel does not support the required --allowed-mail option.')
    return executablePath
  }

  async function findExistingBinary(): Promise<string | null> {
    const pathBinary = await findPathBinary(platform, env)
    const candidates = [...(pathBinary ? [pathBinary] : []), ...commonLocations(platform, env)]
    for (const candidate of candidates) {
      if (!await exists(candidate)) continue
      if (await probe(candidate)) return candidate
      log('existing-binary-rejected', { candidate })
    }
    return null
  }

  async function resolveExecutable(): Promise<string> {
    const existing = await findExistingBinary()
    if (existing) return existing
    try {
      return await installManaged()
    } catch (error) {
      const cause = (error as Error).message || 'unknown error'
      log('install-failed', { platform, arch, cause })
      const winget = platform === 'win32' ? ' On Windows you can run "winget install --id Cloudflare.cloudflared" in a terminal.' : ''
      throw new Error(`Dawsha could not set up Cloudflare Tunnel automatically (${cause}). Check your internet connection, VPN, proxy or antivirus, then try again, or install cloudflared yourself from ${MANUAL_INSTALL_URL}.${winget}`)
    }
  }

  function ensureExecutable(): Promise<string> {
    if (!resolving) resolving = resolveExecutable().finally(() => { resolving = null })
    return resolving
  }

  return { ensureExecutable }
}
