import { describe, expect, it } from 'vitest'
import { parseClaudeAgent, parseCodexAgent } from '../../src/shared/agentRecords'
import {
  DEFAULT_BG_FILTERS, applyFilters, axisTicks, axisWindow, barGeometry, barLabel, buildLanes, filtersActive, projectOptions, statusCounts, totalsOf,
  type BackgroundAgent
} from '../../src/shared/backgroundAgents'

const NOW = Date.parse('2026-10-12T11:00:00Z')
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')
const stamp = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
const usage = (input: number, output: number, write = 0, read = 0) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read })

const claudeInput = (text: string, meta: unknown, extra: Partial<Parameters<typeof parseClaudeAgent>[0]> = {}) => ({
  id: 'a1', parentId: 'p1', meta, head: text, tail: '', whole: true, read: text.length, size: text.length, mtime: NOW - 60_000, fallbackStart: NOW - 3_600_000, now: NOW, ...extra
})

const claudeRun = lines(
  { type: 'user', timestamp: stamp(40), cwd: 'C:\\work\\demo', message: { role: 'user', content: 'Do the thing' } },
  { type: 'assistant', timestamp: stamp(39), message: { id: 'm1', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: usage(2, 100, 1000, 5000), content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'assistant', timestamp: stamp(39), message: { id: 'm1', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: usage(2, 100, 1000, 5000), content: [{ type: 'text', text: 'running' }] } },
  { type: 'user', timestamp: stamp(38), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }
)
const claudeEnd = lines({ type: 'assistant', timestamp: stamp(5), message: { id: 'm2', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: usage(3, 50), content: [{ type: 'text', text: '**Done.** All 12 tests pass.' }] } })

describe('parseClaudeAgent', () => {
  it('reads a finished agent: result, times, deduped tokens', () => {
    const agent = parseClaudeAgent(claudeInput(`${claudeRun}\n${claudeEnd}`, { agentType: 'general-purpose', description: 'Fix tests', spawnDepth: 1, model: 'sonnet', finished: true }))
    expect(agent).toMatchObject({ kind: 'claude', description: 'Fix tests', type: 'general-purpose', status: 'done', model: 'sonnet', cwd: 'C:\\work\\demo', result: 'Done. All 12 tests pass.' })
    expect(agent.startedAt).toBe(NOW - 40 * 60_000)
    expect(agent.endedAt).toBe(NOW - 5 * 60_000)
    expect(agent.usage).toEqual({ input: 5, output: 150, cacheWrite: 1000, cacheRead: 5000 })
    expect(agent.usageApprox).toBe(false)
  })

  it('is running while recent and unfinished, with its last tool call as the step', () => {
    const text = claudeRun.split('\n').slice(0, 2).join('\n')
    const agent = parseClaudeAgent(claudeInput(text, { agentType: 'Explore', description: 'Scan' }, { now: NOW - 37 * 60_000 }))
    expect(agent.status).toBe('running')
    expect(agent.endedAt).toBeNull()
    expect(agent.lastStep).toBe('Bash npm test')
    expect(agent.result).toBe('')
  })

  it('treats an end_turn final message as done even without the finished flag', () => {
    expect(parseClaudeAgent(claudeInput(`${claudeRun}\n${claudeEnd}`, { agentType: 'Explore', description: 'x' })).status).toBe('done')
  })

  it('fails agents the user stopped, with an API error, or left without a final answer', () => {
    const stopped = parseClaudeAgent(claudeInput(`${claudeRun}\n${claudeEnd}`, { stoppedByUser: true, description: 'x' }))
    expect(stopped).toMatchObject({ status: 'failed', statusNote: 'Stopped by you' })
    const apiError = lines({ type: 'assistant', timestamp: stamp(5), isApiErrorMessage: true, message: { id: 'e', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'API Error' }] } })
    expect(parseClaudeAgent(claudeInput(apiError, { description: 'x' })).statusNote).toBe('Ended with an API error')
    const stale = parseClaudeAgent(claudeInput(claudeRun, { description: 'x' }))
    expect(stale.status).toBe('failed')
    expect(stale.statusNote).toMatch(/Interrupted/)
  })

  it('records fork type, depth and parent agent from the meta file', () => {
    const agent = parseClaudeAgent(claudeInput(claudeEnd, { isFork: true, spawnDepth: 2, parentAgentId: 'abc', description: 'x', finished: true }))
    expect(agent).toMatchObject({ type: 'fork', depth: 2, parentAgentId: 'abc' })
  })

  it('scales tokens and flags them approximate when only the edges were read', () => {
    const agent = parseClaudeAgent(claudeInput(claudeRun, { description: 'x', finished: true }, { whole: false, tail: claudeEnd, read: 1000, size: 10_000 }))
    expect(agent.usageApprox).toBe(true)
    expect(agent.usage.output).toBe((100 + 50) * 10)
  })

  it('survives a cut first tail line and empty meta', () => {
    const agent = parseClaudeAgent(claudeInput('', null, { whole: false, head: '{"type":"user","timest', tail: `{"type":"assist\n${claudeEnd}`, read: 10, size: 10 }))
    expect(agent.description).toBe('Background agent')
    expect(agent.status).toBe('done')
  })
})

