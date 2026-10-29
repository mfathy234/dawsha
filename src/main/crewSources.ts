import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { CrewSourceFile } from '../shared/crewSources'
import { listSkills, type SkillLocations } from './skillInventory'

const MAX_FILE_BYTES = 200 * 1024
const MAX_PROMPTS = 200
const MAX_TEXT = 24_000

function readText(path: string): string | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
    return readFileSync(path, 'utf8').slice(0, MAX_TEXT)
  } catch {
    return null
  }
}

const idOf = (path: string): string => createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 24)

function promptFiles(codexHome: string): { path: string; fileName: string }[] {
  const dir = join(codexHome, 'prompts')
  try {
    return readdirSync(dir)
      .filter((name) => /\.md$/i.test(name))
      .sort()
      .slice(0, MAX_PROMPTS)
      .map((fileName) => ({ path: join(dir, fileName), fileName }))
  } catch {
    return []
  }
}

/** Every agent file, skill and Codex prompt this PC has, read-only. With `ids` only those are read. */
export function scanSources(locations: SkillLocations, ids?: readonly string[]): CrewSourceFile[] {
  const wanted = ids ? new Set(ids) : null
  const found: CrewSourceFile[] = []
  for (const entry of listSkills(locations)) {
    if (wanted && !wanted.has(entry.id)) continue
    if (entry.kind === 'agent' && !/\.md$/i.test(entry.path)) continue
    const file = entry.kind === 'skill' ? join(entry.path, 'SKILL.md') : entry.path
    const text = readText(file)
    if (text === null) continue
    found.push({
      id: entry.id,
      kind: entry.kind,
      agent: entry.agent,
      scope: entry.scope,
      project: entry.project,
      path: file,
      fileName: entry.kind === 'skill' ? entry.name : entry.name,
      text
    })
  }
  for (const prompt of promptFiles(locations.codex)) {
    const id = idOf(prompt.path)
    if (wanted && !wanted.has(id)) continue
    const text = readText(prompt.path)
    if (text === null) continue
    found.push({ id, kind: 'prompt', agent: 'codex', scope: 'user', path: prompt.path, fileName: prompt.fileName, text })
  }
  return found
}

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

const SCAN_CACHE_MS = 5_000
let scanCache: { key: string; at: number; files: CrewSourceFile[] } | null = null

/** Linked reads come in bursts from the crew dialogs, so one scan serves them for a few seconds. */
function cachedScan(locations: SkillLocations): CrewSourceFile[] {
  const key = JSON.stringify(locations)
  const now = Date.now()
  if (scanCache && scanCache.key === key && now - scanCache.at < SCAN_CACHE_MS) return scanCache.files
  const files = scanSources(locations)
  scanCache = { key, at: now, files }
  return files
}

/** The text of a linked source, only when the path is one the scan lists, so a settings file cannot point this at anything else. */
export function readLinked(locations: SkillLocations, path: unknown): string | null {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) return null
  const target = resolve(path)
  const hit = cachedScan(locations).find((source) => same(resolve(source.path), target))
  return hit ? hit.text : null
}
