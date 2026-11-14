import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parseDiagramError, parseJavaVersion, sanitizeDiagramSvg, type DiagramResult, type DiagramStatus } from '../shared/diagrams'
import { DiagramQueue } from './diagramQueue'

// Official MIT release asset and GitHub's published SHA-256 asset digest.
export const PLANTUML_VERSION = '1.2025.4'
export const PLANTUML_SHA256 = 'cb8bca6301c114eb66c6e6c55b4cd1962f380616c622e964596a24f94246bc41'
export const PLANTUML_BYTES = 12_967_352
export const PLANTUML_URL = `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-mit-${PLANTUML_VERSION}.jar`
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CACHE_ENTRIES = 128
const exec = promisify(execFile)
const queue = new DiagramQueue()

export function diagramCacheKey(text: string, folder: string, jarIdentity: string): string {
  return createHash('sha256').update(JSON.stringify([PLANTUML_VERSION, text, folder, jarIdentity])).digest('hex')
}

export async function verifyJarHash(path: string, expected = PLANTUML_SHA256): Promise<boolean> {
  try {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === expected.toLowerCase()
  } catch { return false }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

/** Drop inherited JVM flags and PlantUML allowlists so diagrams cannot opt into network access. */
export function localPlantumlEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^plantuml[_.]/i.test(key) || /^(?:JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS)$/i.test(key)) delete env[key]
  }
  env.PLANTUML_SECURITY_PROFILE = 'ALLOWLIST'
  return env
}

