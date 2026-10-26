import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { shell } from 'electron'
import { agentLabel } from '../shared/agents'
import {
  HANDOFF_KEEP_FILES,
  handoffFileName,
  parseHandoffRequest,
  staleHandoffs,
  type HandoffTranscriptResult
} from '../shared/handoff'
import type { Project } from '../shared/types'
import { renderTranscript } from '../shared/transcript'
import { buildTranscriptDoc } from './transcriptExport'

async function prune(dir: string): Promise<void> {
  const names = await readdir(dir)
  const files = await Promise.all(
    names.map(async (name) => {
      try {
        return { name, modifiedAt: (await stat(join(dir, name))).mtimeMs }
      } catch {
        return null
      }
    })
  )
  const known = files.filter((file): file is { name: string; modifiedAt: number } => file !== null)
  await Promise.all(staleHandoffs(known, HANDOFF_KEEP_FILES).map((name) => rm(join(dir, name), { force: true })))
}

/** Writes the session transcript under `dir` and returns its path; the folder comes from a known project, never from the caller. */
export async function writeHandoffTranscript(projects: Project[], dir: string, value: unknown): Promise<HandoffTranscriptResult> {
  const request = parseHandoffRequest(value)
  if (!request) return { status: 'error', message: 'The handoff request was not valid.' }
  const project = projects.find((item) => item.id === request.projectId)
  if (!project) return { status: 'error', message: 'That project is not known.' }
  try {
    const doc = await buildTranscriptDoc({
      agent: request.agent,
      agentLabel: agentLabel(request.agent),
      sessionId: request.sessionId,
      folder: project.folder,
      projectName: project.name
    })
    if (!doc) return { status: 'no-session' }
    await mkdir(dir, { recursive: true })
    const path = join(dir, handoffFileName(project.name, request.agent, new Date()))
    await writeFile(path, renderTranscript(doc, 'md'), 'utf8')
    await prune(dir).catch(() => undefined)
    return { status: 'saved', path }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not save the transcript.' }
  }
}

/** Shows a handoff file in the file manager; anything outside the handoffs folder is ignored. */
export async function revealHandoff(dir: string, path: unknown): Promise<void> {
  if (typeof path !== 'string' || path === '') return
  const full = resolve(path)
  const inside = relative(resolve(dir), full)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return
  try {
    if (!(await stat(full)).isFile()) return
  } catch {
    return
  }
  if (process.env.DAWSHA_OPEN_LOG) return
  shell.showItemInFolder(full)
}
