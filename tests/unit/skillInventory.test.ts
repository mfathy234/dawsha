import { existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportSkill, exportSkills, isSafeExportDestination, listSkills, resolveSkill } from '../../src/main/skillInventory'

describe('skill inventory', () => {
  it('finds user and project skills by agent and deduplicates shared roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const shared = join(root, '.agents')
    const project = join(root, 'project')
    for (const dir of [join(claude, 'skills', 'Review'), join(shared, 'skills', 'Plan'), join(project, '.codex', 'skills', 'Build')]) mkdirSync(dir, { recursive: true })
    for (const path of [join(claude, 'skills', 'Review'), join(shared, 'skills', 'Plan'), join(project, '.codex', 'skills', 'Build')]) writeFileSync(join(path, 'SKILL.md'), '# skill')
    const skills = listSkills({ claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared, projects: [project, project] })
    expect(skills.map(({ name, agent, scope }) => [name, agent, scope])).toEqual([
      ['Plan', 'shared', 'user'], ['Review', 'claude', 'user'], ['Build', 'codex', 'project']
    ])
  })

  it('lists a linked direct child only when its target is a skill, and never resolves an unlisted ID', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const outside = join(root, 'outside')
    const notASkill = join(root, 'plain')
    mkdirSync(join(claude, 'skills'), { recursive: true })
    mkdirSync(outside)
    mkdirSync(notASkill)
    writeFileSync(join(outside, 'SKILL.md'), '# linked')
    symlinkSync(outside, join(claude, 'skills', 'Escape'), 'junction')
    symlinkSync(notASkill, join(claude, 'skills', 'Plain'), 'junction')
    symlinkSync(join(claude, 'skills'), join(claude, 'skills', 'Loop'), 'junction')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    expect(listSkills(locations).map(({ name, linked }) => [name, linked])).toEqual([['Escape', true]])
    expect(resolveSkill(locations, 'arbitrary path')).toBeNull()
  })

  it('lists a junction child of the user skill root as a linked skill with its target', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const sync = join(root, 'sync', 'Review')
    mkdirSync(join(claude, 'skills'), { recursive: true })
    mkdirSync(sync, { recursive: true })
    writeFileSync(join(sync, 'SKILL.md'), '# Review')
    symlinkSync(sync, join(claude, 'skills', 'Review'), 'junction')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const [skill] = listSkills(locations)
    expect(skill).toMatchObject({ name: 'Review', agent: 'claude', scope: 'user', linked: true, linkTarget: realpathSync(sync) })
    expect(skill.path).toBe(join(claude, 'skills', 'Review'))
    expect(resolveSkill(locations, skill.id)?.name).toBe('Review')
  })

  it('does not follow a link nested inside a skill or inside a linked skill', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const linkedTarget = join(root, 'sync', 'Linked')
    const nestedTarget = join(root, 'sync', 'Nested')
    mkdirSync(join(claude, 'skills', 'Outer'), { recursive: true })
    mkdirSync(linkedTarget, { recursive: true })
    mkdirSync(nestedTarget, { recursive: true })
    writeFileSync(join(claude, 'skills', 'Outer', 'SKILL.md'), '# Outer')
    writeFileSync(join(linkedTarget, 'SKILL.md'), '# Linked')
    writeFileSync(join(nestedTarget, 'SKILL.md'), '# Nested')
    symlinkSync(nestedTarget, join(claude, 'skills', 'Outer', 'Inner'), 'junction')
    symlinkSync(linkedTarget, join(claude, 'skills', 'Linked'), 'junction')
    symlinkSync(nestedTarget, join(linkedTarget, 'Deeper'), 'junction')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    expect(listSkills(locations).map(({ name }) => name).sort()).toEqual(['Linked', 'Outer'])
  })

  it('lists a shared target once when several links or a real copy point to it', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const target = join(root, 'sync', 'Shared')
    mkdirSync(join(claude, 'skills'), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# Shared')
    symlinkSync(target, join(claude, 'skills', 'Alpha'), 'junction')
    symlinkSync(target, join(claude, 'skills', 'Beta'), 'junction')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    expect(listSkills(locations)).toHaveLength(1)
  })

  it('lists installed agent files from user and project roots, preferring native Codex TOML', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-agents-'))
    const claude = join(root, '.claude')
    const codex = join(root, '.codex')
    const project = join(root, 'project')
    mkdirSync(join(claude, 'agents'), { recursive: true })
    mkdirSync(join(codex, 'agents'), { recursive: true })
    mkdirSync(join(project, '.gemini', 'agents'), { recursive: true })
    writeFileSync(join(claude, 'agents', 'reviewer.md'), '# Reviewer')
    writeFileSync(join(codex, 'agents', 'architect.md'), '# Architect')
    writeFileSync(join(codex, 'agents', 'architect.toml'), 'name = "architect"')
    writeFileSync(join(project, '.gemini', 'agents', 'writer.md'), '# Writer')
    writeFileSync(join(claude, 'agents', 'notes.txt'), 'not an agent')
    const entries = listSkills({ claude, codex, gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [project] })
    expect(entries.map(({ name, agent, kind, scope }) => [name, agent, kind, scope])).toEqual([
      ['reviewer', 'claude', 'agent', 'user'],
      ['architect', 'codex', 'agent', 'user'],
      ['writer', 'gemini', 'agent', 'project']
    ])
    expect(entries[1].path).toBe(join(codex, 'agents', 'architect.toml'))
  })

  it('exports an installed agent file without overwriting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-agents-'))
    const claude = join(root, '.claude')
    mkdirSync(join(claude, 'agents'), { recursive: true })
    writeFileSync(join(claude, 'agents', 'reviewer.md'), '# Reviewer')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const agent = listSkills(locations)[0]
    const destination = join(root, 'exports')
    mkdirSync(destination)
    expect(exportSkill(locations, agent.id, destination)).toBe(join(destination, 'reviewer.md'))
    expect(existsSync(join(destination, 'reviewer.md'))).toBe(true)
    expect(() => exportSkill(locations, agent.id, destination)).toThrow(/exists/i)
  })

  it('finds plugin-provided agents without treating skill helper files as installed agents', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-plugin-agents-'))
    const codex = join(root, '.codex')
    const pluginAgent = join(codex, 'plugins', 'cache', 'vendor', 'package', '1.0', 'agents')
    const skillHelper = join(codex, 'plugins', 'cache', 'vendor', 'package', '1.0', 'skills', 'Writing', 'agents')
    mkdirSync(pluginAgent, { recursive: true })
    mkdirSync(skillHelper, { recursive: true })
    writeFileSync(join(pluginAgent, 'reviewer.md'), '# Reviewer')
    writeFileSync(join(skillHelper, 'example.md'), '# Example')
    const entries = listSkills({ claude: join(root, '.claude'), codex, gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] })
    expect(entries.filter((entry) => entry.kind === 'agent').map((entry) => entry.name)).toEqual(['reviewer'])
  })

  it('exports a selected skill without overwriting an existing destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const source = join(claude, 'skills', 'Review')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '# Review')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const skill = listSkills(locations)[0]
    const destination = join(root, 'exports')
    mkdirSync(destination)
    expect(exportSkill(locations, skill.id, destination)).toBe(join(destination, 'Review'))
    expect(() => exportSkill(locations, skill.id, destination)).toThrow(/exists/i)
  })

  it('finds plugin skills and refuses an export containing links before creating the destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const codex = join(root, '.codex')
    const skillDir = join(codex, 'plugins', 'cache', 'vendor', 'name', '1.0', 'skills', 'PluginSkill')
    const outside = join(root, 'outside')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# plugin')
    mkdirSync(outside)
    symlinkSync(outside, join(skillDir, 'linked'), 'junction')
    const locations = { claude: join(root, '.claude'), codex, gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const skill = listSkills(locations).find((entry) => entry.name === 'PluginSkill')
    expect(skill?.agent).toBe('codex')
    const destination = join(root, 'export')
    mkdirSync(destination)
    expect(() => exportSkill(locations, skill!.id, destination)).toThrow(/link/i)
    expect(existsSync(join(destination, 'PluginSkill'))).toBe(false)
  })

  it('refuses to export a skill into itself or one of its child folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const source = join(claude, 'skills', 'Review')
    const child = join(source, 'assets')
    mkdirSync(child, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '# Review')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const id = listSkills(locations)[0].id
    expect(isSafeExportDestination(source, source)).toBe(false)
    expect(isSafeExportDestination(source, child)).toBe(false)
    expect(isSafeExportDestination(source, root)).toBe(true)
    expect(() => exportSkill(locations, id, child)).toThrow(/inside the skill/i)
    expect(existsSync(join(child, 'Review'))).toBe(false)
  })
})

