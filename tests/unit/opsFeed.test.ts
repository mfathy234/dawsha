import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readOpsDir, readOpsDirs } from '../../src/main/opsWatcher'
import { derivePanes, trackedSessionIds } from '../../src/renderer/derive'
import { initialState, type AppState } from '../../src/renderer/state'
import {
  drawerRow,
  formatElapsed,
  formatLeft,
  formatResets,
  formatTokens,
  modelLetter,
  newestLimits,
  opsModelLabel,
  parseOpsSnapshot,
  runningFamilies,
  verdictTone
} from '../../src/shared/opsFeed'
import { parseStatusPayload } from '../../src/shared/statusLine'

const NOW = 1_791_451_700_000

const feed = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    v: 1,
    sessionId: 'sess-1',
    cwd: 'C:\\work',
    updatedAt: NOW,
    ended: false,
    model: 'claude-opus-5-5',
    plan: { title: 'Allow edits', done: 3, total: 6 },
    agents: [
      {
        id: 'a1',
        description: 'Read handlers',
        model: 'claude-haiku-4-5',
        status: 'done',
        startedAt: NOW - 20_000,
        finishedAt: NOW - 6000,
        tokens: 12_300,
        tools: 4
      },
      {
        id: 'a2',
        description: 'Unit tests',
        model: 'claude-sonnet-5-5',
        status: 'running',
        startedAt: NOW - 48_000,
        tools: 7,
        lastStep: 'dotnet test'
      },
      { id: 'task-3', description: 'Review the diff', status: 'waiting' }
    ],
    advisor: { status: 'done', verdict: 'OK with notes', note: 'check filter' },
    context: { percent: 41, tokens: 82_000, window: 200_000, stage: 'fine' },
    compactions: 1,
    cache: { phase: 'warm', leftMs: 2_820_000, hitPercent: 96 },
    limits: [
      { kind: 'seven_day_fable', percentUsed: 9, resetsAt: '2026-10-11T09:00:00Z' },
      { kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-08T12:00:00Z' }
    ],
    files: [{ path: 'C:\\work\\Message.cs', kind: 'M', by: 'claude-sonnet-5-5', at: NOW }],
    checks: [{ kind: 'build', target: 'Apis', ok: true, summary: 'ok', at: NOW }],
    ...extra
  })

describe('parseOpsSnapshot', () => {
  it('parses a full snapshot', () => {
    const s = parseOpsSnapshot(feed())!
    expect(s.sessionId).toBe('sess-1')
    expect(s.family).toBe('opus')
    expect(s.plan).toEqual({ title: 'Allow edits', done: 3, total: 6 })
    expect(s.agents.map((a) => [a.id, a.status, a.family])).toEqual([
      ['a1', 'done', 'haiku'],
      ['a2', 'running', 'sonnet'],
      ['task-3', 'waiting', null]
    ])
    expect(s.limits.map((w) => [w.label, w.family ?? null, w.percent])).toEqual([
      ['5h', null, 62],
      ['fable', 'fable', 9]
    ])
    expect(s.limits[1].resetsAt).toBe(Date.parse('2026-10-11T09:00:00Z'))
    expect(s.files[0]).toMatchObject({ kind: 'M', family: 'sonnet' })
    expect(s.cache).toEqual({ phase: 'warm', leftMs: 2_820_000, hitPercent: 96 })
  })

  it('rejects partial JSON and snapshots missing v, sessionId or updatedAt', () => {
    expect(parseOpsSnapshot(feed().slice(0, 80))).toBeNull()
    expect(parseOpsSnapshot('')).toBeNull()
    expect(parseOpsSnapshot(JSON.stringify({ sessionId: 'a', updatedAt: 1 }))).toBeNull()
    expect(parseOpsSnapshot(JSON.stringify({ v: 1, updatedAt: 1 }))).toBeNull()
    expect(parseOpsSnapshot(JSON.stringify({ v: 1, sessionId: 'a' }))).toBeNull()
    expect(parseOpsSnapshot(JSON.stringify({ v: 2, sessionId: 'a', updatedAt: 1 }))).toBeNull()
  })

  it('accepts a snapshot with only the required fields', () => {
    const s = parseOpsSnapshot(JSON.stringify({ v: 1, sessionId: 'a', updatedAt: NOW }))!
    expect(s).toMatchObject({
      ended: false,
      plan: null,
      advisor: null,
      context: null,
      cache: null,
      agents: [],
      files: [],
      limits: []
    })
  })

  it('ignores unknown fields and malformed entries', () => {
    const s = parseOpsSnapshot(
      feed({
        future: { a: 1 },
        agents: [{ id: 'x', status: 'weird', extra: 1 }, 'bad', { nope: 1 }],
        files: [{ path: 'a', kind: 'Z' }]
      })
    )!
    expect(s.agents).toHaveLength(1)
    expect(s.agents[0]).toMatchObject({ id: 'x', status: 'waiting', description: 'x' })
    expect(s.files).toEqual([])
  })

  it('keeps only the newest 40 files', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `f${i}`, kind: 'A' }))
    const s = parseOpsSnapshot(feed({ files }))!
    expect(s.files).toHaveLength(40)
    expect(s.files.at(-1)?.path).toBe('f49')
  })
})

