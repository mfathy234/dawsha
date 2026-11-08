import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentKind } from '../shared/types'
import { parseCommandFile, type CompletionItem } from '../shared/chatComplete'
import { listSkills, type SkillLocations } from './skillInventory'

interface CachedCommands { at: number; items: CompletionItem[] }
const cache = new Map<string, CachedCommands>()
const CACHE_MS = 5000

function readCommands(root: string, scope: 'project' | 'user', prefix = '', depth = 0): CompletionItem[] {
  if (depth > 8) return []
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.warn(`Could not read chat commands in ${root}`, error)
    return []
  }
  return entries.flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return readCommands(path, scope, prefix ? `${prefix}:${entry.name}` : entry.name, depth + 1)
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) return []
    try {
      const name = `${prefix ? `${prefix}:` : ''}${entry.name.slice(0, -3)}`
      return [{ name, description: parseCommandFile(readFileSync(path, 'utf8')), kind: scope }]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Could not read chat command ${path}`, error)
      return []
    }
  })
}

export function chatCommands(agent: AgentKind, folder: string, locations: SkillLocations): CompletionItem[] {
  const key = `${agent}:${folder}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items
  const items = agent === 'claude'
    ? [...readCommands(join(folder, '.claude', 'commands'), 'project'), ...readCommands(join(locations.claude, 'commands'), 'user'),
      ...listSkills(locations).filter((skill) => skill.kind === 'skill' && (skill.agent === 'claude' || skill.agent === 'shared')).map((skill) => ({ name: skill.name, description: skill.description ?? '', kind: 'skill' as const }))]
    : readCommands(join(locations.codex, 'prompts'), 'user')
  const safe = items.filter((item) => item.name && !item.name.includes('..'))
  cache.set(key, { at: Date.now(), items: safe })
  return safe
}
