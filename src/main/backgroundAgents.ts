import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { codexParentId, parseClaudeAgent, parseCodexAgent, type ParsedAgent, type Sampled } from '../shared/agentRecords'
import { type BackgroundAgent, type BackgroundAgentsReport, type BgKind, type BgRange, rangeMs } from '../shared/backgroundAgents'
import { parseSessionIndex, rolloutIdFromName } from '../shared/codexSession'
import { estimateCost, type PriceLookup } from '../shared/orch/usage'
import { claudeProjectSlug, sessionTitle } from '../shared/projectSessions'
import { normalizePath } from '../shared/sessionMatch'
import { realPrompt } from '../shared/sessionText'
import type { Project } from '../shared/types'
import { listRolloutFiles, readRange } from './projectSessions'

const WHOLE_BYTES = 1024 * 1024
const CLAUDE_HEAD = 32 * 1024
const CLAUDE_TAIL = 256 * 1024
const CODEX_HEAD = 128 * 1024
const CODEX_TAIL = 256 * 1024
const PARENT_HEAD = 96 * 1024
const PARENT_TAIL = 48 * 1024
const PARENT_TTL_MS = 30_000
const RUNNING_RECHECK_MS = 30_000
const CACHE_LIMIT = 4000
const BATCH = 24
const CODEX_NAME_SLACK_MS = 2 * 86_400_000
const ROLLOUT_STAMP = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-/

export interface AgentHomes {
  claudeProjects: string
  codex: string
}

interface Entry {
  key: string
  parsedAt: number
  agent: ParsedAgent | null
}

interface Located {
  kind: BgKind
  path: string
}

interface Raw extends Located {
  agent: ParsedAgent
  folderSlug: string | null
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let at = 0; at < items.length; at += BATCH) out.push(...(await Promise.all(items.slice(at, at + BATCH).map(work))))
  return out
}

async function statOf(path: string): Promise<{ size: number; mtime: number; birth: number } | null> {
  try {
    const info = await stat(path)
    return { size: info.size, mtime: Math.round(info.mtimeMs), birth: Math.round(info.birthtimeMs) }
  } catch {
    return null
  }
}

async function sample(path: string, size: number, headBytes: number, tailBytes: number): Promise<Sampled> {
  if (size <= WHOLE_BYTES) return { head: await readFile(path, 'utf8'), tail: '', whole: true, read: size, size }
  const head = await readRange(path, 0, headBytes)
  const tail = await readRange(path, size - tailBytes, tailBytes)
  return { head, tail, whole: false, read: headBytes + tailBytes, size }
}

export function projectForFolder(cwd: string | null, projects: readonly Project[]): Project | null {
  if (!cwd) return null
  const here = normalizePath(cwd)
  let best: Project | null = null
  for (const project of projects) {
    const folder = normalizePath(project.folder)
    if ((here === folder || here.startsWith(`${folder}/`)) && (!best || folder.length > normalizePath(best.folder).length)) best = project
  }
  return best
}

/** Finds every Claude Code and Codex sub-agent whose transcript changed in the range, reading only short samples. */
export class BackgroundAgentScanner {
  private readonly entries = new Map<string, Entry>()
  private readonly files = new Map<string, Located>()
  private readonly parentTitles = new Map<string, { at: number; title: string }>()

  constructor(private readonly homes: () => AgentHomes) {}

  /** The transcript behind an agent the last scan returned; null when unknown. */
  pathOf(kind: BgKind, id: string): string | null {
    const found = this.files.get(`${kind}:${id}`)
    return found ? found.path : null
  }