describe('exportSkills', () => {
  it('exports a mixed selection into per-agent folders and skips what already exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-bulk-'))
    const claude = join(root, '.claude')
    const codex = join(root, '.codex')
    mkdirSync(join(claude, 'skills', 'Review'), { recursive: true })
    writeFileSync(join(claude, 'skills', 'Review', 'SKILL.md'), '# Review')
    mkdirSync(join(codex, 'agents'), { recursive: true })
    writeFileSync(join(codex, 'agents', 'architect.toml'), 'name = "architect"')
    const locations = { claude, codex, gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    const ids = listSkills(locations).map((entry) => entry.id)
    const destination = join(root, 'out')
    mkdirSync(destination)

    const first = exportSkills(locations, ids, destination)
    expect(first).toEqual({ folder: join(destination, 'dawsha-export'), exported: 2, skipped: [] })
    expect(existsSync(join(destination, 'dawsha-export', 'claude', 'skills', 'Review', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(destination, 'dawsha-export', 'codex', 'agents', 'architect.toml'))).toBe(true)

    const again = exportSkills(locations, [...ids, 'deadbeef'], destination)
    expect(again.exported).toBe(0)
    expect(again.skipped.map((s) => s.reason)).toEqual(['a folder with that skill name already exists', 'a folder with that skill name already exists', 'no longer available'])
  })

  it('rejects an empty selection', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-bulk-'))
    const locations = { claude: join(root, '.claude'), codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    expect(() => exportSkills(locations, [], root)).toThrow(/nothing/i)
  })
})