const meta = (extra: Record<string, unknown>) => ({ type: 'session_meta', timestamp: stamp(30), payload: { id: 'c1', timestamp: stamp(30), cwd: 'C:\\work\\demo', parent_thread_id: 'root1', ...extra } })
const codexInput = (text: string, extra: Record<string, unknown> = {}) => ({ head: text, tail: '', whole: true, read: text.length, size: text.length, mtime: NOW - 60_000, now: NOW, ...extra })
const event = (minutes: number, payload: Record<string, unknown>) => ({ type: 'event_msg', timestamp: stamp(minutes), payload })
const tokens = (input: number, cached: number, output: number) => event(1, { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } })

describe('parseCodexAgent', () => {
  it('reads a guardian review thread as one automatic agent', () => {
    const text = lines(
      meta({ source: { subagent: { other: 'guardian' } }, thread_source: 'guardian_review' }),
      event(30, { type: 'task_started' }),
      event(29, { type: 'task_complete', last_agent_message: JSON.stringify({ risk_level: 'low', outcome: 'allow', rationale: 'Only lists files.' }) }),
      event(10, { type: 'task_started' }),
      tokens(1000, 800, 40),
      event(9, { type: 'task_complete', last_agent_message: JSON.stringify({ risk_level: 'low', outcome: 'allow', rationale: 'Reads a clip duration.' }) })
    )
    const agent = parseCodexAgent(codexInput(text))
    expect(agent).toMatchObject({ kind: 'codex', parentId: 'root1', type: 'guardian review', automatic: true, status: 'done', description: 'Safety review · allow · 2 checks', result: 'allow, risk low: Reads a clip duration.' })
    expect(agent?.usage).toEqual({ input: 200, output: 40, cacheWrite: 0, cacheRead: 800 })
  })

  it('reads a spawned agent: prompt as description, thread_spawn depth and running state', () => {
    const text = lines(
      meta({ source: { subagent: { thread_spawn: { parent_thread_id: 'root1', depth: 2, agent_nickname: 'Hubble' } } } }),
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write the migration test' }] } },
      event(2, { type: 'task_started' }),
      { type: 'response_item', timestamp: stamp(1), payload: { type: 'function_call', name: 'shell', arguments: '{"command":["npm","test"]}' } }
    )
    const agent = parseCodexAgent(codexInput(text, { now: NOW - 28 * 60_000 }))
    expect(agent).toMatchObject({ type: 'spawn_agent', automatic: false, depth: 2, description: 'Write the migration test', status: 'running', lastStep: 'shell npm test', endedAt: null })
  })

  it('fails on an aborted turn or an error event, and ignores ordinary sessions', () => {
    const base = meta({ source: { subagent: { thread_spawn: { parent_thread_id: 'root1' } } } })
    expect(parseCodexAgent(codexInput(lines(base, event(5, { type: 'task_started' }), event(4, { type: 'turn_aborted' }))))).toMatchObject({ status: 'failed', statusNote: 'Interrupted' })
    expect(parseCodexAgent(codexInput(lines(base, event(5, { type: 'task_started' }), event(4, { type: 'error', message: 'stream closed' }))))).toMatchObject({ status: 'failed', statusNote: 'stream closed' })
    expect(parseCodexAgent(codexInput(lines(meta({ source: 'vscode', parent_thread_id: undefined }))))).toBeNull()
  })
})

const agent = (over: Partial<BackgroundAgent>): BackgroundAgent => ({
  key: `claude:${over.id ?? 'a'}`, id: 'a', kind: 'claude', parentId: 'p1', parentTitle: 'Release polish', projectId: 'dawsha', projectLabel: 'Dawsha', description: 'Grid pass', type: 'general-purpose',
  automatic: false, model: null, depth: 1, parentAgentId: null, startedAt: NOW - 30 * 60_000, endedAt: NOW - 10 * 60_000, lastActivityAt: NOW - 10 * 60_000, status: 'done', statusNote: null,
  tokens: 1000, tokensApprox: false, costUsd: null, lastStep: '', result: '', ...over
})

