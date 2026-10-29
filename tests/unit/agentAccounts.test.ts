import { describe, expect, it } from 'vitest'
import { claudeAccount, codexAccount, decodeJwtPayload, geminiAccount, planName } from '../../src/shared/agentAccounts'

const jwt = (payload: unknown): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

describe('decodeJwtPayload', () => {
  it('reads the payload without verifying', () => {
    expect(decodeJwtPayload(jwt({ email: 'a@b.c' }))).toEqual({ email: 'a@b.c' })
  })
  it('returns null for malformed input', () => {
    expect(decodeJwtPayload('nope')).toBeNull()
    expect(decodeJwtPayload('a.%%%.c')).toBeNull()
    expect(decodeJwtPayload(`a.${Buffer.from('[1]').toString('base64url')}.c`)).toBeNull()
    expect(decodeJwtPayload(42)).toBeNull()
  })
})

describe('planName', () => {
  it('maps well-known values and drops unknown ones', () => {
    expect(planName('max')).toBe('Max')
    expect(planName('claude_max_20x')).toBe('Max')
    expect(planName('default_claude_pro')).toBe('Pro')
    expect(planName('plus')).toBe('Plus')
    expect(planName('Enterprise')).toBe('Enterprise')
    expect(planName('mystery-tier')).toBeNull()
    expect(planName(undefined)).toBeNull()
  })
})

describe('claudeAccount', () => {
  it('reads email and plan', () => {
    expect(claudeAccount({ oauthAccount: { emailAddress: 'you@example.com', userRateLimitTier: 'default_claude_max_5x' } })).toEqual({ email: 'you@example.com', plan: 'Max', kind: 'account' })
  })
  it('shows no plan when unknown, none when absent', () => {
    expect(claudeAccount({ oauthAccount: { emailAddress: 'you@example.com', organizationType: 'weird' } }).plan).toBeNull()
    expect(claudeAccount({}).kind).toBe('none')
    expect(claudeAccount(null).kind).toBe('none')
  })
})

describe('codexAccount', () => {
  it('reads email and plan claim from the id token', () => {
    const id_token = jwt({ email: 'you@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })
    expect(codexAccount({ tokens: { id_token } })).toEqual({ email: 'you@example.com', plan: 'Plus', kind: 'account' })
  })
  it('handles a missing claim', () => {
    expect(codexAccount({ tokens: { id_token: jwt({ email: 'x@y.z' }) } })).toEqual({ email: 'x@y.z', plan: null, kind: 'account' })
  })
  it('handles a malformed token', () => {
    expect(codexAccount({ tokens: { id_token: 'garbage' } }).kind).toBe('none')
  })
  it('handles API key mode', () => {
    expect(codexAccount({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-secret' })).toEqual({ email: null, plan: null, kind: 'apiKey' })
    expect(codexAccount({ OPENAI_API_KEY: 'sk-secret' }).kind).toBe('apiKey')
  })
  it('handles nothing', () => {
    expect(codexAccount(null).kind).toBe('none')
  })
})

describe('geminiAccount', () => {
  it('reads the active account', () => {
    expect(geminiAccount({ active: 'g@example.com' })).toEqual({ email: 'g@example.com', plan: null, kind: 'account' })
  })
  it('is none when missing or blank', () => {
    expect(geminiAccount({ active: '' }).kind).toBe('none')
    expect(geminiAccount(null).kind).toBe('none')
  })
})