describe('readOpsDir', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const temp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dawsha-ops-'))
    dirs.push(dir)
    return dir
  }

  it('returns nothing for a missing folder', async () => {
    expect(await readOpsDir(join(temp(), 'nope'))).toEqual([])
  })

  it('keeps the last good snapshot while the file is partially written, then picks up the next one', async () => {
    const dir = temp()
    const cache = new Map()
    const file = join(dir, 'sess-1.json')
    writeFileSync(file, feed(), 'utf8')
    expect((await readOpsDir(dir, cache))[0].plan?.done).toBe(3)
    writeFileSync(file, feed().slice(0, 60) + ' '.repeat(7), 'utf8')
    expect((await readOpsDir(dir, cache))[0].plan?.done).toBe(3)
    writeFileSync(file, feed({ plan: { title: 't', done: 5, total: 6 } }) + '\n', 'utf8')
    expect((await readOpsDir(dir, cache))[0].plan?.done).toBe(5)
  })

  it('reads the new and the legacy folder and keeps the newest snapshot per session', async () => {
    const fresh = temp()
    const legacy = temp()
    writeFileSync(join(legacy, 'sess-1.json'), feed({ updatedAt: NOW - 5000, plan: { title: 't', done: 1, total: 6 } }), 'utf8')
    writeFileSync(join(legacy, 'sess-2.json'), feed({ sessionId: 'sess-2' }), 'utf8')
    writeFileSync(join(fresh, 'sess-1.json'), feed({ plan: { title: 't', done: 4, total: 6 } }), 'utf8')
    const found = await readOpsDirs([fresh, legacy, join(fresh, 'missing')])
    expect(found.map((s) => s.sessionId).sort()).toEqual(['sess-1', 'sess-2'])
    expect(found.find((s) => s.sessionId === 'sess-1')?.plan?.done).toBe(4)
  })

  it('drops a snapshot when its file is removed and ignores other files', async () => {
    const dir = temp()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'notes.txt'), 'x', 'utf8')
    writeFileSync(join(dir, 'bad.json'), '{', 'utf8')
    const cache = new Map()
    writeFileSync(join(dir, 'sess-1.json'), feed(), 'utf8')
    expect(await readOpsDir(dir, cache)).toHaveLength(1)
    rmSync(join(dir, 'sess-1.json'))
    expect(await readOpsDir(dir, cache)).toEqual([])
  })
})

