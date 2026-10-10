import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionFile } from '../shared/types'

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
  return found
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
