import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import { parseSessionIndex, rolloutIdFromName } from '../shared/codexSession'
import { claudeProjectSlug } from '../shared/projectSessions'
import {
  TRANSCRIPT_MAX_BYTES,
  formatFromPath,
  parseClaudeSession,
  parseCodexSession,
  parseGeminiSession,
  renderTranscript,
  transcriptFileName,
  type ParsedSession,
  type TranscriptDoc,
  type TranscriptFormat,
  type TranscriptRequest,
  type TranscriptResult
} from '../shared/transcript'
import { codexHome, geminiHome } from './agentLaunch'
import { diffStat } from './git'
import { listGeminiChatFiles, projectSlugs, readGeminiChat } from './geminiWatcher'
import { claudeProjectsDir } from './paths'
import { listRolloutFiles } from './projectSessions'

interface Found {
  path: string
  modifiedAt: number
}

const sessionFile = (id: string): string => `${id}.jsonl`

async function statFound(path: string): Promise<Found | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { path, modifiedAt: Math.round(info.mtimeMs) } : null
  } catch {
    return null
  }
}

async function findClaude(id: string, folder: string): Promise<Found | null> {
  const root = claudeProjectsDir()
  const direct = await statFound(join(root, claudeProjectSlug(folder), sessionFile(id)))
  if (direct) return direct
  let slugs: string[]
  try {
    slugs = await readdir(root)
  } catch {
    return null
  }
  for (const slug of slugs) {
    const hit = await statFound(join(root, slug, sessionFile(id)))
    if (hit) return hit
  }
  return null
}

async function findCodex(id: string): Promise<Found | null> {
  const files = await listRolloutFiles(join(codexHome(), 'sessions'))
  const path = files.find((file) => rolloutIdFromName(basename(file)) === id)
  return path ? statFound(path) : null
}

async function findGemini(id: string, folder: string): Promise<Found | null> {
  const home = geminiHome()
  const files = await listGeminiChatFiles(home)
  const slugs = new Set(await projectSlugs(folder, home))
  const ordered = [...files].sort((a, b) => Number(slugs.has(b.slug)) - Number(slugs.has(a.slug)) || b.modifiedAt - a.modifiedAt)
  for (const file of ordered) {
    const chat = await readGeminiChat(file)
    if (chat?.sessionId === id) return { path: file.path, modifiedAt: file.modifiedAt }
  }
  return null
}

async function codexTitle(id: string): Promise<string | undefined> {
  try {
    return parseSessionIndex(await readFile(join(codexHome(), 'session_index.jsonl'), 'utf8')).get(id)
  } catch {
    return undefined
  }
}

async function loadSession(request: TranscriptRequest): Promise<{ parsed: ParsedSession; found: Found } | null> {
  const { agent, sessionId, folder } = request
  if (!sessionId || agent === 'shell' || !/^[\w-]+$/.test(sessionId)) return null
  const found =
    agent === 'claude' ? await findClaude(sessionId, folder) : agent === 'codex' ? await findCodex(sessionId) : await findGemini(sessionId, folder)
  if (!found) return null
  try {
    if ((await stat(found.path)).size > TRANSCRIPT_MAX_BYTES) return null
    const text = await readFile(found.path, 'utf8')
    const parsed =
      agent === 'claude' ? parseClaudeSession(text) : agent === 'codex' ? parseCodexSession(text) : parseGeminiSession(text)
    if (agent === 'codex' && !parsed.title) parsed.title = await codexTitle(sessionId)
    return { parsed, found }
  } catch {
    return null
  }
}

export async function buildTranscriptDoc(request: TranscriptRequest, withChanges = true): Promise<TranscriptDoc | null> {
  const loaded = await loadSession(request)
  if (!loaded && request.scrollback === undefined) return null
  const changes = withChanges ? ((await diffStat(request.folder)) ?? undefined) : undefined
  const base = { agent: request.agentLabel, project: request.projectName, folder: request.folder, changes }
  if (!loaded) {
    return { ...base, title: request.title || `${request.agentLabel} terminal`, entries: [], scrollback: request.scrollback }
  }
  const { parsed, found } = loaded
  return {
    ...base,
    title: request.title || parsed.title || `${request.agentLabel} session`,
    model: parsed.model,
    sessionId: request.sessionId,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt ?? found.modifiedAt,
    entries: parsed.entries
  }
}

async function choosePath(window: BrowserWindow | null, name: string): Promise<string | null> {
  const override = process.env.DAWSHA_SAVE_PATH
  if (override) return override
  const options = {
    title: 'Export transcript',
    defaultPath: join(app.getPath('documents'), name),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'HTML', extensions: ['html'] }
    ]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export async function exportTranscript(window: BrowserWindow | null, request: TranscriptRequest): Promise<TranscriptResult> {
  try {
    const doc = await buildTranscriptDoc(request)
    if (!doc) return { status: 'no-session' }
    const format: TranscriptFormat = 'md'
    const name = transcriptFileName({
      project: request.projectName,
      title: request.title || doc.title,
      agent: request.agentLabel,
      now: new Date(),
      format
    })
    const path = await choosePath(window, name)
    if (!path) return { status: 'cancelled' }
    await writeFile(path, renderTranscript(doc, formatFromPath(path)), 'utf8')
    return { status: 'saved', path, source: doc.scrollback === undefined ? 'session' : 'scrollback' }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not write the transcript.' }
  }
}
