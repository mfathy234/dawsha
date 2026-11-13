import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionFile } from '../shared/types'
import { claudeProjectSlug, sessionTitleInfo } from '../shared/projectSessions'
import { claudeProjectsDir } from './paths'

const POLL_MS = 3000

export const sessionsDir = (): string =>
  process.env.DAWSHA_SESSIONS_DIR ?? join(process.env.USERPROFILE ?? homedir(), '.claude', 'sessions')

type Liveness = 'alive' | 'denied' | 'dead'

const liveness = (pid: number): Liveness => {
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? 'denied' : 'dead'
  }
}

function parseSession(text: string): SessionFile | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.pid !== 'number' || typeof raw.cwd !== 'string') return null
    return {
      pid: raw.pid,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : String(raw.pid),
      cwd: raw.cwd,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : undefined,
      status: typeof raw.status === 'string' ? raw.status : undefined,
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
      procStart: typeof raw.procStart === 'number' || typeof raw.procStart === 'string' ? raw.procStart : undefined
    }
  } catch {
    return null
  }
}

type TitleInfo = ReturnType<typeof sessionTitleInfo>
type TranscriptEnds = { head: string; tail: string }
type TranscriptStat = { size: number; mtimeMs: number }
interface TitleEntry { size: number; mtimeMs: number; info: TitleInfo }

const titleCache = new Map<string, TitleEntry>()
const HEAD_BYTES = 96 * 1024
const TAIL_BYTES = 48 * 1024

async function readTranscriptEnds(path: string, info: TranscriptStat): Promise<TranscriptEnds> {
  const handle = await open(path, 'r')
  try {
    const headBuffer = Buffer.alloc(Math.min(info.size, HEAD_BYTES))
    const headRead = await handle.read(headBuffer, 0, headBuffer.length, 0)
    const head = headBuffer.subarray(0, headRead.bytesRead).toString('utf8')
    let tail = ''
    if (info.size > HEAD_BYTES) {
      const tailBuffer = Buffer.alloc(Math.min(info.size, TAIL_BYTES))
      const tailRead = await handle.read(tailBuffer, 0, tailBuffer.length, Math.max(0, info.size - tailBuffer.length))
      tail = tailBuffer.subarray(0, tailRead.bytesRead).toString('utf8')
    }
    return { head, tail }
  } finally {
    await handle.close()
  }
}

/**
 * Title info for a transcript, parsed again only when the file changed. A user-named session only needs the first
 * prompt, which never changes once written, so a cached entry is reused without touching the file at all.
 */
export async function cachedTitleInfo(
  path: string,
  named: boolean,
  read: (path: string, info: TranscriptStat) => Promise<TranscriptEnds>,
  stats: (path: string) => Promise<TranscriptStat> = stat
): Promise<TitleInfo> {
  const cached = titleCache.get(path)
  if (named && cached?.info.firstPrompt) return cached.info
  const info = await stats(path)
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.info
  const { head, tail } = await read(path, info)
  const parsed = sessionTitleInfo(head, tail)
  titleCache.set(path, { size: info.size, mtimeMs: info.mtimeMs, info: parsed })
  return parsed
}

export const clearTitleCache = (): void => titleCache.clear()

function pruneTitleCache(live: Set<string>): void {
  for (const path of titleCache.keys()) if (!live.has(path)) titleCache.delete(path)
}

export async function readSessions(dir: string = sessionsDir()): Promise<SessionFile[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const sessions = await Promise.all(
    names.map(async (name) => {
      try {
        return parseSession(await readFile(join(dir, name), 'utf8'))
      } catch {
        return null
      }
    })
  )
  const found: SessionFile[] = []
  for (const session of sessions) {
    if (!session) continue
    const state = liveness(session.pid)
    if (state === 'alive') found.push(session)
    else if (state === 'denied') found.push({ ...session, permissionDenied: true })
  }
  const paths = new Set(found.map((session) => join(claudeProjectsDir(), claudeProjectSlug(session.cwd), `${session.sessionId}.jsonl`)))
  pruneTitleCache(paths)
  return Promise.all(found.map(async (session) => {
    const transcript = join(claudeProjectsDir(), claudeProjectSlug(session.cwd), `${session.sessionId}.jsonl`)
    try {
      const named = Boolean(session.name?.trim() && session.nameSource !== 'derived')
      const titleInfo = await cachedTitleInfo(transcript, named, readTranscriptEnds)
      // The session file's explicit name wins; transcript metadata still supplies its full first message.
      return { ...session, ...(!named ? titleInfo : { firstPrompt: titleInfo.firstPrompt }) }
    } catch {
      return session
    }
  }))
}

export class SessionsWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''

  constructor(private readonly onChange: (sessions: SessionFile[]) => void) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const sessions = await readSessions()
    const signature = JSON.stringify(sessions)
    if (signature === this.last) return
    this.last = signature
    this.onChange(sessions)
  }
}
