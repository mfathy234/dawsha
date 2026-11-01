import { extname } from 'node:path'
import type { CodeNavEngine, CodeNavResult, CodeNavStatus } from '../../shared/codeNav'
import { readProjectFile, resolveProjectFile } from '../gitWorkspace'
import { navigationHits } from './locations'
import { nameSearch } from './nameSearch'
import type { NavigationClient } from './tsserver'
import { validateCodeNavRequest } from './validation'
import type { SymbolRequest } from '../../shared/codeNavExtras'

interface Engines {
  typescript(folder: string): NavigationClient
  csharp(folder: string, file: string): Promise<NavigationClient | null>
  canInstall(): Promise<boolean>
}
const engineFor = (file: string): CodeNavEngine => /\.[cm]?[jt]sx?$/i.test(file) ? 'typescript' : extname(file).toLowerCase() === '.cs' ? 'csharp' : 'name'
const noServer: CodeNavStatus = { engine: 'name', state: 'none', canInstall: false }

export class CodeNavRouter {
  private readonly servers = new Map<string, Promise<NavigationClient | null>>()
  private stopped = false

  constructor(private readonly engines: Engines) {}

  async context(folder: string, raw: unknown): Promise<{ request: SymbolRequest; file: string; text: string; mtimeMs: number; engine: CodeNavEngine; server: NavigationClient | null } | { error: string }> {
    const request = validateCodeNavRequest({ ...(raw && typeof raw === 'object' ? raw : {}), kind: 'definition' })
    if (!request || request.path.includes('\\')) return { error: 'Invalid symbol request.' }
    const target = await resolveProjectFile(folder, request.path)
    if (!target.ok) return { error: target.error }
    const read = await readProjectFile(folder, request.path)
    if (!read.ok || read.text === null) return { error: 'Cannot read this file as text.' }
    const engine = engineFor(target.full)
    const server = await this.server(folder, target.full, engine)
    return { request, file: target.full, text: request.unsavedText ?? read.text, mtimeMs: read.mtimeMs, engine, server: server?.state === 'ready' ? server : null }
  }

  private server(folder: string, file: string, engine: CodeNavEngine): Promise<NavigationClient | null> {
    const key = `${folder}:${engine === 'csharp' ? file : engine}`
    const previous = this.servers.get(key)
    if (previous) return previous
    if (this.stopped || engine === 'name') return Promise.resolve(null)
    const start = Promise.resolve().then(() => engine === 'typescript' ? this.engines.typescript(folder) : this.engines.csharp(folder, file)).catch(() => null)
    this.servers.set(key, start)
    void start.then(client => { if (this.stopped || this.servers.get(key) !== start) client?.stop() })
    return start
  }

  async query(folder: string, raw: unknown): Promise<CodeNavResult> {
    const request = validateCodeNavRequest(raw)
    if (!request) return { ok: false, error: 'Invalid navigation request.' }
    const target = await resolveProjectFile(folder, request.path)
    if (!target.ok) return { ok: false, error: target.error }
    const engine = engineFor(request.path)
    const server = await this.server(folder, target.full, engine)
    if (server?.state === 'ready') {
      const read = request.unsavedText !== undefined ? { ok: true as const, text: request.unsavedText } : await readProjectFile(folder, request.path)
      if (read.ok && read.text !== null) {
        try {
          const locations = await server.query(target.full, read.text, request)
          return await navigationHits(folder, locations, engine, { file: target.full, text: read.text })
        } catch { /* Timed-out and stopped engines fall back to bounded name search. */ }
      }
    }
    return nameSearch(folder, request)
  }

  async status(folder: string, path: unknown): Promise<CodeNavStatus> {
    const target = await resolveProjectFile(folder, path)
    if (!target.ok) return noServer
    const engine = engineFor(target.full)
    if (engine === 'name') return noServer
    const key = `${folder}:${engine === 'csharp' ? target.full : engine}`
    const server = engine === 'csharp' ? await this.server(folder, target.full, engine) : await this.servers.get(key)
    return { engine, state: server?.state ?? (engine === 'csharp' ? 'missing' : 'none'), canInstall: engine === 'csharp' && !server && await this.engines.canInstall() }
  }

  async restart(folder: string, path: unknown): Promise<void> {
    const target = await resolveProjectFile(folder, path)
    if (!target.ok) return
    const engine = engineFor(target.full)
    const key = `${folder}:${engine === 'csharp' ? target.full : engine}`
    const previous = this.servers.get(key)
    this.servers.delete(key)
    const client = await previous
    if (client) {
      client.stop()
      await Promise.all([...this.servers].map(async ([alias, promise]) => {
        if (await promise === client && this.servers.get(alias) === promise) this.servers.delete(alias)
      }))
    }
    await this.server(folder, target.full, engine)
  }

  installed(): void {
    for (const [key, promise] of this.servers) {
      void promise.then(client => { if (!client && this.servers.get(key) === promise) this.servers.delete(key) })
    }
  }

  stop(): void {
    this.stopped = true
    for (const server of this.servers.values()) void server.then(client => client?.stop())
    this.servers.clear()
  }
}
