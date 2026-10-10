import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SkillEntry } from '../shared/skills'

export interface SkillLocations {
  claude: string
  codex: string
  gemini: string
  shared: string
  projects: string[]
}

interface Root {
  path: string
  agent: SkillEntry['agent']
  kind: SkillEntry['kind']
  scope: SkillEntry['scope']
  project?: string
}

function pluginRoots(home: string, agent: SkillEntry['agent'], kind: SkillEntry['kind'] = 'skill'): Root[] {
  const cache = join(home, 'plugins', 'cache')
  const found: Root[] = []
  const pending = [{ path: cache, depth: 0 }]
  let visited = 0
  while (pending.length > 0 && visited < 2000 && found.length < 100) {
    const current = pending.shift()!
    visited += 1
    if (!isDirectory(current.path) || current.depth > (kind === 'agent' ? 4 : 7)) continue
    if (basename(current.path).toLowerCase() === (kind === 'agent' ? 'agents' : 'skills')) {
      found.push({ path: current.path, agent, kind, scope: 'user' })
      continue
    }
    let children: string[]
    try { children = readdirSync(current.path).slice(0, 200) } catch { continue }
    for (const name of children) pending.push({ path: join(current.path, name), depth: current.depth + 1 })
  }
  return found
}

function roots(locations: SkillLocations): Root[] {
  const user: Root[] = [
    { path: join(locations.shared, 'skills'), agent: 'shared', kind: 'skill', scope: 'user' },
    { path: join(locations.claude, 'skills'), agent: 'claude', kind: 'skill', scope: 'user' },
    { path: join(locations.codex, 'skills'), agent: 'codex', kind: 'skill', scope: 'user' },
    { path: join(locations.gemini, 'skills'), agent: 'gemini', kind: 'skill', scope: 'user' }
  ]
  const projects = locations.projects.slice(0, 100).flatMap((project): Root[] =>
    ([['.agents', 'shared'], ['.claude', 'claude'], ['.codex', 'codex'], ['.gemini', 'gemini']] as const).map(([folder, agent]) => ({
      path: join(project, folder, 'skills'), agent, kind: 'skill', scope: 'project', project
    }))
  )
  const agents: Root[] = [
    { path: join(locations.shared, 'agents'), agent: 'shared', kind: 'agent', scope: 'user' },
    { path: join(locations.claude, 'agents'), agent: 'claude', kind: 'agent', scope: 'user' },
    { path: join(locations.codex, 'agents'), agent: 'codex', kind: 'agent', scope: 'user' },
    { path: join(locations.gemini, 'agents'), agent: 'gemini', kind: 'agent', scope: 'user' },
    ...locations.projects.slice(0, 100).flatMap((project): Root[] =>
      ([['.agents', 'shared'], ['.claude', 'claude'], ['.codex', 'codex'], ['.gemini', 'gemini']] as const).map(([folder, agent]) => ({
        path: join(project, folder, 'agents'), agent, kind: 'agent', scope: 'project', project
      }))
    )
  ]
  return [...user, ...pluginRoots(locations.claude, 'claude'), ...pluginRoots(locations.codex, 'codex'), ...projects,
    ...agents, ...pluginRoots(locations.claude, 'claude', 'agent'), ...pluginRoots(locations.codex, 'codex', 'agent')]
}

function isDirectory(path: string): boolean {
  try { return lstatSync(path).isDirectory() } catch { return false }
}

function isFile(path: string): boolean {
  try { return lstatSync(path).isFile() } catch { return false }
}

function idFor(path: string): string {
  return createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 24)
}

export function listSkills(locations: SkillLocations): SkillEntry[] {
  const found: SkillEntry[] = []
  const seen = new Set<string>()
  for (const root of roots(locations)) {
    if (!isDirectory(root.path)) continue
    let entries: string[]
    try { entries = readdirSync(root.path).slice(0, 500) } catch { continue }
    const agentNames = new Set<string>()
    if (root.kind === 'agent') {
      entries.sort((a, b) => (a.endsWith('.toml') ? -1 : 0) - (b.endsWith('.toml') ? -1 : 0))
    }
    for (const name of entries) {
      const path = join(root.path, name)
      if (root.kind === 'skill' && (!isDirectory(path) || !existsSync(join(path, 'SKILL.md')))) continue
      if (root.kind === 'agent' && (!/\.(md|toml)$/i.test(name) || !isFile(path))) continue
      try {
        if (root.kind === 'skill' && !lstatSync(join(path, 'SKILL.md')).isFile()) continue
        const displayName = root.kind === 'agent' ? name.replace(/\.(md|toml)$/i, '') : name
        if (root.kind === 'agent' && agentNames.has(displayName.toLowerCase())) continue
        const canonical = realpathSync(path).toLowerCase()
        if (seen.has(canonical)) continue
        seen.add(canonical)
        if (root.kind === 'agent') agentNames.add(displayName.toLowerCase())
        found.push({ id: idFor(canonical), name: displayName, kind: root.kind, agent: root.agent, scope: root.scope, path, project: root.project })
      } catch { /* Unreadable skill; leave it out of the inventory. */ }
    }
  }
  return found
}

export function resolveSkill(locations: SkillLocations, id: unknown): SkillEntry | null {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return null
  return listSkills(locations).find((skill) => skill.id === id) ?? null
}

export function isSafeExportDestination(source: string, destinationFolder: string): boolean {
  try {
    const canonicalSource = realpathSync(source)
    const canonicalDestination = realpathSync(destinationFolder)
    const sourcePath = process.platform === 'win32' ? canonicalSource.toLowerCase() : canonicalSource
    const destinationPath = process.platform === 'win32' ? canonicalDestination.toLowerCase() : canonicalDestination
    const fromSource = relative(sourcePath, destinationPath)
    return fromSource === '..' || fromSource.startsWith(`..${sep}`) || isAbsolute(fromSource)
  } catch {
    return false
  }
}

function checkSkillTree(source: string, depth = 0, budget = { count: 0 }): void {
  if (depth > 8) throw new Error('Skill is too deeply nested.')
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (++budget.count > 2000) throw new Error('Skill has too many files.')
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Skill contains a link or unsupported file.')
    if (entry.isDirectory()) checkSkillTree(join(source, entry.name), depth + 1, budget)
  }
}

function copySkillTree(source: string, destination: string): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(to)
      copySkillTree(from, to)
    } else if (entry.isFile()) {
      copyFileSync(from, to)
    } else {
      throw new Error('Skill contains a link or unsupported file.')
    }
  }
}

export function exportSkill(locations: SkillLocations, id: unknown, destinationFolder: string): string {
  const skill = resolveSkill(locations, id)
  if (!skill) throw new Error('Skill is no longer available.')
  if (!isDirectory(destinationFolder)) throw new Error('Choose an existing destination folder.')
  if (!isSafeExportDestination(skill.path, destinationFolder)) throw new Error('Cannot export inside the skill folder.')
  const destination = join(resolve(destinationFolder), basename(skill.path))
  if (existsSync(destination)) throw new Error('A folder with that skill name already exists.')
  if (skill.kind === 'agent') {
    if (!lstatSync(skill.path).isFile()) throw new Error('Agent file is no longer available.')
    copyFileSync(skill.path, destination)
  } else {
    checkSkillTree(skill.path)
    mkdirSync(destination)
    copySkillTree(skill.path, destination)
  }
  return destination
}
