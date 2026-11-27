import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { defaultSettings, migrateSettings } from '../shared/settingsSchema'
import type { Settings, SettingsLoadResult } from '../shared/types'

const RENAME_TRIES = 3
const RENAME_WAIT_MS = 50

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      if (attempt >= RENAME_TRIES) throw error
      pause(RENAME_WAIT_MS)
    }
  }
}

function withoutShippedLineLimit(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const data = raw as Record<string, unknown>
  const wroteByDefault = data.lastSeenVersion === '1.10.0' || data.lastSeenVersion === '1.10.1'
  return wroteByDefault && data.limitLineLength === true ? { ...data, limitLineLength: false } : data
}

// 1.10.0 to 1.10.3 saved the catch-up card as on without anyone choosing it; it now only shows when turned on.
const SHIPPED_CATCH_UP = new Set(['1.10.0', '1.10.1', '1.10.2', '1.10.3'])

function withoutShippedCatchUp(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const data = raw as Record<string, unknown>
  return SHIPPED_CATCH_UP.has(String(data.lastSeenVersion)) && data.catchUp === true ? { ...data, catchUp: false } : data
}

export class SettingsStore {
  private settings: Settings = defaultSettings()
  private warning: string | null = null

  constructor(private readonly filePath: string) {}

  load(): SettingsLoadResult {
    try {
      const text = readFileSync(this.filePath, 'utf8')
      this.settings = migrateSettings(withoutShippedCatchUp(withoutShippedLineLimit(JSON.parse(text))))
    } catch (error) {
      this.settings = defaultSettings()
      this.warning = this.handleLoadError(error)
    }
    return { settings: this.settings, warning: this.warning }
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = migrateSettings({ ...this.settings, ...patch })
    this.save()
    return this.settings
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(this.settings, null, 2), 'utf8')
      renameWithRetry(temp, this.filePath)
    } catch (error) {
      rmSync(temp, { force: true })
      throw new Error(`Could not save settings: ${(error as Error).message}`)
    }
  }

  private handleLoadError(error: unknown): string | null {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    const backup = `${this.filePath}.corrupt-${Date.now()}`
    try {
      renameSync(this.filePath, backup)
      return `Settings could not be read and were reset. The old file was kept as ${backup}.`
    } catch {
      return 'Settings could not be read and were reset.'
    }
  }
}
