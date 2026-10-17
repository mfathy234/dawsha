import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sessionUsage, type UsageRunner } from '../../shared/orch/sessionUsage'
import { claudeProjectSlug } from '../../shared/projectSessions'
import { codexHome, geminiHome } from '../agentLaunch'
import { listGeminiChatFiles } from '../geminiWatcher'
import { listRolloutFiles } from '../projectSessions'
import type { OrchService } from './service'

/** One live agent pane whose CLI transcript holds its token usage. */
export interface UsageSourceInfo {
  agentId: string
  runner: UsageRunner
  cwd: string
  /** Claude and Gemini: the session id Dawsha gave the CLI. Codex: null (found by folder and time). */
  sessionId: string | null
  startedAt: number
}

export interface UsageFinder {
  find(source: UsageSourceInfo): Promise<string | null>
  read(path: string): Promise<string>
}

const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase() === b.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()

async function firstLine(path: string): Promise<string> {
  const text = await readFile(path, 'utf8').catch(() => '')
  return text.slice(0, Math.max(0, text.indexOf('\n'))) || text.slice(0, 4000)
}

/** Codex: the newest rollout that started in the agent's folder after its pane started. */
async function findCodexRollout(source: UsageSourceInfo): Promise<string | null> {
  let best: { path: string; at: number } | null = null
  for (const path of await listRolloutFiles(join(codexHome(), 'sessions')).catch(() => [] as string[])) {
    const info = await stat(path).catch(() => null)
    if (!info || info.mtimeMs < source.startedAt) continue
    try {
      const meta = JSON.parse(await firstLine(path)) as { payload?: { cwd?: string; timestamp?: string } }
      const startedAt = Date.parse(meta.payload?.timestamp ?? '') || info.birthtimeMs
      if (!meta.payload?.cwd || !samePath(meta.payload.cwd, source.cwd) || startedAt < source.startedAt - 60_000) continue
      if (!best || startedAt > best.at) best = { path, at: startedAt }
    } catch {
      continue
    }
  }
  return best?.path ?? null
}

async function findGeminiChat(source: UsageSourceInfo): Promise<string | null> {
  if (!source.sessionId) return null
  for (const file of await listGeminiChatFiles(geminiHome()).catch(() => [])) {
    if (file.modifiedAt < source.startedAt) continue
    if ((await readFile(file.path, 'utf8').catch(() => '')).includes(source.sessionId)) return file.path
  }
  return null
}

export const fileUsageFinder: UsageFinder = {
  async find(source) {
    if (source.runner === 'claude') {
      if (!source.sessionId) return null
      const path = join(homedir(), '.claude', 'projects', claudeProjectSlug(source.cwd), `${source.sessionId}.jsonl`)
      return (await stat(path).catch(() => null)) ? path : null
    }
    return source.runner === 'codex' ? findCodexRollout(source) : findGeminiChat(source)
  },
  read: (path) => readFile(path, 'utf8')
}

/**
 * Reads each live agent's transcript and reports its token counts, plus the cost Claude Code reports
 * through its status line, to the orchestrator.
 */
export class OrchUsageCollector {
  private readonly paths = new Map<string, string>()
  private readonly costs = new Map<string, number>()

  constructor(private readonly finder: UsageFinder = fileUsageFinder) {}

  /** Claude's status line gives the session's cost; remembered until the next collect. */
  setReportedCost(sessionId: string, usd: number): void {
    this.costs.set(sessionId, usd)
  }

  async collect(service: OrchService, sources: readonly UsageSourceInfo[]): Promise<void> {
    for (const source of sources) {
      try {
        const path = this.paths.get(source.agentId) ?? (await this.finder.find(source))
        if (!path) continue
        this.paths.set(source.agentId, path)
        const usage = sessionUsage(source.runner, await this.finder.read(path))
        const reported = source.sessionId ? this.costs.get(source.sessionId) : undefined
        service.reportUsage(source.agentId, { ...usage, reportedCostUsd: reported ?? null })
      } catch {
        this.paths.delete(source.agentId)
      }
    }
  }
}
