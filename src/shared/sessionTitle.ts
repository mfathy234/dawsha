import { agentLabel } from './agents'
import type { TabAgent } from './types'

const MAX_CHARS = 48
const MAX_WORDS = 6
const TRAILING = /[\p{P}\p{S}\s]+$/u
const OPENING = /^(?:(?:can|could|would|will) you\b|please\b|i (?:need|want)(?: you)? to\b|help me\b|(?:based on (?:stage|staging|main|master)\s+)?(?:read|review|inspect) (?:this|the) repo(?:sitory)?\b)[\s,:-]*/i

/** Words a title must not end on: "Refactor the invoice export so the" reads as cut off. */
const FILLER_END = /\s+(?:the|a|an|and|or|but|so|with|to|for|of|in|on|at|by|from|as|is|are|was|that|this|these|those|it|its|my|our|your|their|into|onto|than|then|when|while|which|who|because|since|after|before|instead)$/i
/** A clause break: what comes after explains or extends the request, so the title stops before it. */
const CLAUSE_BREAK = /\s*(?:,|;|:|\s(?:so that|so|because|since|which|that|when|while|where|but|instead of|then)\s)/i

function trimEnd(text: string): string {
  let previous = ''
  let current = text.replace(TRAILING, '')
  while (current !== previous) { previous = current; current = current.replace(FILLER_END, '').replace(TRAILING, '') }
  return current
}

function fit(text: string, maxChars = MAX_CHARS, maxWords = MAX_WORDS): string | null {
  const words = text.trim().split(/\s+/).slice(0, maxWords)
  const kept: string[] = []
  for (const word of words) {
    if ([...kept, word].join(' ').length > maxChars) break
    kept.push(word)
  }
  return trimEnd(kept.join(' ')) || null
}

/** The main clause, when what is before the first clause break is long enough to stand alone. */
function mainClause(text: string): string {
  const match = CLAUSE_BREAK.exec(text)
  if (!match) return text
  const head = text.slice(0, match.index).trim()
  return head.split(/\s+/).length >= 2 ? head : text
}

/** A bounded local summary, never sent to an agent. Original text is kept by the caller. */
export function shortSessionTitle(prompt: string): string | null {
  // A report filename can supply the missing object in "fix every finding" without exposing its path.
  const report = /(?:^|[\\/])([\w-]+report)\.(?:html?|md|pdf)\b/i.exec(prompt)?.[1]?.replace(/[-_]/g, ' ')
  let text = prompt.slice(0, 96_000)
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`]*(?:`|$)/g, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”|(?<!\p{L})'[^'\n]*'(?!\p{L})/gu, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+|(?:^|\s)(?:\.{1,2}\/|~?\/)[^\s<>"']+/gi, ' ')
    .replace(/\b[\w.-]+(?:[\\/][\w.@-]+)+\b/g, ' ')
    .replace(/^\s*(?:[#>*+-]\s*)+/gm, '')
    .replace(/\s+/g, ' ').trim()
  let previous = ''
  while (text !== previous) { previous = text; text = text.replace(OPENING, '').trim() }
  text = text.replace(/^(?:and\s+)+/i, '')
  // Context-reading clauses should not hide the requested change.
  text = text.replace(/^(?:inspect|read|review|look at)\b.*?\band\s+(?=(?:fix|add|update|remove|implement|build|test)\b)/i, '')
  if (report) text = text.replace(/\b(every|all) findings?\b/i, `$1 ${report} finding`)
  text = text.split(/[.!?](?:\s|$)|[\r\n]/)[0].trim()
  // "The login test in the web app is flaky" -> "Login test in the web app".
  text = mainClause(text.replace(/^(?:the|a|an|also|so)\s+/i, ''))
  text = trimEnd(text)
  if (!/[\p{L}\p{N}]/u.test(text)) return null
  const title = fit(text)
  return title ? title[0].toLocaleUpperCase() + title.slice(1) : null
}

export interface SessionTitleInput {
  name?: string
  nameSource?: string
  firstPrompt?: string
  renamed?: string
  agent?: TabAgent
  fallback?: string
  index: number
}

export function resolveSessionTitle(input: SessionTitleInput): { title: string; fullTitle: string; renameText: string; named: boolean; manual: boolean } {
  const name = input.name?.trim() ?? ''
  const manual = Boolean(input.renamed || (name && input.nameSource === 'user'))
  const explicit = input.renamed || (manual ? input.name : '')
  const fullTitle = input.firstPrompt || explicit || (input.nameSource !== 'derived' ? name : '') || ''
  const isAgentName = name && input.nameSource !== 'derived' && input.nameSource !== 'prompt' && input.nameSource !== 'transcript'
  const shortName = isAgentName && name.length <= MAX_CHARS && name.split(/\s+/).length <= MAX_WORDS
  const inferred = shortName ? name : shortSessionTitle(input.firstPrompt || (input.nameSource !== 'derived' ? name : '') || '')
  const agent = input.agent ?? 'claude'
  const hasSource = Boolean(input.firstPrompt || (input.nameSource !== 'derived' ? name : ''))
  const title = explicit || inferred || (!hasSource && input.fallback) || `${agent === 'shell' ? 'Terminal' : agent === 'claude' ? 'Claude' : agentLabel(agent)} session ${input.index}`
  const renameText = explicit || (shortName ? name : fullTitle) || title
  return { title, fullTitle: fullTitle || title, renameText, named: Boolean(explicit || inferred), manual }
}

export interface UniqueTitleEntry {
  projectId: string
  title: string
  manual: boolean
  /** A stand-in name (the project, or "Claude session N"): the pane number already tells these apart. */
  fallback?: boolean
  /** A stable rank (start time, then id) so suffixes follow the session, not its position in the grid. */
  order?: readonly [number, string]
}

const byOrder = (a: UniqueTitleEntry, b: UniqueTitleEntry, ia: number, ib: number): number => {
  if (!a.order || !b.order) return ia - ib
  return a.order[0] - b.order[0] || (a.order[1] < b.order[1] ? -1 : a.order[1] > b.order[1] ? 1 : 0) || ia - ib
}

/** Reserve literal manual names before assigning suffixes, scoped to each project. */
export function uniqueSessionTitles(entries: readonly UniqueTitleEntry[]): string[] {
  const used = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!used.has(entry.projectId)) used.set(entry.projectId, new Set())
    if (entry.manual) used.get(entry.projectId)!.add(entry.title)
  }
  const result = entries.map(entry => entry.title)
  const inferred = entries.map((entry, index) => index).filter(index => !entries[index].manual && !entries[index].fallback)
  inferred.sort((a, b) => byOrder(entries[a], entries[b], a, b))
  for (const index of inferred) {
    const entry = entries[index]
    const project = used.get(entry.projectId)!
    let title = entry.title
    let suffix = 1
    while (project.has(title)) {
      const number = ` ${++suffix}`
      title = `${fit(entry.title, MAX_CHARS - number.length, MAX_WORDS - 1) ?? 'Session'}${number}`
    }
    project.add(title)
    result[index] = title
  }
  return result
}
