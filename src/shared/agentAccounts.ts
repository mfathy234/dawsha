export type AccountKind = 'account' | 'apiKey' | 'none'

export interface AgentAccount {
  email: string | null
  plan: string | null
  kind: AccountKind
}

export interface AgentAccounts {
  claude: AgentAccount
  codex: AgentAccount
  gemini: AgentAccount
}

export const NO_ACCOUNT: AgentAccount = { email: null, plan: null, kind: 'none' }

const PLANS: [RegExp, string][] = [
  [/enterprise/, 'Enterprise'],
  [/team/, 'Team'],
  [/max/, 'Max'],
  [/(^|[^a-z])pro($|[^a-z])/, 'Pro'],
  [/plus/, 'Plus'],
  [/free/, 'Free']
]

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

export function planName(value: unknown): string | null {
  const raw = text(value)?.toLowerCase()
  if (!raw) return null
  return PLANS.find(([pattern]) => pattern.test(raw))?.[1] ?? null
}

export function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null
  try {
    return asRecord(JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))))
  } catch {
    return null
  }
}

const SEAT_PLANS = ['Team', 'Enterprise']

/**
 * The plan of the signed-in Claude account, read only from its own oauthAccount fields: a team or enterprise
 * organization wins, then the subscription, then the rate-limit tier. Nothing from any other account.
 */
export function claudePlan(oauth: Record<string, unknown>): string | null {
  const seat = planName(oauth.organizationType)
  if (seat && SEAT_PLANS.includes(seat)) return seat
  return [oauth.subscriptionType, oauth.userRateLimitTier, oauth.organizationType].map(planName).find((name) => name !== null) ?? null
}

export function claudeAccount(config: unknown): AgentAccount {
  const oauth = asRecord(asRecord(config)?.oauthAccount)
  const email = text(oauth?.emailAddress)
  if (!oauth || !email) return NO_ACCOUNT
  return { email, plan: claudePlan(oauth), kind: 'account' }
}

export function codexAccount(auth: unknown): AgentAccount {
  const record = asRecord(auth)
  if (!record) return NO_ACCOUNT
  const claims = decodeJwtPayload(asRecord(record.tokens)?.id_token)
  const email = text(claims?.email)
  if (claims && email) return { email, plan: planName(asRecord(claims['https://api.openai.com/auth'])?.chatgpt_plan_type), kind: 'account' }
  const apiKey = String(record.auth_mode ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'apikey' || text(record.OPENAI_API_KEY) !== null
  return apiKey ? { email: null, plan: null, kind: 'apiKey' } : NO_ACCOUNT
}

export function geminiAccount(accounts: unknown): AgentAccount {
  const email = text(asRecord(accounts)?.active)
  return email ? { email, plan: null, kind: 'account' } : NO_ACCOUNT
}
