import { describe, expect, it } from 'vitest'
import { sessionUsage } from '../../src/shared/orch/sessionUsage'

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null }

const claudeLine = (id: string | null, requestId: string | null, usage: Record<string, number>): string =>
  JSON.stringify({ type: 'assistant', requestId, timestamp: '2026-10-16T10:00:00.000Z', message: { id, usage } })

describe('orchestrator session usage', () => {
  it('returns zeros for empty input on every runner', () => {
    for (const runner of ['claude', 'codex', 'gemini'] as const) {
      expect(sessionUsage(runner, '')).toEqual(zero)
      expect(sessionUsage(runner, 'not json\n{broken')).toEqual(zero)
    }
  })

  it('sums Claude assistant messages once per message id, keeping the final streamed numbers', () => {
    const text = [
      claudeLine('m1', 'r1', { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      claudeLine('m1', 'r1', { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      '{"type":"assistant","message":{"usage":',
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 999 } } }),
      claudeLine(null, 'r2', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 20 }),
      claudeLine(null, 'r2', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 20 })
    ].join('\n')
    expect(sessionUsage('claude', text)).toEqual({
      inputTokens: 15, outputTokens: 47, cacheReadTokens: 120, cacheWriteTokens: 50, reportedCostUsd: null
    })
  })

  it('uses the last cumulative Codex total_token_usage, not the sum', () => {
    const line = (total: Record<string, number> | null): string =>
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: total ? { total_token_usage: total } : null } })
    const text = [
      line(null),
      line({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 10 }),
      'garbage',
      line({ input_tokens: 3000, cached_input_tokens: 2500, output_tokens: 120, reasoning_output_tokens: 30 }),
      line(null)
    ].join('\n')
    expect(sessionUsage('codex', text)).toEqual({
      inputTokens: 500, outputTokens: 120, cacheReadTokens: 2500, cacheWriteTokens: 0, reportedCostUsd: null
    })
  })

  it('maps Gemini messages, de-duplicating by id and splitting cached input', () => {
    const msg = (id: string, tokens: Record<string, number>): Record<string, unknown> => ({ id, type: 'gemini', tokens })
    const file = JSON.stringify({
      sessionId: 's',
      messages: [
        { id: 'u', type: 'user' },
        msg('a', { input: 100, cached: 60, output: 10, thoughts: 5, tool: 2, total: 117 }),
        msg('a', { input: 100, cached: 60, output: 10, thoughts: 5, tool: 2, total: 117 }),
        msg('b', { input: 50, output: 4 })
      ]
    }, null, 2)
    const expected = { inputTokens: 90, outputTokens: 21, cacheReadTokens: 60, cacheWriteTokens: 0, reportedCostUsd: null }
    expect(sessionUsage('gemini', file)).toEqual(expected)
    const lines = [msg('a', { input: 100, cached: 60, output: 10, thoughts: 5, tool: 2 }), msg('b', { input: 50, output: 4 })]
      .map((m) => JSON.stringify(m)).join('\n')
    expect(sessionUsage('gemini', lines)).toEqual(expected)
  })
})
