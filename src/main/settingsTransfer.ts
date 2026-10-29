import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import {
  TRANSFER_MAX_BYTES,
  buildEnvelope,
  importDialogOptions,
  parseTransfer,
  transferFileName,
  type SettingsExportResult,
  type SettingsImportRead
} from '../shared/settingsTransfer'
import type { Settings } from '../shared/types'
import { appVersion } from './appVersion'

async function chooseSavePath(window: BrowserWindow | null, name: string): Promise<string | null> {
  const override = process.env.DAWSHA_SAVE_PATH
  if (override) return override
  const options = {
    title: 'Export settings',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Dawsha settings', extensions: ['json'] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function chooseOpenPath(window: BrowserWindow | null): Promise<string | null> {
  const override = process.env.DAWSHA_OPEN_PATH
  if (override) return override
  const options = importDialogOptions(app.getPath('desktop'))
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export async function exportSettings(window: BrowserWindow | null, settings: Settings): Promise<SettingsExportResult> {
  try {
    const now = new Date()
    const path = await chooseSavePath(window, transferFileName(now))
    if (!path) return { status: 'cancelled' }
    const envelope = buildEnvelope(settings, appVersion(), now)
    await writeFile(path, JSON.stringify(envelope, null, 2), 'utf8')
    return { status: 'saved', path }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not write the settings file.' }
  }
}

export async function readSettingsImport(window: BrowserWindow | null): Promise<SettingsImportRead> {
  try {
    const path = await chooseOpenPath(window)
    if (!path) return { status: 'cancelled' }
    const info = await stat(path)
    if (info.size > TRANSFER_MAX_BYTES) return { status: 'error', message: 'This file is too large to be a Dawsha settings export (over 2 MB).' }
    const parsed = parseTransfer(await readFile(path, 'utf8'), info.size)
    return parsed.ok ? { status: 'ok', transfer: parsed.transfer } : { status: 'error', message: parsed.error }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not read the settings file.' }
  }
}