  async list(range: BgRange, projects: readonly Project[], prices: PriceLookup, now: number = Date.now()): Promise<BackgroundAgentsReport> {
    const since = now - rangeMs(range)
    const homes = this.homes()
    const [claude, codex] = await Promise.all([this.claudeAgents(homes.claudeProjects, since, now), this.codexAgents(homes.codex, since, now)])
    const raws = [...claude, ...codex]
    this.files.clear()
    for (const raw of raws) this.files.set(`${raw.agent.kind}:${raw.agent.id}`, { kind: raw.agent.kind, path: raw.path })
    const rootOf = this.rootResolver(codex)
    const slugs = new Map(projects.map((project) => [claudeProjectSlug(project.folder), project]))
    const titles = await this.parentTitles_(raws, homes, rootOf)
    const agents = raws.map((raw): BackgroundAgent => {
      const parentId = raw.agent.kind === 'codex' ? rootOf(raw.agent.parentId) : raw.agent.parentId
      const project = (raw.folderSlug ? slugs.get(raw.folderSlug) : undefined) ?? projectForFolder(raw.agent.cwd, projects)
      const { usage } = raw.agent
      const price = raw.agent.model ? prices(raw.agent.kind, raw.agent.model) : null
      return {
        key: `${raw.agent.kind}:${raw.agent.id}`,
        id: raw.agent.id,
        kind: raw.agent.kind,
        parentId,
        parentTitle: titles.get(`${raw.agent.kind}:${parentId}`) ?? `${raw.agent.kind === 'claude' ? 'Claude' : 'Codex'} session ${parentId.slice(0, 8)}`,
        projectId: project?.id ?? null,
        projectLabel: project?.name ?? (raw.agent.cwd ? basename(raw.agent.cwd) || raw.agent.cwd : raw.folderSlug ?? 'Unknown folder'),
        description: raw.agent.description,
        type: raw.agent.type,
        automatic: raw.agent.automatic,
        model: raw.agent.model,
        depth: raw.agent.depth,
        parentAgentId: raw.agent.parentAgentId,
        startedAt: raw.agent.startedAt,
        endedAt: raw.agent.endedAt,
        lastActivityAt: raw.agent.lastActivityAt,
        status: raw.agent.status,
        statusNote: raw.agent.statusNote,
        tokens: usage.input + usage.output + usage.cacheWrite,
        tokensApprox: raw.agent.usageApprox,
        costUsd: price && price !== 'free' ? estimateCost({ inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, reportedCostUsd: null }, price) : null,
        lastStep: raw.agent.lastStep,
        result: raw.agent.result
      }
    })
    return { generatedAt: now, range, agents: agents.filter((agent) => agent.lastActivityAt >= since || agent.status === 'running') }
  }

