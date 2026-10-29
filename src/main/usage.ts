import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { rolloutIdFromName } from '../shared/codexSession'
import { sessionIdFromFile } from '../shared/projectSessions'
import type { AgentKind, Project, StatusInfo } from '../shared/types'
import {
  buildUsageReport,
  emptyHistory,
  parserFor,
  rangeWindow,
  lastClaudeLimits,
  recordReadings,
  sanitizeHistory,
  serializeHistory,
  type StatusReading,
  type UsageFile,
  type UsageHistory,
  type UsageRange,
  type UsageReport,
  type UsageSource
} from '../shared/usage'
import type { AgentLimitEntry } from '../shared/agentLimits'
import { buildUsageSnapshot, type UsageSnapshot } from '../shared/sessionCost'
import { codexHome, geminiHome } from './agentLaunch'
import { listGeminiChatFiles } from './geminiWatcher'
import { claudeProjectsDir } from './paths'
import { listRolloutFiles } from './projectSessions'

const SAVE_DELAY_MS = 1500
const PROJECT_MARKER = '.project_root'

interface Cached {
  mtimeMs: number
  size: number
  file: UsageFile
}

interface Candidate {
  agent: AgentKind
  path: string
  mtimeMs: number
  size: number
  cwd?: string | null
}

const cache = new Map<string, Cached>()
const markerCache = new Map<string, string | null>()

async function statOf(path: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : null
  } catch {
    return null
  }
}

async function parseFile(candidate: Candidate): Promise<UsageFile | null> {
  const parser = parserFor(candidate.agent)
  try {
    if (candidate.path.endsWith('.json')) {
      parser.push(await readFile(candidate.path, 'utf8'))
    } else {
      const lines = createInterface({ input: createReadStream(candidate.path, { encoding: 'utf8' }), crlfDelay: Infinity })
      for await (const line of lines) parser.push(line)
    }
  } catch {
    return null
  }
  const parsed = parser.finish()
  return candidate.cwd ? { ...parsed, cwd: parsed.cwd ?? candidate.cwd } : parsed
}

async function usageOf(candidate: Candidate): Promise<UsageFile | null> {
  const known = cache.get(candidate.path)
  if (known && known.mtimeMs === candidate.mtimeMs && known.size === candidate.size) return known.file
  const file = await parseFile(candidate)
  if (file) cache.set(candidate.path, { mtimeMs: candidate.mtimeMs, size: candidate.size, file })
  return file
}

async function names(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir)
  } catch {
    return null
  }
}

async function claudeCandidates(dir: string, since: number): Promise<{ found: boolean; list: Candidate[] }> {
  const slugs = await names(dir)
  if (!slugs) return { found: false, list: [] }
  const list: Candidate[] = []
  for (const slug of slugs) {
    for (const name of (await names(join(dir, slug))) ?? []) {
      if (!sessionIdFromFile(name)) continue
      const path = join(dir, slug, name)
      const info = await statOf(path)
      if (info && info.mtimeMs >= since) list.push({ agent: 'claude', path, ...info })
    }
  }
  return { found: true, list }
}

async function codexCandidates(home: string, since: number): Promise<{ found: boolean; list: Candidate[] }> {
  const root = join(home, 'sessions')
  if ((await names(root)) === null) return { found: false, list: [] }
  const list: Candidate[] = []
  for (const path of await listRolloutFiles(root)) {
    if (!rolloutIdFromName(path.split(/[\\/]/).pop() ?? '')) continue
    const info = await statOf(path)
    if (info && info.mtimeMs >= since) list.push({ agent: 'codex', path, ...info })
  }
  return { found: true, list }
}

async function projectFolder(home: string, slug: string): Promise<string | null> {
  const marker = join(home, 'tmp', slug, PROJECT_MARKER)
  if (markerCache.has(marker)) return markerCache.get(marker) ?? null
  let folder: string | null = null
  try {
    folder = (await readFile(marker, 'utf8')).trim() || null
  } catch {
    folder = null
  }
  markerCache.set(marker, folder)
  return folder
}

