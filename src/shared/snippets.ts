import { MAX_SNIPPETS, SNIPPET_NAME_MAX, SNIPPET_TEXT_MAX } from './settingsSchema'
import type { Snippet } from './types'

export const SNIPPET_VARIABLES = [
  { name: 'selection', help: 'the text selected in the pane' },
  { name: 'branch', help: 'the current git branch' },
  { name: 'project', help: 'the project name' },
  { name: 'folder', help: 'the project folder' }
] as const

export type SnippetContext = Record<(typeof SNIPPET_VARIABLES)[number]['name'], string>

const VARIABLE = /\{\{\s*([a-z]+)\s*\}\}/gi

export function expandSnippet(text: string, context: SnippetContext): string {
  return text.replace(VARIABLE, (match, name: string) => {
    const key = name.toLowerCase() as keyof SnippetContext
    return key in context ? context[key] : match
  })
}

export const usesSelection = (text: string): boolean => /\{\{\s*selection\s*\}\}/i.test(text)

export function visibleSnippets(snippets: Snippet[], projectId: string | null): Snippet[] {
  return snippets.filter((snippet) => snippet.projectId === null || snippet.projectId === projectId)
}

export function snippetForShortcut(snippets: Snippet[], number: number, projectId: string | null): Snippet | undefined {
  const candidates = visibleSnippets(snippets, projectId).filter((snippet) => snippet.shortcut === number)
  return candidates.find((snippet) => snippet.projectId !== null) ?? candidates[0]
}

export interface SnippetDraft {
  id?: string
  name: string
  text: string
  projectId: string | null
  shortcut: number | null
}

const scopesOverlap = (a: string | null, b: string | null): boolean => a === null || b === null || a === b

export function shortcutConflict(snippets: Snippet[], draft: SnippetDraft): Snippet | undefined {
  if (draft.shortcut === null) return undefined
  return snippets.find(
    (snippet) =>
      snippet.id !== draft.id && snippet.shortcut === draft.shortcut && scopesOverlap(snippet.projectId, draft.projectId)
  )
}

export type SnippetField = 'name' | 'text' | 'shortcut' | 'count'

export interface SnippetProblem {
  field: SnippetField
  message: string
}

export function snippetProblem(draft: SnippetDraft, snippets: Snippet[]): SnippetProblem | null {
  const problem = (field: SnippetField, message: string): SnippetProblem => ({ field, message })
  if (!draft.name.trim()) return problem('name', 'Enter a name.')
  if (draft.name.trim().length > SNIPPET_NAME_MAX) return problem('name', `Use at most ${SNIPPET_NAME_MAX} characters for the name.`)
  if (!draft.text.trim()) return problem('text', 'Enter the text to insert.')
  if (draft.text.length > SNIPPET_TEXT_MAX) return problem('text', `Use at most ${SNIPPET_TEXT_MAX} characters of text.`)
  if (draft.shortcut !== null && !(Number.isInteger(draft.shortcut) && draft.shortcut >= 1 && draft.shortcut <= 9)) {
    return problem('shortcut', 'Pick a shortcut from Alt+1 to Alt+9.')
  }
  const clash = shortcutConflict(snippets, draft)
  if (clash) return problem('shortcut', `Alt+${clash.shortcut} is already used by '${clash.name}'.`)
  if (draft.id === undefined && snippets.length >= MAX_SNIPPETS) return problem('count', `You can keep at most ${MAX_SNIPPETS} snippets.`)
  return null
}

export const validateSnippet = (draft: SnippetDraft, snippets: Snippet[]): string | null =>
  snippetProblem(draft, snippets)?.message ?? null

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const BRACKET_START = '\u001b[200~'
const BRACKET_END = '\u001b[201~'

export interface Insertion {
  data: string
  flattened: boolean
}

export function insertionData(text: string, bracketedPaste: boolean): Insertion {
  const clean = text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '')
  if (!clean.includes('\n')) return { data: clean, flattened: false }
  if (bracketedPaste) return { data: `${BRACKET_START}${clean.replace(/\n/g, '\r')}${BRACKET_END}`, flattened: false }
  const joined = clean
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return { data: joined, flattened: true }
}

export function snippetPreview(text: string, limit = 90): string {
  const line = text.split(/\r?\n/).find((part) => part.trim() !== '') ?? ''
  const trimmed = line.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed
}
