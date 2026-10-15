import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRolloutMeta, parseSessionIndex } from '../shared/codexSession'
import { parseGeminiChat } from '../shared/geminiSession'
import { claudeProjectSlug, sessionIdFromFile, sessionTitle } from '../shared/projectSessions'
import { RESUME_LIMIT, matchesQuery } from '../shared/resumeIndex'
import { claudeDetail, codexDetail, contentMatch, geminiDetail, modelLabel, type SessionDetail } from '../shared/sessionDetail'
import { normalizePath } from '../shared/sessionMatch'
import type { AgentKind, Project, ResumeQuery, ResumeSession } from '../shared/types'
import { codexHome, geminiHome } from './agentLaunch'
import { listGeminiChatFiles, projectSlugs } from './geminiWatcher'
import { claudeProjectsDir } from './paths'
import { listRolloutFiles, readRange } from './projectSessions'

const MAX_SCANNED = 400
const MAX_CODEX_FILES = 300
const MAX_GEMINI_FILES = 200
const WHOLE_BYTES = 6 * 1024 * 1024
const EDGE_BYTES = 256 * 1024
const CODEX_META_BYTES = 64 * 1024

interface Candidate {
  agent: AgentKind
  path: string
  projectId: string
  modifiedAt: number
  size: number
  id?: string
}

interface Sample {
  text: string
  scale: number
}

const detailCache = new Map<string, { key: string; session: ResumeSession | null }>()
const codexCwdCache = new Map<string, string | null>()

export interface SessionHomes {
  claudeProjects: string
  codex: string
  gemini: string
}

const defaultHomes = (): SessionHomes => ({ claudeProjects: claudeProjectsDir(), codex: codexHome(), gemini: geminiHome() })

async function sample(path: string, size: number): Promise<Sample> {
  if (size <= WHOLE_BYTES) return { text: await readFile(path, 'utf8'), scale: 1 }
  const head = await readRange(path, 0, EDGE_BYTES)
  const tail = await readRange(path, size - EDGE_BYTES, EDGE_BYTES)
  return { text: `${head}\n${tail}`, scale: size / (EDGE_BYTES * 2) }
}

async function claudeCandidates(projects: Project[], projectsDir: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const project of projects) {
    const dir = join(projectsDir, claudeProjectSlug(project.folder))
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const id = sessionIdFromFile(name)
      if (!id) continue
      try {
        const info = await stat(join(dir, name))
        if (info.size > 0) out.push({ agent: 'claude', id, path: join(dir, name), projectId: project.id, modifiedAt: Math.round(info.mtimeMs), size: info.size })
      } catch {
        continue
      }
    }
  }
  return out
}

async function codexCwd(path: string): Promise<string | null> {
  if (codexCwdCache.has(path)) return codexCwdCache.get(path) ?? null
  let cwd: string | null = null
  try {
    cwd = parseRolloutMeta((await readRange(path, 0, CODEX_META_BYTES)).split('\n')[0])?.cwd ?? null
  } catch {
    cwd = null
  }
  codexCwdCache.set(path, cwd)
  return cwd
}

async function codexCandidates(projects: Project[], home: string): Promise<Candidate[]> {
  const byFolder = new Map(projects.map((p) => [normalizePath(p.folder), p.id]))
  const files = await Promise.all(
    (await listRolloutFiles(join(home, 'sessions'))).map(async (path) => {
      try {
        const info = await stat(path)
        return { path, modifiedAt: Math.round(info.mtimeMs), size: info.size }
      } catch {
        return null
      }
    })
  )
  const newest = files.filter((f): f is NonNullable<typeof f> => f !== null).sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_CODEX_FILES)
  const out: Candidate[] = []
  for (const file of newest) {
    const cwd = await codexCwd(file.path)
    const projectId = cwd ? byFolder.get(normalizePath(cwd)) : undefined
    if (projectId) out.push({ agent: 'codex', ...file, projectId })
  }
  return out
}

