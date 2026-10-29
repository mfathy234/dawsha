import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { claudeAccount, codexAccount, geminiAccount, NO_ACCOUNT, type AgentAccount, type AgentAccounts } from '../shared/agentAccounts'
import { codexHome, geminiHome } from './agentLaunch'
import { claudeHome } from './paths'

const CACHE_MS = 60_000

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function safe(read: () => Promise<AgentAccount>): Promise<AgentAccount> {
  try {
    return await read()
  } catch {
    return NO_ACCOUNT
  }
}

function claudeConfigPaths(): string[] {
  const configDir = process.env.DAWSHA_CLAUDE_HOME ? undefined : process.env.CLAUDE_CONFIG_DIR
  const home = claudeHome()
  return [...(configDir ? [join(configDir, '.claude.json')] : []), join(home, '.claude.json'), join(dirname(home), '.claude.json')]
}

async function readClaude(): Promise<AgentAccount> {
  for (const path of claudeConfigPaths()) {
    const account = claudeAccount(await readJson(path))
    if (account.kind !== 'none') return account
  }
  return NO_ACCOUNT
}

export async function readAgentAccounts(): Promise<AgentAccounts> {
  const [claude, codex, gemini] = await Promise.all([
    safe(readClaude),
    safe(async () => codexAccount(await readJson(join(codexHome(), 'auth.json')))),
    safe(async () => geminiAccount(await readJson(join(geminiHome(), 'google_accounts.json'))))
  ])
  return { claude, codex, gemini }
}

export function createAgentAccountsReader(read: () => Promise<AgentAccounts> = readAgentAccounts, now: () => number = Date.now): () => Promise<AgentAccounts> {
  let cached: { at: number; value: AgentAccounts } | null = null
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.value
    const value = await read()
    cached = { at: now(), value }
    return value
  }
}
