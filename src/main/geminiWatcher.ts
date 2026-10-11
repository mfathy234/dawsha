import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { geminiHome } from './agentLaunch'
import {
  isGeminiChatFile,
  parseGeminiChat,
  parseLegacyGeminiChat,
  toGeminiSession,
  type GeminiChat
} from '../shared/geminiSession'
import { normalizePath } from '../shared/sessionMatch'
import type { GeminiSession } from '../shared/types'

const POLL_MS = 3000
const RECENT_MS = 3 * 24 * 60 * 60 * 1000
const WHOLE_BYTES = 512 * 1024
const EDGE_BYTES = 128 * 1024
const MARKER = '.project_root'

export interface GeminiChatFile {
  path: string
  slug: string
  modifiedAt: number
  size: number
}

const cache = new Map<string, { key: string; chat: GeminiChat | null }>()

async function readRange(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function dirNames(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

export async function listGeminiChatFiles(home: string = geminiHome()): Promise<GeminiChatFile[]> {
  const tmp = join(home, 'tmp')
  const slugs = await dirNames(tmp)
  const nested = await Promise.all(
    slugs.map(async (slug) => {
      const chats = join(tmp, slug, 'chats')
      const names = (await dirNames(chats)).filter(isGeminiChatFile)
      const files = await Promise.all(
        names.map(async (name): Promise<GeminiChatFile | null> => {
          try {
            const info = await stat(join(chats, name))
            return info.isFile() ? { path: join(chats, name), slug, modifiedAt: Math.round(info.mtimeMs), size: info.size } : null
          } catch {
            return null
          }
        })
      )
      return files.filter((f): f is GeminiChatFile => f !== null)
    })
  )
  return nested.flat()
}

export async function readGeminiChat(file: GeminiChatFile): Promise<GeminiChat | null> {
  const key = `${file.modifiedAt}:${file.size}`
  const known = cache.get(file.path)
  if (known?.key === key) return known.chat
  let chat: GeminiChat | null = null
  try {
    if (file.path.endsWith('.json')) {
      chat = file.size <= WHOLE_BYTES * 4 ? parseLegacyGeminiChat(await readFile(file.path, 'utf8')) : null
    } else if (file.size <= WHOLE_BYTES) {
      chat = parseGeminiChat(await readFile(file.path, 'utf8'))
    } else {
      const head = await readRange(file.path, 0, EDGE_BYTES)
      const tail = await readRange(file.path, file.size - EDGE_BYTES, EDGE_BYTES)
      chat = parseGeminiChat(`${head}\n${tail}`)
    }
  } catch {
    chat = null
  }
  cache.set(file.path, { key, chat })
  return chat
}

export async function readGeminiSessions(home: string = geminiHome()): Promise<GeminiSession[]> {
  const now = Date.now()
  const files = (await listGeminiChatFiles(home)).filter((f) => now - f.modifiedAt <= RECENT_MS)
  const chats = await Promise.all(
    files.map(async (file) => {
      const chat = await readGeminiChat(file)
      return chat ? toGeminiSession(chat, file.modifiedAt) : null
    })
  )
  return chats.filter((s): s is GeminiSession => s !== null)
}

export async function projectSlugs(folder: string, home: string = geminiHome()): Promise<string[]> {
  const tmp = join(home, 'tmp')
  const wanted = normalizePath(folder)
  const slugs = await dirNames(tmp)
  const owners = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const owner = (await readFile(join(tmp, slug, MARKER), 'utf8')).trim()
        return normalizePath(owner) === wanted ? slug : null
      } catch {
        return null
      }
    })
  )
  return owners.filter((s): s is string => s !== null)
}

export class GeminiWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''

  constructor(private readonly onChange: (sessions: GeminiSession[]) => void) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const sessions = await readGeminiSessions()
    const signature = JSON.stringify(sessions.map((s) => [s.sessionId, s.name, s.startedAt, s.updatedAt, s.model, s.recentTools]))
    if (signature === this.last) return
    this.last = signature
    this.onChange(sessions)
  }
}