async function geminiCandidates(projects: Project[], home: string): Promise<Candidate[]> {
  const files = await listGeminiChatFiles(home)
  const out: Candidate[] = []
  for (const project of projects) {
    const slugs = new Set(await projectSlugs(project.folder, home))
    for (const file of files) {
      if (slugs.has(file.slug)) out.push({ agent: 'gemini', path: file.path, projectId: project.id, modifiedAt: file.modifiedAt, size: file.size })
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_GEMINI_FILES)
}

function build(candidate: Candidate, id: string, title: string, detail: SessionDetail): ResumeSession {
  return {
    agent: candidate.agent,
    id,
    title,
    projectId: candidate.projectId,
    modifiedAt: candidate.modifiedAt,
    startedAt: detail.startedAt ?? candidate.modifiedAt,
    messageCount: detail.messages,
    model: modelLabel(candidate.agent, detail.model),
    firstPrompt: detail.firstPrompt,
    lastAssistant: detail.lastAssistant
  }
}

async function enrichClaude(candidate: Candidate): Promise<ResumeSession | null> {
  const { text, scale } = await sample(candidate.path, candidate.size)
  const half = Math.min(text.length, 96 * 1024)
  const title = sessionTitle(text.slice(0, half), text.slice(-48 * 1024))
  if (!title || !candidate.id) return null
  return build(candidate, candidate.id, title, claudeDetail(text, scale))
}

async function enrichCodex(candidate: Candidate, names: Map<string, string>): Promise<ResumeSession | null> {
  const { text, scale } = await sample(candidate.path, candidate.size)
  const meta = parseRolloutMeta(text.split('\n')[0])
  if (!meta) return null
  const detail = codexDetail(text, scale)
  const title = names.get(meta.sessionId) ?? detail.firstPrompt?.slice(0, 80) ?? 'Codex session'
  return build(candidate, meta.sessionId, title, { ...detail, startedAt: meta.startedAt })
}

async function enrichGemini(candidate: Candidate): Promise<ResumeSession | null> {
  const { text, scale } = await sample(candidate.path, candidate.size)
  const chat = parseGeminiChat(text)
  if (!chat || !chat.hasConversation) return null
  const detail = geminiDetail(text, scale)
  const title = chat.name ?? 'Gemini session'
  return build(candidate, chat.sessionId, title, { ...detail, startedAt: chat.startedAt || detail.startedAt })
}

async function enrich(candidate: Candidate, names: Map<string, string>): Promise<ResumeSession | null> {
  const key = `${candidate.projectId}:${candidate.modifiedAt}:${candidate.size}`
  const known = detailCache.get(candidate.path)
  if (known?.key === key) return known.session
  let session: ResumeSession | null = null
  try {
    if (candidate.agent === 'claude') session = await enrichClaude(candidate)
    else if (candidate.agent === 'codex') session = await enrichCodex(candidate, names)
    else session = await enrichGemini(candidate)
  } catch {
    session = null
  }
  detailCache.set(candidate.path, { key, session })
  return session
}

async function gather(projects: Project[], query: ResumeQuery, homes: SessionHomes) {
  const scope = projects.filter((p) => !query.projectId || p.id === query.projectId)
  const wanted = (agent: AgentKind): boolean => !query.agent || query.agent === agent
  const [claude, codex, gemini, names] = await Promise.all([
    wanted('claude') ? claudeCandidates(scope, homes.claudeProjects) : [],
    wanted('codex') ? codexCandidates(scope, homes.codex) : [],
    wanted('gemini') ? geminiCandidates(scope, homes.gemini) : [],
    readFile(join(homes.codex, 'session_index.jsonl'), 'utf8').then(parseSessionIndex, () => new Map<string, string>())
  ])
  const candidates = [...claude, ...codex, ...gemini].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_SCANNED)
  return { scope, names, candidates }
}

export interface SessionSource {
  session: ResumeSession
  path: string
}

/** Every known session of the chosen projects and agent, newest first, with the log file each one lives in. */
export async function listSessionSources(
  projects: Project[],
  query: Pick<ResumeQuery, 'projectId' | 'agent' | 'limit'> = {},
  homes: SessionHomes = defaultHomes()
): Promise<SessionSource[]> {
  const { candidates, names } = await gather(projects, query, homes)
  const limit = query.limit ?? MAX_SCANNED
  const out: SessionSource[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (out.length >= limit) break
    const session = await enrich(candidate, names)
    if (!session || seen.has(`${session.agent}:${session.id}`)) continue
    seen.add(`${session.agent}:${session.id}`)
    out.push({ session, path: candidate.path })
  }
  return out
}

export async function listAllSessions(
  projects: Project[],
  query: ResumeQuery = {},
  homes: SessionHomes = defaultHomes()
): Promise<ResumeSession[]> {
  const { scope, names, candidates } = await gather(projects, query, homes)
  const limit = query.limit ?? RESUME_LIMIT
  const names_ = new Map(scope.map((p) => [p.id, p.name]))
  const sessions: ResumeSession[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (sessions.length >= limit) break
    const session = await enrich(candidate, names)
    if (!session || seen.has(`${session.agent}:${session.id}`)) continue
    if (query.query) {
      const metadataMatch = matchesQuery(session, names_.get(session.projectId) ?? '', query.query)
      if (!metadataMatch && query.searchContent) {
        try {
          const excerpt = contentMatch(candidate.agent, (await sample(candidate.path, candidate.size)).text, query.query)
          if (excerpt) session.matchExcerpt = excerpt
        } catch { /* An unreadable transcript simply does not match. */ }
      }
      if (!metadataMatch && !session.matchExcerpt) continue
    }
    seen.add(`${session.agent}:${session.id}`)
    sessions.push(session)
  }
  return sessions
}
