import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { castEventLine, castHeaderLine, resizeData, type CastKind, type CastMarkerKind } from '../shared/cast'
import { MAX_RECORDING_BYTES, recordingId, type RecordingMeta } from '../shared/recordings'
import type { TabAgent } from '../shared/types'

export const FLUSH_INTERVAL_MS = 250
export const FLUSH_BYTES = 64 * 1024
export const COALESCE_MS = 20
const DIR_MODE = 0o700
const FILE_MODE = 0o600
const PROMPT_MARKER_GAP_MS = 1000

export interface RecordingStart {
  projectId: string | null
  projectName: string
  agent: TabAgent
  title: string
  cwd: string
}

export interface RecorderOptions {
  root: string
  enabled(): boolean
  clock?(): number
  wallClock?(): number
  flushMs?: number
  flushBytes?: number
  onError?(error: Error): void
}

interface Session {
  meta: RecordingMeta
  castPath: string
  metaPath: string
  baseMs: number
  chain: Promise<void>
  lines: string[]
  pendingBytes: number
  written: number
  output: string
  outputAt: number
  timer: NodeJS.Timeout | null
  lastPromptMs: number
  closed: boolean
  paused: boolean
  truncated: boolean
}

export class Recorder {
  private readonly sessions = new Map<string, Session>()
  private readonly clock: () => number
  private readonly wallClock: () => number
  private readonly flushMs: number
  private readonly flushBytes: number

  constructor(private readonly options: RecorderOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.wallClock = options.wallClock ?? (() => Date.now())
    this.flushMs = options.flushMs ?? FLUSH_INTERVAL_MS
    this.flushBytes = options.flushBytes ?? FLUSH_BYTES
  }

  activeIds(): Set<string> {
    return new Set([...this.sessions.values()].map((session) => session.meta.id))
  }

  start(terminalId: string, info: RecordingStart, size: { cols: number; rows: number }): string | null {
    this.stop(terminalId)
    if (!this.options.enabled()) return null
    const startedAt = this.wallClock()
    const id = recordingId(terminalId, startedAt)
    const meta: RecordingMeta = {
      id,
      terminalId,
      projectId: info.projectId,
      projectName: info.projectName,
      agent: info.agent,
      title: info.title,
      cwd: info.cwd,
      startedAt,
      endedAt: null,
      exitCode: null,
      endReason: null,
      cols: size.cols,
      rows: size.rows
    }
    const castPath = join(this.options.root, `${id}.cast`)
    const session: Session = {
      meta,
      castPath,
      metaPath: join(this.options.root, `${id}.json`),
      baseMs: this.clock(),
      chain: Promise.resolve(),
      lines: [],
      pendingBytes: 0,
      written: 0,
      output: '',
      outputAt: 0,
      timer: null,
      lastPromptMs: -Infinity,
      closed: false,
      paused: false,
      truncated: false
    }
    this.sessions.set(terminalId, session)
    const header = castHeaderLine({
      version: 2,
      width: size.cols,
      height: size.rows,
      timestamp: Math.floor(startedAt / 1000),
      title: info.title,
      env: { TERM: 'xterm-256color' }
    })
    this.enqueue(session, async () => {
      await mkdir(this.options.root, { recursive: true, mode: DIR_MODE })
      await mkdir(dirname(castPath), { recursive: true, mode: DIR_MODE })
      await writeFile(castPath, header, { encoding: 'utf8', mode: FILE_MODE })
      await writeFile(session.metaPath, JSON.stringify(session.meta), { encoding: 'utf8', mode: FILE_MODE })
    })
    session.written += Buffer.byteLength(header)
    return id
  }

