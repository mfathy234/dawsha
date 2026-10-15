import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import { TRANSCRIPT_MAX_BYTES } from '../shared/transcript'
import type { TimelineEvent, TimelineExportRequest, TimelineExportResult, TimelineRequest, TimelineResult } from '../shared/timeline'
import { parseTimeline } from '../shared/timelineParse'
import { locateSession } from './transcriptExport'

interface Cached {
  path: string
  signature: string
  events: TimelineEvent[]
}

const located = new Map<string, string>()
const parsed = new Map<string, Cached>()

const keyOf = (request: TimelineRequest): string => `${request.agent}:${request.sessionId ?? ''}`

async function pathFor(request: TimelineRequest): Promise<string | null> {
  const key = keyOf(request)
  const known = located.get(key)
  if (known) {
    try {
      if ((await stat(known)).isFile()) return known
    } catch {
      located.delete(key)
    }
  }
  const found = await locateSession(request)
  if (found) located.set(key, found.path)
  return found?.path ?? null
}

/** The session log's events. Re-reads the file only when its size or modified time changed. */
export async function sessionTimeline(request: TimelineRequest): Promise<TimelineResult> {
  if (request.agent === 'shell') return { status: 'no-session' }
  try {
    const path = await pathFor(request)
    if (!path) return { status: 'no-session' }
    const info = await stat(path)
    if (info.size > TRANSCRIPT_MAX_BYTES) return { status: 'no-session' }
    const key = keyOf(request)
    const signature = `${info.size}:${Math.round(info.mtimeMs)}`
    const cached = parsed.get(key)
    if (cached && cached.path === path && cached.signature === signature) return { status: 'ok', events: cached.events }
    const events = parseTimeline(request.agent, await readFile(path, 'utf8'))
    parsed.set(key, { path, signature, events })
    return { status: 'ok', events }
  } catch {
    return { status: 'no-session' }
  }
}

async function choosePath(window: BrowserWindow | null, name: string): Promise<string | null> {
  const override = process.env.DAWSHA_SAVE_PATH
  if (override) return override
  const options = {
    title: 'Export timeline',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export async function exportTimeline(window: BrowserWindow | null, request: TimelineExportRequest): Promise<TimelineExportResult> {
  try {
    const path = await choosePath(window, request.name)
    if (!path) return { status: 'cancelled' }
    await writeFile(path, request.text, 'utf8')
    return { status: 'saved', path }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not write the timeline.' }
  }
}
