import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readClaudeAccount } from '../../src/main/agentAccounts'

const KEYS = ['USERPROFILE', 'DAWSHA_CLAUDE_HOME', 'CLAUDE_CONFIG_DIR'] as const

const config = (email: string, tier = 'default_claude_max_5x'): string =>
  JSON.stringify({ oauthAccount: { emailAddress: email, userRateLimitTier: tier } })

describe('readClaudeAccount', () => {
  let root: string
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dawsha-claude-account-'))
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
    mkdirSync(join(root, '.claude'), { recursive: true })
    process.env.USERPROFILE = root
    delete process.env.DAWSHA_CLAUDE_HOME
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('prefers the home config Claude Code writes over a stale legacy copy', async () => {
    writeFileSync(join(root, '.claude', '.claude.json'), config('old@example.com', 'default_claude_pro'), 'utf8')
    writeFileSync(join(root, '.claude.json'), config('new@example.com'), 'utf8')
    expect(await readClaudeAccount()).toEqual({ email: 'new@example.com', plan: 'Max', kind: 'account' })
  })

  it('uses the legacy copy only when no other config has an account', async () => {
    writeFileSync(join(root, '.claude', '.claude.json'), config('old@example.com', 'default_claude_pro'), 'utf8')
    expect(await readClaudeAccount()).toEqual({ email: 'old@example.com', plan: 'Pro', kind: 'account' })
  })

  it('lets CLAUDE_CONFIG_DIR win over the home config', async () => {
    const configDir = join(root, 'config-dir')
    mkdirSync(configDir)
    writeFileSync(join(configDir, '.claude.json'), config('configured@example.com', 'default_claude_pro'), 'utf8')
    writeFileSync(join(root, '.claude.json'), config('home@example.com'), 'utf8')
    process.env.CLAUDE_CONFIG_DIR = configDir
    expect(await readClaudeAccount()).toEqual({ email: 'configured@example.com', plan: 'Pro', kind: 'account' })
  })

  it('ignores CLAUDE_CONFIG_DIR in test mode', async () => {
    const configDir = join(root, 'config-dir')
    mkdirSync(configDir)
    writeFileSync(join(configDir, '.claude.json'), config('configured@example.com'), 'utf8')
    process.env.DAWSHA_CLAUDE_HOME = join(root, '.claude')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(join(root, '.claude', '.claude.json'), config('sandbox@example.com'), 'utf8')
    expect((await readClaudeAccount()).email).toBe('sandbox@example.com')
  })

  it('reports no account when no config exists', async () => {
    expect(await readClaudeAccount()).toEqual({ email: null, plan: null, kind: 'none' })
  })
})
