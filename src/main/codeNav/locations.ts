import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { CodeNavEngine, CodeNavHit, CodeNavResult } from '../../shared/codeNav'
import { resolveProjectFile } from '../gitWorkspace'
import { readTextFile, repoRoot } from '../gitCommit'

export interface ServerLocation { file: string; line: number; column: number; outside?: boolean }

async function sourceLines(folder: string, path: string, current?: { file: string; text: string }): Promise<{ path: string; lines: string[] } | null> {
  const target = await resolveProjectFile(folder, path)
  if (!target.ok) return null
  const text = current?.file === target.full ? current.text : await readTextFile(target.full)
  return { path: target.realRel, lines: text?.split(/\r\n|\r|\n/) ?? [] }
}

export async function navigationHits(folder: string, locations: readonly ServerLocation[], engine: CodeNavEngine, current?: { file: string; text: string }): Promise<CodeNavResult> {
  const root = await realpath((await repoRoot(folder)) ?? folder)
  const hits: CodeNavHit[] = []
  let outside = false
  const seen = new Set<string>()
  const sources = new Map<string, Promise<Awaited<ReturnType<typeof sourceLines>>>>()
  for (const location of locations.slice(0, 500)) {
    if (location.outside) { outside = true; continue }
    if (!isAbsolute(location.file) || !Number.isSafeInteger(location.line) || location.line < 1 || !Number.isSafeInteger(location.column) || location.column < 1) continue
    const path = relative(root, location.file).replace(/\\/g, '/')
    const source = sources.get(path) ?? sourceLines(folder, path, current)
    sources.set(path, source)
    const file = await source
    if (!file) { outside = true; continue }
    const key = `${file.path}:${location.line}:${location.column}`
    if (seen.has(key)) continue
    seen.add(key)
    const preview = (file.lines[location.line - 1] ?? '').trim()
    hits.push({ path: file.path, line: location.line, column: location.column, preview })
  }
  return { ok: true, hits, outside, engine }
}