  private remember(path: string, entry: Entry): void {
    if (this.entries.size >= CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(path, entry)
  }

  private fresh(path: string, key: string, now: number): Entry | null {
    const known = this.entries.get(path)
    if (!known || known.key !== key) return null
    return known.agent?.status === 'running' && now - known.parsedAt > RUNNING_RECHECK_MS ? null : known
  }

  private async claudeAgents(projectsDir: string, since: number, now: number): Promise<Raw[]> {
    const found: { slug: string; parentId: string; id: string; jsonl: string; meta: string }[] = []
    let slugs: string[] = []
    try {
      slugs = await readdir(projectsDir)
    } catch {
      return []
    }
    await inBatches(slugs, async (slug) => {
      let sessions: import('node:fs').Dirent[]
      try {
        sessions = await readdir(join(projectsDir, slug), { withFileTypes: true })
      } catch {
        return
      }
      for (const session of sessions.filter((entry) => entry.isDirectory())) {
        const dir = join(projectsDir, slug, session.name, 'subagents')
        let names: string[]
        try {
          names = await readdir(dir)
        } catch {
          continue
        }
        for (const name of names) {
          const id = /^agent-(.+)\.meta\.json$/.exec(name)?.[1]
          if (id) found.push({ slug, parentId: session.name, id, jsonl: join(dir, `agent-${id}.jsonl`), meta: join(dir, name) })
        }
      }
    })
    const parsed = await inBatches(found, async (item): Promise<Raw | null> => {
      const info = await statOf(item.jsonl)
      if (!info || info.size === 0 || info.mtime < since) return null
      const metaInfo = await statOf(item.meta)
      const key = `${info.size}:${info.mtime}:${metaInfo?.mtime ?? 0}`
      const cached = this.fresh(item.jsonl, key, now)
      if (cached) return cached.agent ? { kind: 'claude', path: item.jsonl, agent: cached.agent, folderSlug: item.slug } : null
      try {
        const meta: unknown = JSON.parse(await readFile(item.meta, 'utf8'))
        const agent = parseClaudeAgent({ id: item.id, parentId: item.parentId, meta, ...(await sample(item.jsonl, info.size, CLAUDE_HEAD, CLAUDE_TAIL)), mtime: info.mtime, fallbackStart: metaInfo?.birth ?? info.birth, now })
        this.remember(item.jsonl, { key, parsedAt: now, agent })
        return { kind: 'claude', path: item.jsonl, agent, folderSlug: item.slug }
      } catch {
        return null
      }
    })
    return parsed.filter((raw): raw is Raw => raw !== null)
  }

  private async codexAgents(home: string, since: number, now: number): Promise<Raw[]> {
    const all = await listRolloutFiles(join(home, 'sessions'))
    const recent = all.filter((path) => {
      const stamp = ROLLOUT_STAMP.exec(basename(path))
      if (!stamp) return true
      const born = new Date(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6])).getTime()
      return born >= since - CODEX_NAME_SLACK_MS
    })
    const parsed = await inBatches(recent, async (path): Promise<Raw | null> => {
      const info = await statOf(path)
      if (!info || info.size === 0 || info.mtime < since) return null
      const key = `${info.size}:${info.mtime}`
      const cached = this.fresh(path, key, now)
      if (cached) return cached.agent ? { kind: 'codex', path, agent: cached.agent, folderSlug: null } : null
      try {
        const head = await readRange(path, 0, Math.min(info.size, CODEX_HEAD))
        if (!codexParentId(head.split('\n')[0])) {
          this.remember(path, { key, parsedAt: now, agent: null })
          return null
        }
        const agent = parseCodexAgent({ ...(await sample(path, info.size, CODEX_HEAD, CODEX_TAIL)), mtime: info.mtime, now })
        this.remember(path, { key, parsedAt: now, agent })
        return agent ? { kind: 'codex', path, agent, folderSlug: null } : null
      } catch {
        return null
      }
    })
    return parsed.filter((raw): raw is Raw => raw !== null)
  }

  /** Climbs from a Codex sub-agent's parent to the session that started the chain. */
  private rootResolver(codex: readonly Raw[]): (id: string) => string {
    const parents = new Map(codex.map((raw) => [raw.agent.id, raw.agent.parentId]))
    return (id) => {
      let current = id
      for (let hops = 0; hops < 8 && parents.has(current); hops += 1) current = parents.get(current)!
      return current
    }
  }

  private async parentTitles_(raws: readonly Raw[], homes: AgentHomes, rootOf: (id: string) => string): Promise<Map<string, string>> {
    const wanted = new Map<string, Raw>()
    for (const raw of raws) wanted.set(`${raw.agent.kind}:${raw.agent.kind === 'codex' ? rootOf(raw.agent.parentId) : raw.agent.parentId}`, raw)
    const titles = new Map<string, string>()
    const names = await codexNames(homes.codex)
    const rollouts = raws.some((raw) => raw.kind === 'codex') ? await rolloutPaths(homes.codex) : new Map<string, string>()
    await inBatches([...wanted.entries()], async ([key, raw]) => {
      const cached = this.parentTitles.get(key)
      if (cached && Date.now() - cached.at < PARENT_TTL_MS) {
        titles.set(key, cached.title)
        return
      }
      const id = key.slice(key.indexOf(':') + 1)
      const title = raw.kind === 'claude' ? await claudeParentTitle(raw.path, id) : names.get(id) ?? (await codexParentTitle(rollouts.get(id)))
      if (title) {
        this.parentTitles.set(key, { at: Date.now(), title })
        titles.set(key, title)
      }
    })
    return titles
  }
}

async function claudeParentTitle(agentPath: string, parentId: string): Promise<string | null> {
  const parent = join(agentPath, '..', '..', '..', `${parentId}.jsonl`)
  const info = await statOf(parent)
  if (!info) return null
  try {
    const head = await readRange(parent, 0, Math.min(info.size, PARENT_HEAD))
    const tail = info.size > PARENT_HEAD ? await readRange(parent, Math.max(0, info.size - PARENT_TAIL), PARENT_TAIL) : ''
    return sessionTitle(head, tail)
  } catch {
    return null
  }
}

async function codexNames(home: string): Promise<Map<string, string>> {
  try {
    return parseSessionIndex(await readFile(join(home, 'session_index.jsonl'), 'utf8'))
  } catch {
    return new Map()
  }
}

async function rolloutPaths(home: string): Promise<Map<string, string>> {
  return new Map((await listRolloutFiles(join(home, 'sessions'))).flatMap((path) => {
    const id = rolloutIdFromName(basename(path))
    return id ? [[id, path] as const] : []
  }))
}

async function codexParentTitle(path: string | undefined): Promise<string | null> {
  if (!path) return null
  try {
    for (const line of (await readRange(path, 0, CODEX_HEAD)).split('\n').slice(1)) {
      if (!line.includes('"role":"user"')) continue
      let content: { text?: unknown }[] | undefined
      try {
        content = (JSON.parse(line) as { payload?: { content?: { text?: unknown }[] } }).payload?.content
      } catch {
        continue
      }
      for (const block of content ?? []) {
        const prompt = typeof block.text === 'string' ? realPrompt(block.text, 80) : null
        if (prompt) return prompt
      }
    }
  } catch {
    return null
  }
  return null
}