  output(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId)
    if (!session || data === '' || session.paused) return
    if (!this.options.enabled()) {
      this.stop(terminalId)
      return
    }
    const now = this.elapsedMs(session)
    if (session.output !== '' && now - session.outputAt < COALESCE_MS) {
      session.output += data
      session.pendingBytes += data.length
    } else {
      this.commitOutput(session)
      session.output = data
      session.outputAt = now
      session.pendingBytes += data.length
    }
    this.afterAppend(session)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    this.append(session, 'r', resizeData(cols, rows))
  }

  input(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId)
    if (!session || session.paused || session.meta.agent === 'shell' || !data.includes('\r')) return
    const now = this.elapsedMs(session)
    if (now - session.lastPromptMs < PROMPT_MARKER_GAP_MS) return
    session.lastPromptMs = now
    this.marker(terminalId, 'prompt')
  }

  marker(terminalId: string, kind: CastMarkerKind): void {
    const session = this.sessions.get(terminalId)
    if (session) this.append(session, 'm', kind)
  }

  setPaused(terminalId: string, paused: boolean): boolean | null {
    const session = this.sessions.get(terminalId)
    if (!session) return null
    if (session.paused === paused) return paused
    if (paused) {
      this.append(session, 'm', 'paused')
      session.paused = true
    } else {
      session.paused = false
      this.append(session, 'm', 'resumed')
    }
    return paused
  }

  isPaused(terminalId: string): boolean | null {
    return this.sessions.get(terminalId)?.paused ?? null
  }

  setTitle(terminalId: string, title: string): void {
    const session = this.sessions.get(terminalId)
    if (!session || title.trim() === '') return
    session.meta = { ...session.meta, title: title.trim().slice(0, 200) }
    this.writeMeta(session)
  }

  stop(terminalId: string, exitCode: number | null = null): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    this.sessions.delete(terminalId)
    if (exitCode !== null) this.append(session, 'm', 'exit')
    this.commitOutput(session)
    session.closed = true
    if (session.timer) clearTimeout(session.timer)
    session.timer = null
    session.meta = { ...session.meta, endedAt: this.wallClock(), exitCode }
    this.drain(session)
    this.writeMeta(session)
  }

  async closeAll(): Promise<void> {
    const open = [...this.sessions.keys()]
    for (const id of open) this.stop(id)
    await this.settle()
  }

  async flush(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.commitOutput(session)
      this.drain(session)
    }
    await this.settle()
  }

  settle(): Promise<void> {
    return Promise.all([...this.pending]).then(() => undefined)
  }

  private readonly pending = new Set<Promise<void>>()

  private elapsedMs(session: Session): number {
    return Math.max(0, this.clock() - session.baseMs)
  }

  private append(session: Session, kind: CastKind, data: string): void {
    this.commitOutput(session)
    const line = castEventLine(this.elapsedMs(session) / 1000, kind, data)
    session.lines.push(line)
    session.pendingBytes += line.length
    this.afterAppend(session)
  }

  private commitOutput(session: Session): void {
    if (session.output === '') return
    const line = castEventLine(session.outputAt / 1000, 'o', session.output)
    session.output = ''
    session.lines.push(line)
  }

  private afterAppend(session: Session): void {
    if (session.pendingBytes >= this.flushBytes) {
      this.commitOutput(session)
      this.drain(session)
      return
    }
    if (session.timer || session.closed) return
    session.timer = setTimeout(() => {
      session.timer = null
      this.commitOutput(session)
      this.drain(session)
    }, this.flushMs)
    session.timer.unref()
  }

  private drain(session: Session): void {
    if (session.lines.length === 0) return
    const text = session.lines.join('')
    session.lines = []
    session.pendingBytes = session.output.length
    const bytes = Buffer.byteLength(text)
    if (session.written + bytes > MAX_RECORDING_BYTES) {
      this.truncate(session)
      return
    }
    session.written += bytes
    this.enqueue(session, () => appendFile(session.castPath, text, { encoding: 'utf8', mode: FILE_MODE }))
  }

  private truncate(session: Session): void {
    if (session.truncated) return
    session.truncated = true
    session.lines = []
    session.output = ''
    session.pendingBytes = 0
    session.meta = { ...session.meta, endReason: 'size-limit' }
    const marker = castEventLine(this.elapsedMs(session) / 1000, 'm', 'truncated')
    this.enqueue(session, () => appendFile(session.castPath, marker, { encoding: 'utf8', mode: FILE_MODE }))
    if (this.sessions.get(session.meta.terminalId) === session) this.stop(session.meta.terminalId)
  }

  private writeMeta(session: Session): void {
    const body = JSON.stringify(session.meta)
    this.enqueue(session, () => writeFile(session.metaPath, body, { encoding: 'utf8', mode: FILE_MODE }))
  }

  private enqueue(session: Session, work: () => Promise<void>): void {
    const next = session.chain.then(work).catch((error: unknown) => {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
    })
    session.chain = next
    this.pending.add(next)
    void next.finally(() => this.pending.delete(next))
  }
}
