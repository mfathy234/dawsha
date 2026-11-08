import { frontMatterDescription } from './frontMatter'
import { fuzzyMatch } from './palette'
import { isAgent } from './agents'
import type { AgentKind } from './types'

export interface CompletionToken { kind: 'command' | 'file'; start: number; end: number; query: string }
export interface CompletionItem { name: string; description: string; kind: 'built-in' | 'project' | 'user' | 'skill'; path?: string }

export function completionToken(value: string, caret: number): CompletionToken | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null
  const before = value.slice(0, caret)
  const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t')) + 1
  const token = before.slice(start)
  const end = value.slice(caret).search(/\s/)
  const tokenEnd = end < 0 ? value.length : caret + end
  if (start === 0 && token.startsWith('/') && !token.slice(1).includes('/')) return { kind: 'command', start, end: tokenEnd, query: token.slice(1) }
  if (token.startsWith('@') && (start === 0 || /\s/.test(value[start - 1]))) return { kind: 'file', start, end: tokenEnd, query: token.slice(1) }
  return null
}

export function rankCompletions<T extends { name: string; description: string }>(items: readonly T[], query: string, boost: (item: T) => number = () => 0): Array<T & { indexes: number[] }> {
  return items.flatMap((item) => {
    const match = fuzzyMatch(query.replace(/^[/@]/, ''), item.name)
    return match ? [{ item, indexes: match.indexes, score: match.score + boost(item) }] : []
  }).sort((a, b) => b.score - a.score).slice(0, 50).map(({ item, indexes }) => ({ ...item, indexes }))
}

export interface FileCompletionItem { name: string; description: string; kind: 'file' | 'folder'; path: string; directory?: boolean }

export function fileCompletionRows(files: readonly string[]): FileCompletionItem[] {
  const folders = new Set<string>()
  for (const path of files) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i += 1) folders.add(`${parts.slice(0, i).join('/')}/`)
  }
  return [
    ...files.map((path) => ({ name: path, description: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', kind: 'file' as const, path })),
    ...[...folders].map((path) => ({ name: path, description: '', kind: 'folder' as const, path, directory: true }))
  ]
}

export function parseCommandFile(text: string): string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const description = front ? frontMatterDescription(front[1]) : undefined
  const line = description ?? text.split(/\r?\n/).find((entry) => entry.trim() && !entry.startsWith('#') && !entry.startsWith('---'))
  return (line ?? '').trim().replace(/^['"]|['"]$/g, '').slice(0, 180)
}

export function validCommandsRequest(value: unknown): value is { agent: AgentKind; folder: string } {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return isAgent(request.agent) && typeof request.folder === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(request.folder)
}
