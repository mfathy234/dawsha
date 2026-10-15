import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DAY_MS,
  MAX_READ_BYTES,
  isRecordingId,
  selectRetention,
  type RecordingMeta,
  type RecordingSettings,
  type RecordingStats,
  type RecordingSummary,
  type RetentionEntry
} from '../shared/recordings'
import type { Recorder } from './recorder'

export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const DATE_FOLDER = /^\d{4}-\d{2}-\d{2}$/

interface StoredRecording {
  meta: RecordingMeta
  castBytes: number
  totalBytes: number
  updatedAt: number
}

function readMeta(text: string, id: string): RecordingMeta | null {
  try {
    const raw = JSON.parse(text) as Partial<RecordingMeta>
    if (typeof raw.terminalId !== 'string' || typeof raw.startedAt !== 'number') return null
    return {
      id,
      terminalId: raw.terminalId,
      projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
      projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
      agent: raw.agent === 'claude' || raw.agent === 'codex' || raw.agent === 'gemini' ? raw.agent : 'shell',
      title: typeof raw.title === 'string' ? raw.title : '',
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
      startedAt: raw.startedAt,
      endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : null,
      exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
      endReason: raw.endReason === 'size-limit' ? 'size-limit' : null,
      cols: typeof raw.cols === 'number' ? raw.cols : 80,
      rows: typeof raw.rows === 'number' ? raw.rows : 24
    }
  } catch {
    return null
  }
}

async function sizeOf(path: string): Promise<{ bytes: number; mtime: number } | null> {
  try {
    const info = await stat(path)
    return { bytes: info.size, mtime: info.mtimeMs }
  } catch {
    return null
  }
}

export class RecordingService {
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly root: string,
    private readonly recorder: Recorder,
    private readonly settings: () => RecordingSettings,
    private readonly now: () => number = () => Date.now()
  ) {}

  async scan(): Promise<StoredRecording[]> {
    const found: StoredRecording[] = []
    let days: string[] = []
    try {
      days = (await readdir(this.root)).filter((name) => DATE_FOLDER.test(name))
    } catch {
      return found
    }
    for (const day of days) {
      let names: string[] = []
      try {
        names = await readdir(join(this.root, day))
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const id = `${day}/${name.slice(0, -5)}`
        if (!isRecordingId(id)) continue
        const entry = await this.load(id)
        if (entry) found.push(entry)
      }
    }
    return found
  }

  private async load(id: string): Promise<StoredRecording | null> {
    const base = join(this.root, id)
    let meta: RecordingMeta | null = null
    try {
      meta = readMeta(await readFile(`${base}.json`, 'utf8'), id)
    } catch {
      return null
    }
    const cast = await sizeOf(`${base}.cast`)
    const side = await sizeOf(`${base}.json`)
    if (!meta || !cast || !side) return null
    return { meta, castBytes: cast.bytes, totalBytes: cast.bytes + side.bytes, updatedAt: Math.max(cast.mtime, side.mtime) }
  }

  async list(): Promise<RecordingSummary[]> {
    await this.recorder.flush()
    const live = this.recorder.activeIds()
    const stored = await this.scan()
    return stored
      .map((entry) => ({ ...entry.meta, bytes: entry.castBytes, live: live.has(entry.meta.id) }))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  async stats(): Promise<RecordingStats> {
    const stored = await this.scan()
    return { count: stored.length, bytes: stored.reduce((sum, entry) => sum + entry.totalBytes, 0) }
  }

  async read(id: unknown): Promise<string> {
    if (!isRecordingId(id)) throw new Error('Unknown recording.')
    await this.recorder.flush()
    const path = join(this.root, `${id}.cast`)
    const info = await sizeOf(path)
    if (!info) throw new Error('This recording is no longer available.')
    if (info.bytes > MAX_READ_BYTES) throw new Error('This recording is too large to replay.')
    return readFile(path, 'utf8')
  }

  setPaused(terminalId: string, paused: boolean | null): boolean | null {
    return paused === null ? this.recorder.isPaused(terminalId) : this.recorder.setPaused(terminalId, paused)
  }

  setTitle(terminalId: string, title: string): void {
    this.recorder.setTitle(terminalId, title)
  }

  async remove(ids: string[]): Promise<number> {
    let removed = 0
    for (const id of ids) {
      if (!isRecordingId(id)) continue
      try {
        await rm(join(this.root, `${id}.cast`), { force: true })
        await rm(join(this.root, `${id}.json`), { force: true })
        removed += 1
      } catch {
        continue
      }
    }
    await this.pruneEmptyFolders()
    return removed
  }

  async deleteAll(): Promise<number> {
    await this.recorder.flush()
    const live = this.recorder.activeIds()
    const ids = (await this.scan()).map((entry) => entry.meta.id).filter((id) => !live.has(id))
    return this.remove(ids)
  }

  async cleanup(): Promise<string[]> {
    const scanStart = this.now()
    const stored = (await this.scan()).filter((entry) => entry.meta.startedAt <= scanStart)
    await this.finishOrphans(stored)
    await this.removeOrphanCasts()
    const entries: RetentionEntry[] = stored.map((entry) => ({ id: entry.meta.id, bytes: entry.totalBytes, updatedAt: entry.updatedAt }))
    const { keepDays, maxMegabytes } = this.settings()
    const selected = selectRetention(entries, {
      now: scanStart,
      keepDays,
      maxBytes: maxMegabytes * 1024 * 1024,
      protectedIds: this.recorder.activeIds()
    })
    const live = this.recorder.activeIds()
    const doomed = selected.filter((id) => !live.has(id))
    await this.remove(doomed)
    return doomed
  }

  private async finishOrphans(stored: StoredRecording[]): Promise<void> {
    for (const entry of stored) {
      if (entry.meta.endedAt !== null || this.recorder.activeIds().has(entry.meta.id)) continue
      const meta = { ...entry.meta, endedAt: Math.max(entry.meta.startedAt, Math.round(entry.updatedAt)) }
      try {
        await writeFile(join(this.root, `${meta.id}.json`), JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 })
      } catch {
        continue
      }
    }
  }

  private async removeOrphanCasts(): Promise<void> {
    const cutoff = this.now() - this.settings().keepDays * DAY_MS
    let days: string[] = []
    try {
      days = (await readdir(this.root)).filter((name) => DATE_FOLDER.test(name))
    } catch {
      return
    }
    for (const day of days) {
      let names: string[] = []
      try {
        names = await readdir(join(this.root, day))
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.cast') || names.includes(`${name.slice(0, -5)}.json`)) continue
        const info = await sizeOf(join(this.root, day, name))
        if (info && info.mtime < cutoff) await rm(join(this.root, day, name), { force: true }).catch(() => undefined)
      }
    }
    await this.pruneEmptyFolders()
  }

  private async pruneEmptyFolders(): Promise<void> {
    let days: string[] = []
    try {
      days = (await readdir(this.root)).filter((name) => DATE_FOLDER.test(name))
    } catch {
      return
    }
    for (const day of days) {
      try {
        if ((await readdir(join(this.root, day))).length === 0) await rmdir(join(this.root, day))
      } catch {
        continue
      }
    }
  }

  async ensureRoot(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    return this.root
  }

  startSchedule(): void {
    void this.cleanup().catch(() => undefined)
    this.timer = setInterval(() => void this.cleanup().catch(() => undefined), CLEANUP_INTERVAL_MS)
    this.timer.unref()
  }

  stopSchedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