describe('filters and lanes', () => {
  const list = [
    agent({ id: 'a', status: 'running', endedAt: null }),
    agent({ id: 'b', kind: 'codex', parentId: 'p2', parentTitle: 'Import', projectId: null, projectLabel: 'misc', description: 'Write test', type: 'spawn_agent', status: 'failed', lastActivityAt: NOW - 5 * 60_000 }),
    agent({ id: 'c', kind: 'codex', parentId: 'p2', parentTitle: 'Import', projectId: null, projectLabel: 'misc', type: 'guardian review', automatic: true, description: 'Safety review' })
  ]

  it('hides automatic reviews until asked and filters by every dimension', () => {
    expect(applyFilters(list, DEFAULT_BG_FILTERS).map((a) => a.id)).toEqual(['a', 'b'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, showAutomatic: true })).toHaveLength(3)
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, statuses: ['failed'] }).map((a) => a.id)).toEqual(['b'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, kinds: ['claude'] }).map((a) => a.id)).toEqual(['a'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, project: 'other' }).map((a) => a.id)).toEqual(['b'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, project: 'dawsha' }).map((a) => a.id)).toEqual(['a'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, query: ' IMPORT ' }).map((a) => a.id)).toEqual(['b'])
    expect(applyFilters(list, { ...DEFAULT_BG_FILTERS, query: 'spawn' }).map((a) => a.id)).toEqual(['b'])
  })

  it('keeps status counts steady while a status filter is on', () => {
    const filters = { ...DEFAULT_BG_FILTERS, statuses: ['failed' as const] }
    expect(statusCounts(applyFilters(list, filters, 'status'))).toEqual({ running: 1, done: 0, failed: 1 })
  })

  it('knows when filters are active', () => {
    expect(filtersActive(DEFAULT_BG_FILTERS)).toBe(false)
    expect(filtersActive({ ...DEFAULT_BG_FILTERS, range: '1h' })).toBe(true)
    expect(filtersActive({ ...DEFAULT_BG_FILTERS, query: '  ' })).toBe(false)
  })

  it('groups lanes by parent, newest activity first, and lists project options', () => {
    const lanes = buildLanes(list)
    expect(lanes.map((lane) => lane.key)).toEqual(['codex:p2', 'claude:p1'])
    expect(lanes[1].running).toBe(1)
    expect(projectOptions(list, [{ id: 'dawsha', name: 'Dawsha' }, { id: 'x', name: 'Unused' }])).toEqual([{ value: 'dawsha', label: 'Dawsha' }, { value: 'other', label: 'Other folders' }])
    expect(totalsOf([agent({ costUsd: 0.5 }), agent({ tokens: 10, tokensApprox: true })])).toEqual({ tokens: 1010, costUsd: 0.5, approx: true })
  })

  it('places bars on the axis, running bars up to now', () => {
    const window = axisWindow('1h', NOW)
    expect(window.nowPct).toBeCloseTo(95.24, 1)
    const done = barGeometry(agent({ startedAt: NOW - 30 * 60_000, endedAt: NOW - 15 * 60_000 }), window, NOW)
    expect(done.left).toBeCloseTo(((30 * 60_000) / (3_600_000 * 1.05)) * 100 * -1 + 100 * (3_600_000 / (3_600_000 * 1.05)), 3)
    const running = barGeometry(agent({ status: 'running', endedAt: null, startedAt: NOW - 3_600_000 * 5 }), window, NOW)
    expect(running.left).toBe(0)
    expect(running.width).toBeCloseTo(window.nowPct, 1)
    expect(axisTicks(window).length).toBeGreaterThanOrEqual(3)
    expect(axisTicks(window).length).toBeLessThanOrEqual(6)
    expect(barLabel(agent({ description: 'Grid pass' }), NOW)).toBe('Grid pass, general-purpose, done, 20m')
  })
})

describe('timeline ticks', () => {
  it('lands on round local times inside the window', () => {
    const start = Date.UTC(2026, 9, 12, 9, 17)
    const ticks = axisTicks({ start, end: start + 24 * 3_600_000, nowPct: 100 }, 0)
    expect(ticks.map((t) => new Date(t.at).toISOString().slice(11, 16))).toEqual(['12:00', '16:00', '20:00', '00:00', '04:00', '08:00'])
    expect(ticks.every((t) => t.pct > 0 && t.pct < 100)).toBe(true)
    const short = axisTicks({ start, end: start + 2 * 3_600_000, nowPct: 100 }, 0)
    expect(short.map((t) => new Date(t.at).toISOString().slice(11, 16))).toEqual(['09:20', '09:40', '10:00', '10:20', '10:40', '11:00'])
  })
})
