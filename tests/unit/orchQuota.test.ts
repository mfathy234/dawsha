import { describe, expect, it } from 'vitest'
import { detectLimit, stripAnsi } from '../../src/shared/orch/quota'

describe('stripAnsi', () => {
  it('removes colour, cursor and OSC sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m \x1b[2K\x1b[1Gok \x1b]0;title\x07done')).toBe('red ok done')
  })
})

describe('detectLimit claude', () => {
  it('reads the legacy usage limit banner with a reset time', () => {
    const hit = detectLimit('claude', 'Claude usage limit reached. Your limit will reset at 5pm (Africa/Cairo).')
    expect(hit).toMatchObject({ kind: 'usage-limit', resetsAt: '5pm' })
  })
  it('reads the 5-hour banner through ANSI and box drawing', () => {
    const hit = detectLimit('claude', '\x1b[1m│\x1b[0m 5-hour limit reached ∙ resets 3pm │\r\n')
    expect(hit).toMatchObject({ kind: 'usage-limit', resetsAt: '3pm' })
    expect(hit?.message).toBe('5-hour limit reached ∙ resets 3pm')
  })
  it('reads the hit-your-limit banner with a date reset', () => {
    const hit = detectLimit('claude', "You've hit your limit · resets Oct 17 at 9am\n/upgrade to increase your usage limit.")
    expect(hit).toMatchObject({ kind: 'usage-limit', resetsAt: 'Oct 17 at 9am' })
  })
  it('detects API 429 and rate_limit_error', () => {
    expect(detectLimit('claude', '  ⎿  API Error: 429 {"type":"error"}')?.kind).toBe('rate-limit')
    expect(detectLimit('claude', '{"type":"rate_limit_error","message":"slow down"}')?.kind).toBe('rate-limit')
  })
  it('detects low credit balance as quota', () => {
    expect(detectLimit('claude', 'Credit balance is too low')?.kind).toBe('quota')
  })
  it('detects auth failures', () => {
    expect(detectLimit('claude', 'Invalid API key · Please run /login')).toMatchObject({ kind: 'auth', resetsAt: null })
  })
})

describe('detectLimit codex', () => {
  it('reads the usage limit with a relative retry', () => {
    const hit = detectLimit('codex', "■ You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 2 days 20 hours 44 minutes.")
    expect(hit).toMatchObject({ kind: 'usage-limit', resetsAt: '2 days 20 hours 44 minutes' })
  })
  it('reads an absolute retry time', () => {
    expect(detectLimit('codex', "You've hit your usage limit. Try again at 5:30 PM.")?.resetsAt).toBe('5:30 PM')
  })
  it('reads the retry exhaustion stream error', () => {
    expect(detectLimit('codex', 'stream error: exceeded retry limit, last status: 429 Too Many Requests')?.kind).toBe('rate-limit')
  })
  it('reads quota exceeded', () => {
    expect(detectLimit('codex', 'Quota exceeded. Check your plan and billing details.')?.kind).toBe('quota')
  })
})

describe('detectLimit gemini', () => {
  it('reads the quota metric error', () => {
    const hit = detectLimit('gemini', '[API Error: Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit]')
    expect(hit?.kind).toBe('quota')
  })
  it('reads exhausted capacity with a reset duration', () => {
    const hit = detectLimit('gemini', 'You have exhausted your capacity on this model. Your quota will reset after 3h20m5s.')
    expect(hit).toMatchObject({ kind: 'quota', resetsAt: '3h20m5s' })
  })
  it('reads a 429 resource exhausted API error', () => {
    expect(detectLimit('gemini', '[API Error: got status: 429 Too Many Requests. RESOURCE_EXHAUSTED]')?.kind).toBe('rate-limit')
  })
  it('reads the daily quota message', () => {
    expect(detectLimit('gemini', 'You have reached your daily quota limit.')?.kind).toBe('quota')
  })
  it('treats the model fallback notice as no hit', () => {
    const notice = 'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model for the rest of this session.'
    expect(detectLimit('gemini', notice)).toBeNull()
  })
})

describe('detectLimit false positives', () => {
  const prose = [
    "I'll add a rate limit check before the request.",
    'if (rateLimit > 429) { throw new Error("too many") }',
    'const status = 429 // too many requests',
    'The usage limit reached state should render a banner.',
    'Handle RESOURCE_EXHAUSTED by retrying with backoff.',
    'export class QuotaExceededError extends Error {}',
    'Please run /login if the token expires.',
    '$ npm test\n 12 passed (3s)'
  ]
  for (const line of prose) {
    for (const runner of ['claude', 'codex', 'gemini'] as const) {
      it(`${runner} ignores: ${line.slice(0, 40)}`, () => {
        expect(detectLimit(runner, line)).toBeNull()
      })
    }
  }
  it('returns null for empty text', () => {
    expect(detectLimit('claude', '')).toBeNull()
  })
  it('does not apply another CLI banner', () => {
    expect(detectLimit('gemini', "You've hit your usage limit.")).toBeNull()
  })
  it('caps the message at 200 chars', () => {
    const hit = detectLimit('claude', `5-hour limit reached ${'x'.repeat(400)}`)
    expect(hit?.message.length).toBe(200)
  })
})
