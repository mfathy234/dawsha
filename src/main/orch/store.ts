import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { OrchAgent, OrchDecision, OrchEvent, OrchMessage, OrchNote, OrchRun, OrchTask, TaskStatus } from '../../shared/orch/types'

// Each row keeps the whole object as JSON in `data`; the other columns exist only to filter and sort.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, num INTEGER NOT NULL, status TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_run ON tasks (run_id, status);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, to_agent TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_to ON messages (to_agent, read_at);
CREATE INDEX IF NOT EXISTS messages_run ON messages (run_id);
CREATE TABLE IF NOT EXISTS notes (run_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, key));
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, open INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_run ON events (run_id);
`
/** Bump with a migration step in the constructor when the tables change. */
const SCHEMA_VERSION = 1

type Row = { data: string }
const parse = <T>(row: unknown): T | undefined => (row ? (JSON.parse((row as Row).data) as T) : undefined)
const parseAll = <T>(rows: unknown[]): T[] => rows.map((row) => JSON.parse((row as Row).data) as T)
const taskNumber = (key: string): number => Number(key.replace(/^\D+/, '')) || 0

export interface TaskFilter {
  runId?: string
  status?: TaskStatus
}

export class OrchStore {
  private readonly db: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()
  private depth = 0

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  close(): void {
    this.db.close()
  }

  /** Runs fn atomically: every write inside lands, or none does. Nested calls join the outer one. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1
      try { return fn() } finally { this.depth -= 1 }
    }
    this.db.exec('BEGIN IMMEDIATE')
    this.depth = 1
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.depth = 0
    }
  }

  private sql(text: string): StatementSync {
    let statement = this.cache.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.cache.set(text, statement)
    }
    return statement
  }

  putRun(run: OrchRun): void {
    this.sql('INSERT OR REPLACE INTO runs (id, created_at, data) VALUES (?, ?, ?)').run(run.id, run.createdAt, JSON.stringify(run))
  }

  getRun(id: string): OrchRun | undefined {
    return parse<OrchRun>(this.sql('SELECT data FROM runs WHERE id = ?').get(id))
  }

  listRuns(): OrchRun[] {
    return parseAll<OrchRun>(this.sql('SELECT data FROM runs ORDER BY created_at DESC').all())
  }

  putTask(task: OrchTask): void {
    this.sql('INSERT OR REPLACE INTO tasks (id, run_id, num, status, role, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(task.id, task.runId, taskNumber(task.key), task.status, task.role, task.createdAt, JSON.stringify(task))
  }

  getTask(id: string): OrchTask | undefined {
    return parse<OrchTask>(this.sql('SELECT data FROM tasks WHERE id = ?').get(id))
  }

  listTasks(filter: TaskFilter = {}): OrchTask[] {
    const where: string[] = []
    const args: string[] = []
    if (filter.runId) { where.push('run_id = ?'); args.push(filter.runId) }
    if (filter.status) { where.push('status = ?'); args.push(filter.status) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return parseAll<OrchTask>(this.sql(`SELECT data FROM tasks ${clause} ORDER BY created_at, num`).all(...args))
  }

  nextTaskNumber(runId: string): number {
    const row = this.sql('SELECT COUNT(*) AS n FROM tasks WHERE run_id = ?').get(runId) as { n: number }
    return Number(row.n) + 1
  }

  putAgent(agent: OrchAgent): void {
    this.sql('INSERT OR REPLACE INTO agents (id, run_id, token, data) VALUES (?, ?, ?, ?)').run(agent.id, agent.runId, agent.token, JSON.stringify(agent))
  }

  getAgent(id: string): OrchAgent | undefined {
    return parse<OrchAgent>(this.sql('SELECT data FROM agents WHERE id = ?').get(id))
  }

  agentByToken(token: string): OrchAgent | undefined {
    return parse<OrchAgent>(this.sql('SELECT data FROM agents WHERE token = ?').get(token))
  }

  listAgents(runId: string): OrchAgent[] {
    return parseAll<OrchAgent>(this.sql('SELECT data FROM agents WHERE run_id = ? ORDER BY id').all(runId))
  }

  putMessage(message: OrchMessage): void {
    this.sql('INSERT OR REPLACE INTO messages (id, run_id, to_agent, read_at, created_at, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.runId, message.to, message.readAt, message.createdAt, JSON.stringify(message))
  }

  unreadFor(agentId: string): OrchMessage[] {
    return parseAll<OrchMessage>(this.sql('SELECT data FROM messages WHERE to_agent = ? AND read_at IS NULL ORDER BY created_at, id').all(agentId))
  }

  listMessages(runId: string): OrchMessage[] {
    return parseAll<OrchMessage>(this.sql('SELECT data FROM messages WHERE run_id = ? ORDER BY created_at, id').all(runId))
  }

  putNote(note: OrchNote): void {
    this.sql('INSERT OR REPLACE INTO notes (run_id, key, data) VALUES (?, ?, ?)').run(note.runId, note.key, JSON.stringify(note))
  }

  listNotes(runId: string): OrchNote[] {
    return parseAll<OrchNote>(this.sql('SELECT data FROM notes WHERE run_id = ? ORDER BY key').all(runId))
  }

  putDecision(decision: OrchDecision): void {
    this.sql('INSERT OR REPLACE INTO decisions (id, run_id, open, created_at, data) VALUES (?, ?, ?, ?, ?)')
      .run(decision.id, decision.runId, decision.answer === null ? 1 : 0, decision.createdAt, JSON.stringify(decision))
  }

  getDecision(id: string): OrchDecision | undefined {
    return parse<OrchDecision>(this.sql('SELECT data FROM decisions WHERE id = ?').get(id))
  }

  openDecisions(): OrchDecision[] {
    return parseAll<OrchDecision>(this.sql('SELECT data FROM decisions WHERE open = 1 ORDER BY created_at, id').all())
  }

  addEvent(event: OrchEvent): void {
    this.sql('INSERT INTO events (run_id, data) VALUES (?, ?)').run(event.runId, JSON.stringify(event))
  }

  listEvents(runId: string): OrchEvent[] {
    return parseAll<OrchEvent>(this.sql('SELECT data FROM events WHERE run_id = ? ORDER BY seq').all(runId))
  }
}
