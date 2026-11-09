import { rankCompletions } from './chatComplete'

export interface SavedPrompt {
  id: string
  name: string
  text: string
}

export const SAVED_PROMPTS_MAX = 50
export const SAVED_NAME_MAX = 60
export const SAVED_TEXT_MAX = 24_000
const SUGGEST_WORDS = 7
const SNIPPET_CHARS = 90

const keyOf = (name: string): string => name.trim().toLocaleLowerCase()

/** Reads the saved list from a settings file: whatever is not a named, non-empty prompt with its own id and name is dropped. */
export function sanitizeSavedPrompts(value: unknown): SavedPrompt[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  const names = new Set<string>()
  const out: SavedPrompt[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.text !== 'string') continue
    const id = raw.id.trim().slice(0, 80)
    const name = raw.name.trim().slice(0, SAVED_NAME_MAX)
    const text = raw.text.slice(0, SAVED_TEXT_MAX)
    if (id === '' || name === '' || text.trim() === '' || ids.has(id) || names.has(keyOf(name))) continue
    ids.add(id)
    names.add(keyOf(name))
    out.push({ id, name, text })
    if (out.length >= SAVED_PROMPTS_MAX) break
  }
  return out
}

export const addSavedPrompt = (list: readonly SavedPrompt[], prompt: SavedPrompt): SavedPrompt[] => [...list, prompt]

export const removeSavedPrompt = (list: readonly SavedPrompt[], id: string): SavedPrompt[] => list.filter((prompt) => prompt.id !== id)

export const renameSavedPrompt = (list: readonly SavedPrompt[], id: string, name: string): SavedPrompt[] =>
  list.map((prompt) => (prompt.id === id ? { ...prompt, name: name.trim().slice(0, SAVED_NAME_MAX) } : prompt))

/** A problem with a name, in words for the person typing it; null when it is fine. `exceptId` is the prompt being renamed. */
export function validatePromptName(name: string, list: readonly SavedPrompt[], exceptId?: string): string | null {
  if (name.trim() === '') return 'Give the prompt a name.'
  if (name.trim().length > SAVED_NAME_MAX) return `Keep the name under ${SAVED_NAME_MAX} characters.`
  if (list.some((prompt) => prompt.id !== exceptId && keyOf(prompt.name) === keyOf(name))) return 'A saved prompt already has that name.'
  return null
}

/** A starting name for a prompt: the first few words of its first line. */
export function promptNameFrom(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '') ?? ''
  return line.trim().split(/\s+/).slice(0, SUGGEST_WORDS).join(' ').slice(0, SAVED_NAME_MAX)
}

export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS)

export interface SavedCompletionRow {
  kind: 'saved' | 'save'
  name: string
  description: string
  id?: string
}

const SAVE_ROW = { name: 'save', description: 'Save the rest of this message as a prompt' }

/** The "Saved" group of the / list: the person's prompts that fit what was typed, then the row that saves a new one. */
export function savedCompletionRows(list: readonly SavedPrompt[], query: string): SavedCompletionRow[] {
  const prompts = rankCompletions(
    list.map((prompt) => ({ name: prompt.name, description: oneLine(prompt.text), id: prompt.id })),
    query
  ).map((row): SavedCompletionRow => ({ kind: 'saved', name: row.name, description: row.description, id: row.id }))
  const save = rankCompletions([SAVE_ROW], query).map((row): SavedCompletionRow => ({ kind: 'save', name: row.name, description: row.description }))
  return [...prompts, ...save]
}

/** The box text with the slash command taken out, trimmed. */
export function withoutToken(value: string, token: { start: number; end: number }): string {
  return `${value.slice(0, token.start)}${value.slice(token.end)}`.trim()
}

/** Saved prompts coming in from a settings file: Replace takes them as they are, Merge adds the ones whose name is new. */
export function mergeSavedPrompts(current: readonly SavedPrompt[], incoming: readonly SavedPrompt[], mode: 'merge' | 'replace'): SavedPrompt[] {
  if (mode === 'replace') return [...incoming]
  const names = new Set(current.map((prompt) => keyOf(prompt.name)))
  const ids = new Set(current.map((prompt) => prompt.id))
  const added = incoming
    .filter((prompt) => !names.has(keyOf(prompt.name)))
    .map((prompt) => {
      let id = prompt.id
      for (let n = 2; ids.has(id); n += 1) id = `${prompt.id}-${n}`
      ids.add(id)
      return { ...prompt, id }
    })
  return sanitizeSavedPrompts([...current, ...added])
}
