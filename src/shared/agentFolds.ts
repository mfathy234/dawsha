import type { BgSessionGroup } from './backgroundAgents'

/** Fold choices the user made, by session key: true is open, false is folded. Groups without a choice use their default. */
export type FoldMap = Readonly<Record<string, boolean>>

type FoldFacts = Pick<BgSessionGroup, 'sessionKey' | 'running' | 'failed'>
type SummaryFacts = Pick<BgSessionGroup, 'running' | 'failed' | 'done' | 'agents'>

export const MAX_FOLDS = 400

export interface SummaryPart {
  text: string
  /** The failed count takes the needs colour; the rest is plain metadata. */
  tone: 'plain' | 'needs'
}

/** Groups with a running or failed agent open by default; finished-only groups fold to one line. */
export const defaultOpen = (group: Pick<BgSessionGroup, 'running' | 'failed'>): boolean => group.running > 0 || group.failed > 0

export const isGroupOpen = (group: FoldFacts, folds: FoldMap): boolean => folds[group.sessionKey] ?? defaultOpen(group)

/** "31 agents · 31 done", "2 agents · 1 failed · 1 done". */
export function groupSummary(group: SummaryFacts): SummaryPart[] {
  const total = group.agents.length
  const parts: SummaryPart[] = [{ text: `${total} agent${total === 1 ? '' : 's'}`, tone: 'plain' }]
  if (group.running > 0) parts.push({ text: `${group.running} running`, tone: 'plain' })
  if (group.failed > 0) parts.push({ text: `${group.failed} failed`, tone: 'needs' })
  if (group.done > 0) parts.push({ text: `${group.done} done`, tone: 'plain' })
  return parts
}

export const summaryText = (group: SummaryFacts): string => groupSummary(group).map((part) => part.text).join(' · ')

export function setFold(folds: FoldMap, sessionKey: string, open: boolean): FoldMap {
  const { [sessionKey]: _dropped, ...rest } = folds
  const kept = Object.entries(rest).slice(-(MAX_FOLDS - 1))
  return Object.fromEntries([...kept, [sessionKey, open]])
}

/** Opens or folds every group shown, keeping the choices made for groups that are not on screen. */
export function setAllFolds(folds: FoldMap, groups: readonly FoldFacts[], open: boolean): FoldMap {
  return groups.reduce<FoldMap>((next, group) => setFold(next, group.sessionKey, open), folds)
}

export function parseFolds(raw: unknown): FoldMap {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean').slice(-MAX_FOLDS))
  } catch {
    return {}
  }
}

export const allOpen = (groups: readonly FoldFacts[], folds: FoldMap): boolean => groups.every((group) => isGroupOpen(group, folds))
export const allFolded = (groups: readonly FoldFacts[], folds: FoldMap): boolean => groups.every((group) => !isGroupOpen(group, folds))
