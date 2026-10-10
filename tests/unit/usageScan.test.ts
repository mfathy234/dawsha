import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UsageService } from '../../src/main/usage'
import type { Project, StatusInfo } from '../../src/shared/types'
import { hourKey } from '../../src/shared/usage'

const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'
const CODEX_ID = '019aaaaa-0000-7000-8000-0000000000aa'
const WORK = join(tmpdir(), 'dawsha-usage-work')

const PROJECTS: Project[] = [
  { id: 'acme', name: 'acme-web', folder: join(WORK, 'acme-web'), defaultAgent: 'claude' },
  { id: 'docs', name: 'docs-site', folder: join(WORK, 'docs-site'), defaultAgent: 'gemini' }
]

const lines = (...records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`

interface Homes {
  root: string
  claude: string
  codex: string
  gemini: string
}

function makeHomes(): Homes {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-usage-'))
  return { root, claude: join(root, 'claude'), codex: join(root, 'codex'), gemini: join(root, 'gemini') }
}

function writeClaude(homes: Homes, usage: Record<string, number>, when = new Date()): string {
  const dir = join(homes.claude, 'projects', 'acme-slug')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${CLAUDE_ID}.jsonl`)
  writeFileSync(
    path,
    lines(
      { type: 'user', timestamp: when.toISOString(), message: { content: 'hi' } },
      {
        type: 'assistant',
        timestamp: when.toISOString(),
        cwd: PROJECTS[0].folder,
        sessionId: CLAUDE_ID,
        message: { id: 'm1', usage }
      }
    )
  )
  return path
}

function writeCodex(homes: Homes, when = new Date()): void {
  const dir = join(homes.codex, 'sessions', '2026', '10', '08')
  mkdirSync(dir, { recursive: true })
  const stamp = when.toISOString()
  writeFileSync(
    join(dir, `rollout-2026-10-08T12-00-00-${CODEX_ID}.jsonl`),
    lines(
      { type: 'session_meta', timestamp: stamp, payload: { id: CODEX_ID, cwd: PROJECTS[0].folder } },
      {
        type: 'event_msg',
        timestamp: stamp,
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300, total_tokens: 5300 } }
        }
      }
    )
  )
}

function writeGemini(homes: Homes, when = new Date()): void {
  const slug = join(homes.gemini, 'tmp', 'docs-site')
  mkdirSync(join(slug, 'chats'), { recursive: true })
  writeFileSync(join(slug, '.project_root'), PROJECTS[1].folder, 'utf8')
  writeFileSync(
    join(slug, 'chats', 'session-2026-10-08T12-00-abcd1234.jsonl'),
    lines(
      { sessionId: 'abcd1234-0000-4000-8000-000000000000', startTime: when.toISOString() },
      { id: 'g1', type: 'gemini', timestamp: when.toISOString(), content: 'x', tokens: { input: 800, output: 100, cached: 300, thoughts: 0, tool: 0, total: 900 } }
    )
  )
}

const saved = { ...process.env }

beforeEach(() => {
  process.env = { ...saved }
})

afterEach(() => {
  process.env = { ...saved }
})

function use(homes: Homes): void {
  process.env.DAWSHA_CLAUDE_HOME = homes.claude
  process.env.DAWSHA_CODEX_HOME = homes.codex
  process.env.DAWSHA_GEMINI_HOME = homes.gemini
}

