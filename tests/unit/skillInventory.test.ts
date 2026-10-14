import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('does not follow symlinks or resolve an unlisted ID', () => {
    const root = mkdtempSync(join(tmpdir(), 'dawsha-skills-'))
    const claude = join(root, '.claude')
    const outside = join(root, 'outside')
    mkdirSync(join(claude, 'skills'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(outside, 'SKILL.md'), '# secret')
    symlinkSync(outside, join(claude, 'skills', 'Escape'), 'junction')
    const locations = { claude, codex: join(root, '.codex'), gemini: join(root, '.gemini'), shared: join(root, '.agents'), projects: [] }
    expect(listSkills(locations)).toEqual([])
    expect(resolveSkill(locations, 'arbitrary path')).toBeNull()
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