describe('formatting', () => {
  it('maps models to letters and labels', () => {
    expect((['opus', 'sonnet', 'haiku', 'fable'] as const).map(modelLetter)).toEqual(['O', 'S', 'H', 'F'])
    expect(opsModelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(opsModelLabel('claude-fable-1')).toBe('Fable 1')
    expect(opsModelLabel(null)).toBeNull()
    expect(runningFamilies(parseOpsSnapshot(feed())!)).toEqual(['sonnet'])
  })

  it('formats elapsed, tokens, resets and cache time', () => {
    expect(formatElapsed(14_000)).toBe('0:14')
    expect(formatElapsed(112_000)).toBe('1:52')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(48_000)).toBe('48k')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatResets(NOW + 100 * 60_000, NOW)).toBe('resets in 1h 40m')
    expect(formatResets(NOW + (3 * 24 + 2) * 3_600_000, NOW)).toBe('resets in 3d 2h')
    expect(formatLeft(47 * 60_000)).toBe('47m left')
  })

  it('builds drawer rows with markers, live elapsed and a second line for running agents', () => {
    const s = parseOpsSnapshot(feed())!
    const rows = s.agents.map((a) => drawerRow(a, NOW))
    expect(rows[0]).toMatchObject({ marker: '[x]', modelLabel: 'haiku', elapsed: '0:14', tokens: '12k', detail: null })
    expect(rows[1]).toMatchObject({
      marker: '[~]',
      modelLabel: 'sonnet',
      elapsed: '0:48',
      tokens: '',
      detail: '7 tools   last: dotnet test'
    })
    expect(drawerRow(s.agents[1], NOW + 10_000).elapsed).toBe('0:58')
    expect(rows[2]).toMatchObject({ marker: '[ ]', modelLabel: '', elapsed: '' })
    expect(drawerRow({ ...s.agents[0], status: 'failed' }, NOW).marker).toBe('[!]')
  })

  it('colours verdicts', () => {
    expect([verdictTone('OK'), verdictTone('OK with notes'), verdictTone('Rethink'), verdictTone(null)]).toEqual([
      'ok',
      'warn',
      'bad',
      'muted'
    ])
  })
})

describe('precedence', () => {
  const statusPayload = JSON.stringify({
    session_id: 'sess-1',
    model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' },
    cost: { total_cost_usd: 0.5 },
    context_window: { used_percentage: 7 },
    rate_limits: { five_hour: { used_percentage: 9, resets_at: 1791486600 } }
  })

  const state = (withOps: boolean): AppState => {
    const base = initialState()
    return {
      ...base,
      now: NOW,
      bridge: { ...base.bridge, installed: true },
      settings: {
        ...base.settings,
        projects: [{ id: 'p', name: 'P', folder: 'C:\\work', defaultAgent: 'claude' }]
      },
      panes: [
        {
          id: 'pane',
          projectId: 'p',
          activeTabId: 't',
          fontSize: 15,
          tabs: [{ id: 't', agent: 'claude', label: 'claude', startedAt: NOW - 5000, status: 'running', pid: 10 }]
        }
      ],
      sessions: [{ pid: 10, sessionId: 'sess-1', cwd: 'C:\\work', status: 'idle', startedAt: NOW - 4000, updatedAt: NOW }],
      statusInfo: { 'sess-1': parseStatusPayload(statusPayload, NOW - 1000)! },
      opsInfo: withOps ? { 'sess-1': parseOpsSnapshot(feed())! } : {}
    }
  }

  it('uses the snapshot for model and context when present', () => {
    const view = derivePanes(state(true))[0]
    expect(view.info.model).toEqual({ label: 'Opus 5.5', family: 'opus' })
    expect(view.info.contextPercent).toBe(41)
    expect(view.info.costUsd).toBe(0.5)
    expect(view.info.ops).toEqual({ plan: { done: 3, total: 6 }, running: ['sonnet'], sessionId: expect.any(String) })
  })

  it('falls back to the status line without a snapshot', () => {
    const view = derivePanes(state(false))[0]
    expect(view.info.model?.label).toBe('Sonnet 5.5')
    expect(view.info.contextPercent).toBe(7)
    expect(view.info.ops).toBeNull()
  })

  it('hides the agents summary when the session ended or the pty exited', () => {
    const ended = state(true)
    ended.opsInfo = { 'sess-1': parseOpsSnapshot(feed({ ended: true }))! }
    expect(derivePanes(ended)[0].info.ops).toBeNull()
    expect(derivePanes(ended)[0].snapshot).not.toBeNull()
    const exited = state(true)
    exited.panes[0].tabs[0].status = 'exited'
    expect(derivePanes(exited)[0].opsLive).toBe(false)
  })

  it('tracks the sessions of claude tabs', () => {
    expect(trackedSessionIds(state(false))).toEqual(['sess-1'])
  })

  it('picks the newest limits between the snapshot and the status line', () => {
    const status = parseStatusPayload(statusPayload, NOW - 1000)!
    const older = parseOpsSnapshot(feed({ updatedAt: NOW - 5000 }))!
    const newer = parseOpsSnapshot(feed({ updatedAt: NOW }))!
    expect(newestLimits([status], [older])?.windows[0].percent).toBe(9)
    expect(newestLimits([status], [newer])?.windows.map((w) => w.label)).toEqual(['5h', 'fable'])
    expect(newestLimits([], [])).toBeNull()
  })
})
