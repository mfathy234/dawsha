import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCodexLimits, type CodexLimitsReading } from '../shared/codexLimits'
import type { AgentLimitEntry } from '../shared/agentLimits'
import { codexHome } from './agentLaunch'
import { listRollouts, readRange } from './codexWatcher'

const TAIL_BYTES = 256 * 1024
const CACHE_MS = 5000
const FILES_TRIED = 4

export interface CodexLimitsResult {
  entry: AgentLimitEntry | null
  plan: string | null
}

const EMPTY: CodexLimitsResult = { entry: null, plan: null }

export async function readCodexLimits(home: string = codexHome()): Promise<CodexLimitsResult> {
  try {
    const stats = await Promise.all((await listRollouts(join(home, 'sessions'))).map(async (path) => ({ path, info: await stat(path).catch(() => null) })))
    const newest = stats
      .flatMap(({ path, info }) => (info ? [{ path, size: info.size, at: Math.round(info.mtimeMs) }] : []))
      .sort((a, b) => b.at - a.at)
      .slice(0, FILES_TRIED)
    for (const file of newest) {
      let reading: CodexLimitsReading | null = null
      try {
        reading = parseCodexLimits(await readRange(file.path, Math.max(0, file.size - TAIL_BYTES), TAIL_BYTES))
      } catch {
        continue
      }
      if (reading) return { entry: { windows: reading.windows, at: reading.at ?? file.at }, plan: reading.plan }
    }
  } catch {
    return EMPTY
  }
  return EMPTY
}

export function createCodexLimitsReader(read: () => Promise<CodexLimitsResult> = readCodexLimits, now: () => number = Date.now): () => Promise<CodexLimitsResult> {
  let cached: { at: number; value: CodexLimitsResult } | null = null
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.value
    const value = await read()
    cached = { at: now(), value }
    return value
  }
}
