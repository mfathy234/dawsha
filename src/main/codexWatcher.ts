import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { codexHome } from './agentLaunch'
import {
  codexInfoFromTail,
  codexStatusFromTail,
  parseRolloutMeta,
  parseSessionIndex,
  rolloutIdFromName,
  type RolloutMeta
} from '../shared/codexSession'
import type { CodexSession } from '../shared/types'

const POLL_MS = 3000
const RECENT_MS = 3 * 24 * 60 * 60 * 1000
const META_BYTES = 512 * 1024
const TAIL_BYTES = 256 * 1024

const metaCache = new Map<string, RolloutMeta | null>()

export async function readRange(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readMeta(path: string, size: number): Promise<RolloutMeta | null> {
  if (metaCache.has(path)) return metaCache.get(path) ?? null
  const head = await readRange(path, 0, Math.min(size, META_BYTES))
  const newline = head.indexOf('\n')
  const complete = newline >= 0 || size > META_BYTES
  const meta = newline < 0 && complete ? null : parseRolloutMeta(newline < 0 ? head : head.slice(0, newline))
  if (meta || complete) metaCache.set(path, meta)
  return meta
}

export async function listRollouts(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory() && depth < 3) await walk(path, depth + 1)
      else if (entry.isFile() && rolloutIdFromName(entry.name)) files.push(path)
    }
  }
  await walk(root, 0)
  return files
}

async function readNames(home: string): Promise<Map<string, string>> {
  try {
    return parseSessionIndex(await readFile(join(home, 'session_index.jsonl'), 'utf8'))
  } catch {
    return new Map()
  }
}

async function readOne(path: string, names: Map<string, string>, now: number): Promise<CodexSession | null> {
  try {
    const info = await stat(path)
    if (now - info.mtimeMs > RECENT_MS) return null
    const meta = await readMeta(path, info.size)
    if (!meta) return null
    const tail = await readRange(path, Math.max(0, info.size - TAIL_BYTES), TAIL_BYTES)
    return {
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      name: names.get(meta.sessionId),
      startedAt: meta.startedAt,
      updatedAt: Math.round(info.mtimeMs),
      status: codexStatusFromTail(tail, info.mtimeMs, now),
      ...codexInfoFromTail(tail)
    }
  } catch {
    return null
  }
}

export async function readCodexSessions(home: string = codexHome()): Promise<CodexSession[]> {
  const [files, names] = await Promise.all([listRollouts(join(home, 'sessions')), readNames(home)])
  const now = Date.now()
  const sessions = await Promise.all(files.map((file) => readOne(file, names, now)))
  return sessions.filter((s): s is CodexSession => s !== null)
}

export class CodexWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''

  constructor(private readonly onChange: (sessions: CodexSession[]) => void) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const sessions = await readCodexSessions()
    const signature = JSON.stringify(sessions.map((s) => [s.sessionId, s.cwd, s.name, s.status, s.startedAt, s.model, s.contextPercent, s.updatedAt]))
    if (signature === this.last) return
    this.last = signature
    this.onChange(sessions)
  }
}
