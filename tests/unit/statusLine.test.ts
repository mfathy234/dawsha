import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatAge,
  formatCost,
  formatPercent,
  gauge,
  gaugeStage,
  modelFamily,
  newestWithLimits,
  parseStatusPayload,
  rateLimitLabel
} from '../../src/shared/statusLine'
import { formatChanges, parseShortstat } from '../../src/shared/gitChanges'
import { sessionWaiting } from '../../src/shared/sessionMatch'
import { codexInfoFromTail } from '../../src/shared/codexSession'

const fixture = readFileSync(join(__dirname, 'fixtures', 'statusline-payload.json'), 'utf8')

describe('parseStatusPayload (captured Claude Code 2.1.294 payload)', () => {
  it('reads session, model, cost, context and rate limits', () => {
    const info = parseStatusPayload(fixture, 1_000)
    expect(info).toMatchObject({
      sessionId: 'ae9082cf-4451-411e-845b-65cf4e620014',
      modelId: 'claude-opus-5-5[1m]',
      modelName: 'Opus 5.5',
      family: 'opus',
      cwd: 'C:\\Work\\Example',
      contextPercent: 7,
      receivedAt: 1_000
    })
    expect(info?.costUsd).toBeCloseTo(0.3422, 3)
    expect(info?.rateLimits).toEqual([
      { key: 'five_hour', label: '5h', percent: 9, resetsAt: 1791486600000 },
      { key: 'seven_day', label: 'week', percent: 54, resetsAt: 1791720000000 }
    ])
  })

  it('tolerates missing optional fields and ignores unknown ones', () => {
    const info = parseStatusPayload(JSON.stringify({ session_id: 'abc', brand_new: { x: 1 } }), 5)
    expect(info).toMatchObject({ sessionId: 'abc', modelName: null, costUsd: null, contextPercent: null, rateLimits: [] })
  })

  it('rejects junk and payloads without a session id', () => {
    expect(parseStatusPayload('not json', 1)).toBeNull()
    expect(parseStatusPayload('[]', 1)).toBeNull()
    expect(parseStatusPayload('{"model":{"id":"x"}}', 1)).toBeNull()
  })

  it('keeps per-model windows after the two main ones and clamps percentages', () => {
    const info = parseStatusPayload(
      JSON.stringify({
        session_id: 's',
        rate_limits: {
          seven_day_opus: { used_percentage: 130, resets_at: 1791720000 },
          seven_day: { used_percentage: 10 },
          five_hour: { used_percentage: 1 },
          broken: { used_percentage: 'x' }
        }
      }),
      1
    )
    expect(info?.rateLimits.map((w) => [w.label, w.percent])).toEqual([
      ['5h', 1],
      ['week', 10],
      ['week opus', 100]
    ])
    expect(rateLimitLabel('seven_day_sonnet')).toBe('week sonnet')
  })
})

describe('model family, gauge and formatting', () => {
  it('maps model ids to families', () => {
    expect(modelFamily('claude-opus-5-5[1m]')).toBe('opus')
    expect(modelFamily('Sonnet 4.5')).toBe('sonnet')
    expect(modelFamily('claude-haiku-4-5')).toBe('haiku')
    expect(modelFamily('claude-fable-1')).toBe('fable')
    expect(modelFamily('gpt-5.6-sol')).toBe('codex')
    expect(modelFamily('mystery')).toBe('other')
    expect(modelFamily(null)).toBe('other')
  })

  it('draws a five cell gauge and picks a stage', () => {
    expect(gauge(0)).toBe('▱▱▱▱▱')
    expect(gauge(41)).toBe('▰▰▱▱▱')
    expect(gauge(62)).toBe('▰▰▰▱▱')
    expect(gauge(100)).toBe('▰▰▰▰▰')
    expect(gauge(250)).toBe('▰▰▰▰▰')
    expect(gaugeStage(10)).toBe('ok')
    expect(gaugeStage(69)).toBe('ok')
    expect(gaugeStage(70)).toBe('warn')
    expect(gaugeStage(79)).toBe('warn')
    expect(gaugeStage(80)).toBe('high')
    expect(gaugeStage(95)).toBe('critical')
  })

  it('formats cost, percent and age', () => {
    expect(formatCost(1.2)).toBe('$1.20')
    expect(formatCost(0.3422)).toBe('$0.34')
    expect(formatPercent(40.6)).toBe('41%')
    expect(formatAge(4_000)).toBe('4s')
    expect(formatAge(3 * 60_000)).toBe('3m')
    expect(formatAge(5 * 3_600_000)).toBe('5h')
    expect(formatAge(72 * 3_600_000)).toBe('3d')
    expect(formatAge(-5)).toBe('0s')
  })

  it('picks the newest payload that has rate limits', () => {
    const a = parseStatusPayload(fixture, 100)!
    const b = parseStatusPayload(fixture, 200)!
    const none = { ...b, receivedAt: 900, rateLimits: [] }
    expect(newestWithLimits([a, none, b])).toBe(b)
    expect(newestWithLimits([none])).toBeNull()
  })
})

describe('git change counts', () => {
  it('parses git diff --shortstat', () => {
    expect(parseShortstat(' 5 files changed, 12 insertions(+), 3 deletions(-)')).toEqual({ files: 5, added: 12, removed: 3 })
    expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ files: 1, added: 1, removed: 0 })
    expect(parseShortstat('')).toEqual({ files: 0, added: 0, removed: 0 })
  })

  it('formats the count', () => {
    expect(formatChanges({ files: 5, added: 12, removed: 3 })).toBe('+12 −3 · 5 files')
    expect(formatChanges({ files: 1, added: 1, removed: 0 })).toBe('+1 −0 · 1 file')
    expect(formatChanges({ files: 0, added: 0, removed: 0 })).toBe('no changes')
  })
})

describe('session registry waiting status', () => {
  const base = { pid: 1, sessionId: 's', cwd: 'C:\\x' }
  it('flags statuses that mean waiting but not busy or idle', () => {
    expect(sessionWaiting({ ...base, status: 'waiting' })).toBe(true)
    expect(sessionWaiting({ ...base, status: 'needs_permission' })).toBe(true)
    expect(sessionWaiting({ ...base, status: 'busy' })).toBe(false)
    expect(sessionWaiting({ ...base, status: 'idle' })).toBe(false)
    expect(sessionWaiting(undefined)).toBe(false)
  })
})

describe('codexInfoFromTail', () => {
  const turn = JSON.stringify({ type: 'turn_context', payload: { cwd: 'C:\\x', model: 'gpt-5.6-sol' } })
  const count = (used: number): string =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 99999 }, last_token_usage: { input_tokens: 1, total_tokens: used }, model_context_window: 200000 }
      }
    })

  it('reads the model and the context share of the latest token count', () => {
    expect(codexInfoFromTail([turn, count(10000), count(50000)].join('\n'))).toEqual({
      model: 'gpt-5.6-sol',
      contextPercent: 25
    })
  })

  it('returns nothing when the tail has no such events', () => {
    expect(codexInfoFromTail('{"type":"event_msg","payload":{"type":"task_started"}}')).toEqual({})
  })
})
