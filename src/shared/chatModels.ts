import type { TabAgent } from './types'

export interface ModelChoice {
  id: string
  label: string
  hint?: string
}

/** Used when the agent has not been asked for its own list. Claude Code accepts these aliases in /model. */
export const CLAUDE_MODELS: readonly ModelChoice[] = [
  { id: 'opus', label: 'Opus', hint: 'default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]

export const CLAUDE_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const CODEX_MODEL_COMMAND = '/model'

export const canPickModel = (agent: TabAgent): boolean => agent === 'claude' || agent === 'codex'

/** Codex has no argument form: /model opens its own picker, which chat then draws. */
export const choosesInPicker = (agent: TabAgent): boolean => agent === 'codex'

export function modelChoices(agent: TabAgent): readonly ModelChoice[] {
  return agent === 'claude' ? CLAUDE_MODELS : []
}

export function effortLevels(agent: TabAgent): readonly string[] {
  return agent === 'claude' ? CLAUDE_EFFORTS : []
}

/** The choice a model name such as "Opus 5.5" or "claude-sonnet-5-5" belongs to. */
export function currentChoice(agent: TabAgent, modelName: string | null): ModelChoice | null {
  if (!modelName) return null
  const lower = modelName.toLowerCase()
  return modelChoices(agent).find((choice) => lower.includes(choice.id)) ?? null
}

export function modelCommand(agent: TabAgent, id: string): string {
  return agent === 'claude' ? `/model ${id}` : CODEX_MODEL_COMMAND
}

export function effortCommand(agent: TabAgent, level: string): string {
  return agent === 'claude' ? `/effort ${level}` : CODEX_MODEL_COMMAND
}

/** "Opus 5.5 · medium": the model, then the effort once it is known. */
export const modelLine = (model: string | null, effort: string | null): string => [model ?? 'Model', effort].filter((part) => part !== null && part !== '').join(' · ')

export const modelSetText = (model: string, effort: string | null): string => `Model set to ${modelLine(model, effort)}`

export const MODEL_LOCKED_TIP = 'Changes after this reply'
export const MODEL_FOOT = 'Applies from your next message'