describe('UsageService.report', () => {
  it('reads all three agents from their own folders and groups by project', async () => {
    const homes = makeHomes()
    use(homes)
    writeClaude(homes, { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000 })
    writeCodex(homes)
    writeGemini(homes)
    const service = new UsageService(join(homes.root, 'usage-history.json'))
    const report = await service.report('7d', PROJECTS)
    expect(report.hasTokens).toBe(true)
    expect(report.sources).toEqual([
      { agent: 'claude', found: true, files: 1 },
      { agent: 'codex', found: true, files: 1 },
      { agent: 'gemini', found: true, files: 1 }
    ])
    expect(report.byAgent.map((row) => [row.agent, row.tokens, row.cacheRead])).toEqual([
      ['claude', 1000, 9000],
      ['codex', 1300, 4000],
      ['gemini', 600, 300]
    ])
    expect(report.byProject.map((row) => [row.project, row.tokens, row.sessions])).toEqual([
      ['acme-web', 2300, 2],
      ['docs-site', 600, 1]
    ])
    expect(report.byProject[0].topAgent).toBe('codex')
    const key = hourKey(Date.now())
    const today = report.buckets.at(-1)
    expect(today?.key).toBe(key.slice(0, 10))
    expect(today?.perAgent.claude.tokens).toBe(1000)
  })

  it('explains a missing agent folder and skips files older than the range', async () => {
    const homes = makeHomes()
    use(homes)
    const old = new Date(Date.now() - 20 * 24 * 3_600_000)
    const path = writeClaude(homes, { input_tokens: 10, output_tokens: 10 }, old)
    utimesSync(path, old, old)
    const service = new UsageService(join(homes.root, 'usage-history.json'))
    const week = await service.report('7d', PROJECTS)
    expect(week.sources).toEqual([
      { agent: 'claude', found: true, files: 0 },
      { agent: 'codex', found: false, files: 0 },
      { agent: 'gemini', found: false, files: 0 }
    ])
    expect(week.hasTokens).toBe(false)
    const month = await service.report('30d', PROJECTS)
    expect(month.sources[0].files).toBe(1)
    expect(month.byAgent[0].tokens).toBe(20)
  })

  it('reparses a file only when it changed', async () => {
    const homes = makeHomes()
    use(homes)
    const path = writeClaude(homes, { input_tokens: 100, output_tokens: 100 })
    const service = new UsageService(join(homes.root, 'usage-history.json'))
    expect((await service.report('7d', PROJECTS)).byAgent[0].tokens).toBe(200)
    const before = readFileSync(path, 'utf8')
    writeFileSync(path, `${before}${lines({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm2', usage: { input_tokens: 50, output_tokens: 50 } } })}`)
    const later = new Date(Date.now() + 5000)
    utimesSync(path, later, later)
    expect((await service.report('7d', PROJECTS)).byAgent[0].tokens).toBe(300)
  })

  it('shares one scan between simultaneous requests for the same range', async () => {
    const homes = makeHomes()
    use(homes)
    writeClaude(homes, { input_tokens: 1, output_tokens: 1 })
    const service = new UsageService(join(homes.root, 'usage-history.json'))
    const [a, b] = await Promise.all([service.report('7d', PROJECTS), service.report('7d', PROJECTS)])
    expect(a).toBe(b)
  })
})

describe('UsageService history', () => {
  const info = (over: Partial<StatusInfo> = {}): StatusInfo => ({
    sessionId: 'sess-1',
    modelId: null,
    modelName: null,
    family: 'opus',
    cwd: PROJECTS[0].folder,
    costUsd: 3.5,
    contextPercent: null,
    rateLimits: [
      { key: 'five_hour', label: '5h', percent: 62, resetsAt: null },
      { key: 'seven_day', label: 'week', percent: 18, resetsAt: null }
    ],
    receivedAt: Date.now(),
    ...over
  })

  it('records cost and limit readings, saves them and reads them back with the report', async () => {
    const homes = makeHomes()
    use(homes)
    const path = join(homes.root, 'usage-history.json')
    const service = new UsageService(path)
    service.load()
    service.recordStatus([info()])
    service.recordStatus([info({ receivedAt: Date.now() + 1000 })])
    service.flush()
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    expect(stored.v).toBe(1)
    expect(stored.limits).toHaveLength(1)
    expect(stored.limits[0].w).toEqual({ five_hour: 62, seven_day: 18 })
    expect(stored.costs['sess-1']).toMatchObject({ usd: 3.5, cwd: PROJECTS[0].folder })

    const again = new UsageService(path)
    again.load()
    const report = await again.report('7d', PROJECTS)
    expect(report.hasCost).toBe(true)
    expect(report.byAgent[0].costUsd).toBe(3.5)
    expect(report.byProject[0]).toMatchObject({ project: 'acme-web', costUsd: 3.5 })
    expect(report.limits.map((series) => [series.key, series.points.at(-1)?.percent])).toEqual([
      ['five_hour', 62],
      ['seven_day', 18]
    ])
  })

  it('starts empty when the history file is missing or damaged', async () => {
    const homes = makeHomes()
    use(homes)
    const path = join(homes.root, 'usage-history.json')
    writeFileSync(path, '{ not json', 'utf8')
    const service = new UsageService(path)
    service.load()
    const report = await service.report('7d', PROJECTS)
    expect(report.hasCost).toBe(false)
    expect(report.limits).toEqual([])
  })
})