async function detectJava(): Promise<string | null> {
  const home = process.env.JAVA_HOME?.replace(/^"|"$/g, '')
  const candidates = [...(home ? [join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')] : []), 'java']
  for (const candidate of candidates) {
    try {
      const result = await exec(candidate, ['-version'], { timeout: 3500, windowsHide: true, maxBuffer: 32 * 1024, env: localPlantumlEnvironment() })
      if ((parseJavaVersion(result.stdout + result.stderr) ?? 0) >= 8) return candidate
    } catch { /* Try PATH after an obsolete JAVA_HOME. */ }
  }
  return null
}

export class DiagramService {
  private readonly folder: string
  private downloading?: Promise<{ ok: true } | { ok: false; error: string }>

  constructor(userData: string, private readonly getJarPath: () => string) {
    this.folder = join(userData, 'diagrams')
  }

  /** Offline tests: Node script, folder/file argv, UTF-8 stdin, SVG stdout, errors on stderr. */
  private fakeRenderer(): string | undefined {
    return process.env.DAWSHA_USER_DATA ? process.env.DAWSHA_PLANTUML_FAKE_RENDERER : undefined
  }

  private jarPath(): string {
    return this.getJarPath().trim() || process.env.DAWSHA_PLANTUML_JAR?.trim() || join(this.folder, `plantuml-mit-${PLANTUML_VERSION}.jar`)
  }

  async status(): Promise<DiagramStatus> {
    const fake = this.fakeRenderer()
    return {
      java: !!fake || !!await detectJava(),
      jar: !!fake || await exists(this.jarPath()),
      jarOverride: !!(this.getJarPath().trim() || process.env.DAWSHA_PLANTUML_JAR?.trim()),
      downloadMegabytes: Math.ceil(PLANTUML_BYTES / 1_000_000),
      version: PLANTUML_VERSION
    }
  }

  download(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.downloading) this.downloading = this.downloadJar().finally(() => { this.downloading = undefined })
    return this.downloading
  }

  private async downloadJar(): Promise<{ ok: true } | { ok: false; error: string }> {
    const target = join(this.folder, `plantuml-mit-${PLANTUML_VERSION}.jar`)
    const temporary = `${target}.download`
    try {
      await mkdir(this.folder, { recursive: true })
      const response = await fetch(PLANTUML_URL, { signal: AbortSignal.timeout(120_000), redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`PlantUML download failed (${response.status})`)
      const pieces: Uint8Array[] = []
      let size = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const { value: chunk, done } = await reader.read()
          if (done) break
          size += chunk.byteLength
          if (size > PLANTUML_BYTES) throw new Error('The PlantUML download is larger than expected')
          pieces.push(chunk)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      await writeFile(temporary, Buffer.concat(pieces))
      if (size !== PLANTUML_BYTES || !await verifyJarHash(temporary)) throw new Error('The PlantUML download did not match its verified SHA-256')
      await rename(temporary, target)
      return { ok: true }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      return { ok: false, error: error instanceof Error ? error.message : 'PlantUML could not be downloaded' }
    }
  }

  async render(folder: string, path: string, text: string, sourceLine?: number): Promise<DiagramResult> {
    if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) return { ok: false, error: 'This diagram is larger than 1 MB', reason: 'render' }
    const absolute = resolve(folder, path)
    return queue.render(`${absolute}|${sourceLine ?? ''}`, signal => this.renderLocal(resolve(folder), absolute, text, signal))
  }

  private async renderLocal(folder: string, path: string, text: string, signal: AbortSignal): Promise<DiagramResult> {
    const fake = this.fakeRenderer()
    const java = fake ? process.execPath : await detectJava()
    if (!java) return { ok: false, error: 'Install Java to see this diagram', reason: 'java' }
    if (signal.aborted) return { ok: false, error: 'Drawing this diagram timed out', reason: 'render' }
    const jar = this.jarPath()
    if (!fake && !await exists(jar)) return { ok: false, error: 'Download PlantUML to see this diagram', reason: 'jar' }
    // Includes, file functions and preprocessor state can change without this text changing.
    const cacheable = !/(?:^\s*!|%(?:load|file|dir|getenv))/im.test(text)
    const jarStat = await stat(fake || jar).catch(() => null)
    const identity = `${fake || jar}:${jarStat?.size}:${jarStat?.mtimeMs}`
    const cache = join(this.folder, 'cache', `${diagramCacheKey(text, dirname(path), identity)}.svg`)
    if (cacheable) {
      try {
        const cached = await stat(cache)
        if (cached.size <= MAX_OUTPUT_BYTES) return { ok: true, svg: sanitizeDiagramSvg(await readFile(cache, 'utf8')) }
      } catch { /* Render a cache miss. */ }
    }
    const args = fake ? [fake, folder, path] : [
      '-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=ALLOWLIST',
      `-Dplantuml.allowlist.path=${folder}`, `-Dplantuml.include.path=${dirname(path)}`, '-Dplantuml.allowlist.url=',
      '-jar', jar, '-tsvg', '-pipe', '-charset', 'UTF-8', '-Playout=smetana'
    ]
    const env = localPlantumlEnvironment()
    if (fake) env.ELECTRON_RUN_AS_NODE = '1'
    const result = await this.run(java, args, dirname(path), env, text, signal)
    if (result.ok && cacheable) {
      try {
        await mkdir(dirname(cache), { recursive: true })
        await writeFile(cache, result.svg, 'utf8')
        await this.trimCache(dirname(cache))
      } catch { /* Cache failures must not hide the diagram. */ }
    }
    return result
  }

  private run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, text: string, signal: AbortSignal): Promise<DiagramResult> {
    return new Promise(resolveResult => {
      const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: 'pipe' })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let size = 0
      let capped = false
      const abort = () => { child.kill() }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      const collect = (destination: Buffer[]) => (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_OUTPUT_BYTES) { capped = true; child.kill(); return }
        destination.push(chunk)
      }
      child.stdout.on('data', collect(stdout))
      child.stderr.on('data', collect(stderr))
      child.stdin.on('error', () => {})
      child.once('error', error => resolveResult({ ok: false, error: error.message, reason: 'render' }))
      child.once('close', code => {
        signal.removeEventListener('abort', abort)
        if (capped) { resolveResult({ ok: false, error: 'This diagram produced more than 8 MB', reason: 'render' }); return }
        const svg = Buffer.concat(stdout).toString('utf8')
        const error = Buffer.concat(stderr).toString('utf8')
        if (code !== 0 || !/<svg\b/i.test(svg) || /\bERROR\s*\r?\n\s*\d+|Syntax Error\?/i.test(error)) {
          resolveResult({ ok: false, ...parseDiagramError(error, svg), reason: 'render' })
          return
        }
        const clean = sanitizeDiagramSvg(svg)
        resolveResult(clean ? { ok: true, svg: clean } : { ok: false, error: 'PlantUML returned an invalid SVG', reason: 'render' })
      })
      child.stdin.end(text, 'utf8')
    })
  }

  private async trimCache(folder: string): Promise<void> {
    const files = await Promise.all((await readdir(folder)).filter(name => /^[a-f0-9]{64}\.svg$/.test(name)).map(async name => {
      const path = join(folder, basename(name))
      const info = await stat(path)
      return { path, size: info.size, time: info.mtimeMs }
    }))
    files.sort((a, b) => b.time - a.time)
    let bytes = 0
    await Promise.all(files.filter((file, index) => {
      bytes += file.size
      return index >= MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES
    }).map(file => rm(file.path, { force: true })))
  }
}
