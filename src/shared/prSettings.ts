import { DEFAULT_MERGE_COMMAND } from './prWatch'

/** What Dawsha does for the pull requests of one project. Off by default. */
export interface PrProjectSettings {
  /** The merge command for Merge when green, in gh form; empty means the default. */
  mergeCommand: string
  /** The person confirmed this command once for this project. */
  mergeConfirmed: boolean
  /** Close the session and remove its worktree when its pull request is merged or closed. */
  tidyUp: boolean
}

/** Per project id. */
export type PrSettings = Record<string, PrProjectSettings>

export const DEFAULT_PR_PROJECT: PrProjectSettings = { mergeCommand: '', mergeConfirmed: false, tidyUp: false }
export const MERGE_COMMAND_MAX = 200

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function sanitizePrSettings(value: unknown, projectIds: ReadonlySet<string>): PrSettings {
  if (!isRecord(value)) return {}
  const result: PrSettings = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!projectIds.has(id) || !isRecord(raw)) continue
    const command = typeof raw.mergeCommand === 'string' ? raw.mergeCommand.replace(/\s+/g, ' ').trim().slice(0, MERGE_COMMAND_MAX) : ''
    const entry: PrProjectSettings = { mergeCommand: command, mergeConfirmed: raw.mergeConfirmed === true, tidyUp: raw.tidyUp === true }
    result[id] = entry
  }
  return result
}

export const prProjectSettings = (settings: PrSettings, projectId: string): PrProjectSettings => settings[projectId] ?? DEFAULT_PR_PROJECT

export const effectiveMergeCommand = (settings: PrProjectSettings): string => settings.mergeCommand === '' ? DEFAULT_MERGE_COMMAND : settings.mergeCommand
