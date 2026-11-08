import { AGENT_NAMES, isAgent } from './agents'
import type { SessionPreset, TabAgent } from './types'

export const PRESET_NAME_MAX = 40
export const PRESET_PROMPT_MAX = 8000
export const MAX_PRESETS = 50

export function validatePresetName(name: string, presets: readonly SessionPreset[], exceptId?: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Enter a name for the preset.'
  if (trimmed.length > PRESET_NAME_MAX) return `Keep the name to ${PRESET_NAME_MAX} characters.`
  const taken = presets.some((item) => item.id !== exceptId && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  return taken ? 'A preset with that name already exists.' : null
}

export const addPreset = (presets: readonly SessionPreset[], preset: SessionPreset): SessionPreset[] =>
  presets.length >= MAX_PRESETS ? [...presets] : [...presets, preset]

export const renamePreset = (presets: readonly SessionPreset[], id: string, name: string): SessionPreset[] =>
  presets.map((item) => (item.id === id ? { ...item, name: name.trim() } : item))

export const removePreset = (presets: readonly SessionPreset[], id: string): SessionPreset[] => presets.filter((item) => item.id !== id)

const isTabAgent = (value: unknown): value is TabAgent => value === 'shell' || isAgent(value)

function sanitizeOne(item: unknown, projectIds: ReadonlySet<string>): SessionPreset | null {
  if (typeof item !== 'object' || item === null) return null
  const raw = item as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PRESET_NAME_MAX) : ''
  if (typeof raw.id !== 'string' || raw.id === '' || name === '') return null
  if (typeof raw.projectId !== 'string' || !projectIds.has(raw.projectId) || !isTabAgent(raw.agent)) return null
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.slice(0, PRESET_PROMPT_MAX) : ''
  return { id: raw.id, name, agent: raw.agent, projectId: raw.projectId, worktree: raw.worktree === true, prompt }
}

export function sanitizePresets(value: unknown, projectIds: ReadonlySet<string>): SessionPreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const presets: SessionPreset[] = []
  for (const item of value) {
    const preset = sanitizeOne(item, projectIds)
    if (!preset || seen.has(preset.id)) continue
    seen.add(preset.id)
    presets.push(preset)
  }
  return presets.slice(0, MAX_PRESETS)
}

export const presetCommandTitle = (preset: Pick<SessionPreset, 'name'>): string => `Start preset: ${preset.name}`

export function presetSummary(preset: SessionPreset, projectName: string | undefined): string {
  const where = projectName ? `in ${projectName}` : 'in a missing project'
  return [`${AGENT_NAMES[preset.agent]} ${where}`, preset.worktree ? 'new worktree' : null, preset.prompt.trim() !== '' ? 'first prompt' : null]
    .filter((part): part is string => part !== null)
    .join(', ')
}
