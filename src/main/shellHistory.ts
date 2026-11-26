import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validHistoryCommand, type ShellHistoryEntry } from '../shared/shellCommands'

/** Local command history, keyed by project id so every checkout shares one list. */
export class ShellHistory {
  private entries: Record<string, ShellHistoryEntry[]> = Object.create(null)
  private readonly path: string

  constructor(private readonly folder: string) {
    this.path = join(folder, 'shell-history.json')
    if (!existsSync(this.path)) return
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
      for (const [project, values] of Object.entries(raw)) {
        if (!Array.isArray(values)) continue
        this.entries[project] = values.filter((entry): entry is ShellHistoryEntry =>
          entry && validHistoryCommand(entry.command) && typeof entry.cwd === 'string' && Number.isFinite(entry.at)).slice(0, 500)
      }
    } catch { /* A damaged history must not prevent a shell from starting. */ }
  }

  list(projectId: string): ShellHistoryEntry[] { return [...(this.entries[projectId] ?? [])] }

  add(projectId: string, command: string, cwd: string, at = Date.now()): void {
    if (!validHistoryCommand(command)) return
    this.entries = Object.assign(Object.create(null), this.entries, {
      [projectId]: [{ command, cwd, at }, ...(this.entries[projectId] ?? [])].slice(0, 500)
    })
    mkdirSync(this.folder, { recursive: true })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.entries), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
  }
}
