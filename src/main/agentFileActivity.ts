import { relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { AgentEditEvent, AgentFileTouch, LineSessionsResult } from '../shared/codeNavExtras'
import type { TimelineEvent } from '../shared/timeline'
import { normalizeFolder } from '../shared/folderKey'
import { addedLines } from '../shared/diffView'
import { asAddedDiff, git, repoRoot } from './gitCommit'
import { mergeBase, readProjectFile, resolveProjectFile } from './gitWorkspace'
import { validRelative } from './codeNav/editPreviews'

export interface SessionEvidence { sessionId: string; agent: AgentFileTouch['agent']; events: TimelineEvent[]; truncated?: boolean }
interface Seen { keys: Set<string>; since: number }
const eventKey = (session: SessionEvidence, event: TimelineEvent): string => `${session.agent}:${session.sessionId}:${event.at}:${event.path}:${event.text}`

export class AgentFileActivity {
  private readonly seen = new Map<string, Seen>()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly generations = new Map<string, symbol>()
  private readonly rerun = new Set<string>()

  constructor(private readonly load: (folder: string) => Promise<SessionEvidence[]>, private readonly emit: (event: AgentEditEvent) => void) {}

  private async path(folder: string, raw: string): Promise<string | null> {
    if (!raw || raw.includes('\0')) return null
    const root = await realpath(await repoRoot(folder) ?? folder)
    const path = relative(root, resolve(folder, raw.replace(/\\/g, '/'))).replace(/\\/g, '/')
    if (!validRelative(path)) return null
    const target = await resolveProjectFile(folder, path)
    return target.ok ? target.realRel : null
  }

  async lineSessions(folder: string, raw: unknown): Promise<LineSessionsResult> {
    if (!validRelative(raw)) return { ok: false, error: 'Invalid file path.' }
    const target = await resolveProjectFile(folder, raw)
    if (!target.ok) return { ok: false, error: target.error }
    const read = await readProjectFile(folder, raw)
    if (!read.ok || read.text === null) return { ok: false, error: 'Cannot read this file as text.' }
    const root = await repoRoot(folder)
    const base = root ? await mergeBase(root) : null
    const diff = root && base ? await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', base, '--', raw]) : null
    const hasBase = root && base ? await git(root, ['cat-file', '-e', `${base}:${target.realRel}`]) : null
    const changed = diff?.ok && diff.stdout ? addedLines(diff.stdout) : hasBase?.ok ? new Set<number>() : addedLines(asAddedDiff(raw, read.text))
    let latest: AgentFileTouch | undefined
    for (const session of await this.load(folder)) {
      for (const event of session.events) {
        const at = event.editCompletedAt ?? event.at
        if (event.kind !== 'edit' || event.editStatus !== 'succeeded' || !event.path || (latest && at <= latest.at)) continue
        if (await this.path(folder, event.path) === target.realRel) latest = { sessionId: session.sessionId, agent: session.agent, at, precision: 'file' }
      }
    }
    return { ok: true, precision: latest ? 'file' : 'unknown', lines: [...changed].sort((a, b) => a - b).map(line => ({ line, ...(latest ? { session: latest } : {}) })), note: latest ? 'Last recorded edit to this file among recent sessions; line ownership is unavailable.' : 'No recorded agent edit was found among recent sessions; line ownership is unknown.' }
  }

  refresh(folder: string): Promise<void> {
    const key = normalizeFolder(folder)
    const active = this.locks.get(key)
    if (active) { this.rerun.add(key); return active }
    const generation = this.generations.get(key) ?? Symbol()
    this.generations.set(key, generation)
    const next = Promise.resolve().then(async () => {
      do {
        this.rerun.delete(key)
        await this.update(folder, key, generation)
      } while (this.rerun.has(key) && this.generations.get(key) === generation)
    }).catch(() => undefined)
    this.locks.set(key, next)
    void next.then(() => { if (this.locks.get(key) === next) this.locks.delete(key) })
    return next
  }

  private async update(folder: string, key: string, generation: symbol): Promise<void> {
    const previous = this.seen.get(key)
    const since = previous?.since ?? Date.now()
    const sessions = await this.load(folder)
    if (this.generations.get(key) !== generation) return
    const keys = new Set<string>(previous?.keys)
    for (const session of sessions) {
      for (const event of session.events) {
        if (event.kind !== 'edit' || event.editStatus !== 'succeeded' || !event.path) continue
        const id = eventKey(session, event)
        keys.add(id)
        const at = event.editCompletedAt ?? event.at
        if (!previous || previous.keys.has(id) || at < since) continue
        const path = await this.path(folder, event.path)
        if (this.generations.get(key) !== generation) return
        if (path) this.emit({ folder: key, path, sessionId: session.sessionId, agent: session.agent, at, precision: 'file' })
      }
    }
    this.seen.set(key, { keys: new Set([...keys].slice(-20_000)), since })
  }

  forget(folder: string): void {
    const key = normalizeFolder(folder)
    this.generations.delete(key)
    this.rerun.delete(key)
    this.locks.delete(key)
    this.seen.delete(key)
  }
}
