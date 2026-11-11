import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { BrowserWindow, app, dialog } from 'electron'
import type { Project } from '../shared/types'
import { dayKey } from '../shared/usage'
import {
  buildUsageCsv,
  exportFileName,
  exportWindow,
  isExportGrouping,
  isExportRange,
  type ExportCost,
  type ExportGrouping,
  type ExportRange,
  type ExportSession,
  type UsageExportResult
} from '../shared/usageCsv'
import { detailParserFor, type SessionDetail } from '../shared/usageDetail'
import type { Candidate, UsageService } from './usage'
import { usageCandidates } from './usage'
import { revealInFolder } from './desktop'

export interface UsageExportRequest {
  range: ExportRange
  grouping: ExportGrouping
}

const BOM = '﻿'
// The one file this module has just written, which is the only path the renderer may ask to see in the folder.
let lastSaved: string | null = null

async function detailOf(candidate: Candidate): Promise<SessionDetail | null> {
  const parser = detailParserFor(candidate.agent)
  try {
    if (candidate.path.endsWith('.json')) {
      parser.push(await readFile(candidate.path, 'utf8'))
    } else {
      const lines = createInterface({ input: createReadStream(candidate.path, { encoding: 'utf8' }), crlfDelay: Infinity })
      for await (const line of lines) parser.push(line)
    }
  } catch {
    return null
  }
  const parsed = parser.finish()
  return candidate.cwd ? { ...parsed, cwd: parsed.cwd ?? candidate.cwd } : parsed
}

async function readSessions(since: number): Promise<ExportSession[]> {
  const sessions: ExportSession[] = []
  for (const candidate of await usageCandidates(since)) {
    const detail = await detailOf(candidate)
    if (detail && detail.rows.length > 0) sessions.push({ ...detail, key: detail.sessionId ?? basename(candidate.path) })
  }
  return sessions
}

const costsOf = (usage: UsageService): ExportCost[] =>
  usage.costEntries().map(([sessionKey, cost]) => ({ day: dayKey(cost.at), sessionKey, cwd: cost.cwd, usd: cost.usd }))

async function choosePath(window: BrowserWindow | null, name: string): Promise<string | null> {
  const override = process.env.DAWSHA_SAVE_PATH
  if (override) return override
  const options = { title: 'Export usage', defaultPath: join(app.getPath('documents'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Reads the agents' folders, builds the CSV, asks where to save it and writes it there. Nothing is sent anywhere. */
export async function exportUsage(window: BrowserWindow | null, request: unknown, usage: UsageService, projects: Project[]): Promise<UsageExportResult> {
  const { range, grouping } = (request ?? {}) as Partial<UsageExportRequest>
  if (!isExportRange(range) || !isExportGrouping(grouping)) return { status: 'error', message: 'Choose a range and how to group the rows.' }
  try {
    const now = Date.now()
    const from = exportWindow(range, now).from
    const since = from === null ? 0 : new Date(`${from}T00:00:00`).getTime()
    const csv = buildUsageCsv({ now, range, grouping, projects, sessions: await readSessions(since), costs: costsOf(usage) })
    const path = await choosePath(window, exportFileName(range, now))
    if (!path) return { status: 'cancelled' }
    await writeFile(path, BOM + csv, 'utf8')
    lastSaved = path
    return { status: 'saved', path, name: basename(path) }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not write the CSV file.' }
  }
}

/** Shows the file that was just exported; any other path is refused. */
export function revealExport(path: unknown): boolean {
  if (typeof path !== 'string' || path !== lastSaved) return false
  revealInFolder(path)
  return true
}
