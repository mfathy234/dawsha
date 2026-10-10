import { randomUUID } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrateSettings } from '../shared/settingsSchema'
import type { Settings } from '../shared/types'
import type { PaneonImportPreview } from '../shared/paneonImport'
import { SettingsStore } from './settingsStore'

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024
const PENDING_FILE = 'paneon-import.pending.json'

function readSettingsFile(path: string): Settings {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) throw new Error('Paneon settings file is not a supported size or type.')
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).projects)) {
    throw new Error('Paneon settings file does not contain a project list.')
  }
  return migrateSettings(raw)
}

export function previewPaneonImport(paneonDir: string, dawshaDir: string): PaneonImportPreview {
  const pending = existsSync(join(dawshaDir, PENDING_FILE))
  const source = join(paneonDir, 'settings.json')
  if (!existsSync(source)) return { available: false, pending, projects: 0, layouts: 0, snippets: 0, error: null }
  try {
    const settings = readSettingsFile(source)
    return {
      available: true,
      pending,
      projects: settings.projects.length,
      layouts: settings.layouts.length,
      snippets: settings.snippets.length,
      error: null
    }
  } catch {
    return { available: true, pending, projects: 0, layouts: 0, snippets: 0, error: 'Paneon settings could not be read.' }
  }
}

export function queuePaneonImport(paneonDir: string, dawshaDir: string): void {
  if (resolve(paneonDir).toLowerCase() === resolve(dawshaDir).toLowerCase()) throw new Error('Paneon and Dawsha data folders must be different.')
  const pending = join(dawshaDir, PENDING_FILE)
  if (existsSync(pending)) throw new Error('Paneon import is already waiting for a restart.')
  const settings = readSettingsFile(join(paneonDir, 'settings.json'))
  mkdirSync(dawshaDir, { recursive: true })
  const temporary = join(dawshaDir, `paneon-import.pending-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', flag: 'wx' })
    if (existsSync(pending)) throw new Error('Paneon import is already waiting for a restart.')
    renameSync(temporary, pending)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function applyPendingPaneonImport(dawshaDir: string): string | null {
  const pending = join(dawshaDir, PENDING_FILE)
  if (!existsSync(pending)) return null
  let imported: Settings
  try {
    imported = readSettingsFile(pending)
  } catch {
    const invalid = join(dawshaDir, `paneon-import.invalid-${Date.now()}-${randomUUID().slice(0, 8)}.json`)
    renameSync(pending, invalid)
    return `Paneon import was not applied because the pending file was invalid. It was kept at ${invalid}. You can retry from Settings.`
  }
  const settingsPath = join(dawshaDir, 'settings.json')
  let currentVersion: Settings['lastSeenVersion'] = null
  let backup: string | null = null
  if (existsSync(settingsPath)) {
    try { currentVersion = readSettingsFile(settingsPath).lastSeenVersion } catch { /* Preserve the raw file in the backup. */ }
    backup = join(dawshaDir, `settings.json.pre-paneon-${Date.now()}-${randomUUID().slice(0, 8)}.bak`)
    copyFileSync(settingsPath, backup, constants.COPYFILE_EXCL)
  }
  new SettingsStore(settingsPath).update({ ...imported, lastSeenVersion: currentVersion })
  unlinkSync(pending)
  return backup
    ? `Imported Paneon settings into Dawsha. The previous Dawsha settings were backed up to ${backup}.`
    : 'Imported Paneon settings into Dawsha.'
}