async function geminiCandidates(home: string, since: number): Promise<{ found: boolean; list: Candidate[] }> {
  if ((await names(join(home, 'tmp'))) === null) return { found: false, list: [] }
  const list: Candidate[] = []
  for (const file of await listGeminiChatFiles(home)) {
    if (file.modifiedAt < since) continue
    list.push({
      agent: 'gemini',
      path: file.path,
      mtimeMs: file.modifiedAt,
      size: file.size,
      cwd: await projectFolder(home, file.slug)
    })
  }
  return { found: true, list }
}

export interface UsageScan {
  files: UsageFile[]
  sources: UsageSource[]
}

export async function scanUsage(since: number): Promise<UsageScan> {
  const found = {
    claude: await claudeCandidates(claudeProjectsDir(), since),
    codex: await codexCandidates(codexHome(), since),
    gemini: await geminiCandidates(geminiHome(), since)
  }
  const files: UsageFile[] = []
  for (const agent of ['claude', 'codex', 'gemini'] as const) {
    for (const candidate of found[agent].list) {
      const file = await usageOf(candidate)
      if (file) files.push(file)
    }
  }
  const sources = (['claude', 'codex', 'gemini'] as const).map(
    (agent): UsageSource => ({ agent, found: found[agent].found, files: found[agent].list.length })
  )
  return { files, sources }
}

function readHistory(path: string): UsageHistory {
  try {
    return sanitizeHistory(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return emptyHistory()
  }
}

const toReading = (info: StatusInfo): StatusReading => ({
  sessionId: info.sessionId,
  cwd: info.cwd,
  costUsd: info.costUsd,
  receivedAt: info.receivedAt,
  windows: info.rateLimits.map((limit) => ({ key: limit.key, percent: limit.percent, resetsAt: limit.resetsAt }))
})

export class UsageService {
  private history: UsageHistory = emptyHistory()
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Map<UsageRange, Promise<UsageReport>>()
  private snapshotJob: Promise<UsageSnapshot> | null = null

  constructor(private readonly historyPath: string) {}

  load(): void {
    this.history = readHistory(this.historyPath)
  }

  recordStatus(infos: StatusInfo[]): void {
    const next = recordReadings(this.history, infos.map(toReading))
    if (next === this.history) return
    this.history = next
    if (!this.timer) this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS)
  }

  lastClaudeLimits(): AgentLimitEntry | null {
    return lastClaudeLimits(this.history)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const temp = `${this.historyPath}.tmp`
    try {
      mkdirSync(dirname(this.historyPath), { recursive: true })
      writeFileSync(temp, JSON.stringify(serializeHistory(this.history)), 'utf8')
      renameSync(temp, this.historyPath)
    } catch {
      rmSync(temp, { force: true })
    }
  }

  report(range: UsageRange, projects: Project[]): Promise<UsageReport> {
    const active = this.running.get(range)
    if (active) return active
    const job = this.build(range, projects).finally(() => this.running.delete(range))
    this.running.set(range, job)
    return job
  }

  snapshot(projects: Project[]): Promise<UsageSnapshot> {
    this.snapshotJob ??= this.buildSnapshot(projects).finally(() => {
      this.snapshotJob = null
    })
    return this.snapshotJob
  }

  private async buildSnapshot(projects: Project[]): Promise<UsageSnapshot> {
    const now = Date.now()
    const scan = await scanUsage(rangeWindow('today', now).start)
    return buildUsageSnapshot({ now, files: scan.files, projects, history: this.history })
  }

  private async build(range: UsageRange, projects: Project[]): Promise<UsageReport> {
    const now = Date.now()
    const scan = await scanUsage(rangeWindow(range, now).start)
    return buildUsageReport({
      range,
      now,
      files: scan.files,
      projects,
      history: this.history,
      sources: scan.sources
    })
  }
}
