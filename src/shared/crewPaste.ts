import type { CrewMember, PastePattern } from './crew'

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{32}\b/i
const ENV_ON = /\bon\s+(dev|stage|staging|uat|preprod)\b/i
const ENV_ANY = /\b(dev|stage|staging|uat|preprod)\b/i
const PR_URL = /https?:\/\/[^\s]+?\/(?:pullrequest|pull)\/(\d+)[^\s]*/i
const PR_WORD = /\bPR\s*#?\s*(\d+)\b/i
const BUILD_URL = /https?:\/\/[^\s]*(?:_build|\/pipelines\/|\/actions\/runs\/|buildId=|\/builds\/)[^\s]*/i
const ANY_URL = /https?:\/\/[^\s]+/i

export interface PasteFacts {
  guid: string | null
  env: string | null
  prNumber: string | null
  prUrl: string | null
  buildUrl: string | null
  url: string | null
}

const normaliseEnv = (value: string): string => (value.toLowerCase() === 'staging' ? 'stage' : value.toLowerCase())

export function readPaste(text: string): PasteFacts {
  const prUrl = PR_URL.exec(text)
  const prWord = PR_WORD.exec(text)
  const env = ENV_ON.exec(text) ?? ENV_ANY.exec(text)
  return {
    guid: GUID.exec(text)?.[0] ?? null,
    env: env ? normaliseEnv(env[1]) : null,
    prNumber: prUrl?.[1] ?? prWord?.[1] ?? null,
    prUrl: prUrl?.[0] ?? null,
    buildUrl: BUILD_URL.exec(text)?.[0] ?? null,
    url: ANY_URL.exec(text)?.[0] ?? null
  }
}

export interface PasteHit {
  member: CrewMember
  fields: Record<string, string>
  score: number
  why: string
}

function apply(pattern: PastePattern, facts: PasteFacts): { fields: Record<string, string>; score: number; why: string } | null {
  switch (pattern.kind) {
    case 'guid': {
      if (!facts.guid) return null
      const fields: Record<string, string> = { [pattern.field]: facts.guid }
      if (pattern.envField && facts.env) fields[pattern.envField] = facts.env
      return { fields, score: facts.env && pattern.envField ? 4 : 3, why: facts.env ? `an id on ${facts.env}` : 'an id' }
    }
    case 'pr': {
      if (!facts.prNumber) return null
      const value = facts.prUrl ?? (/^(pr|pull)/i.test(pattern.field) ? facts.prNumber : `PR ${facts.prNumber}`)
      return { fields: { [pattern.field]: value }, score: 3, why: `PR ${facts.prNumber}` }
    }
    case 'build':
      return facts.buildUrl ? { fields: { [pattern.field]: facts.buildUrl }, score: 3, why: 'a build link' } : null
    case 'url':
      return facts.url ? { fields: { [pattern.field]: facts.url }, score: 1, why: 'a link' } : null
  }
}

/** Members whose paste patterns recognise the text, best match first, with the fields already filled in. */
export function matchPaste(text: string, members: readonly CrewMember[]): PasteHit[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const facts = readPaste(trimmed)
  const hits: PasteHit[] = []
  for (const member of members) {
    let score = 0
    const fields: Record<string, string> = {}
    const reasons: string[] = []
    for (const pattern of member.paste) {
      const result = apply(pattern, facts)
      if (!result) continue
      score += result.score
      Object.assign(fields, result.fields)
      reasons.push(result.why)
    }
    if (score > 0) hits.push({ member, fields, score, why: reasons.join(', ') })
  }
  return hits.sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name))
}
