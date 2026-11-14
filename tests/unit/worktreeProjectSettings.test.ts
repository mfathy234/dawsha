import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { migrateSettings } from '../../src/shared/settingsSchema'

const project = { id: 'api', name: 'API', folder: 'C:\\work\\api' }

describe('project worktree setup settings', () => {
  it('keeps the reviewed command and one-time suggestion choice through settings reload', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-setup-settings-')), 'settings.json')
    const settings = new SettingsStore(file)
    settings.update({ projects: [{ ...project, defaultAgent: 'claude', worktreeSetup: { command: 'npm ci\ndotnet restore', prompted: true } }] })
    expect(new SettingsStore(file).load().settings.projects[0]).toHaveProperty('worktreeSetup', { command: 'npm ci\ndotnet restore', prompted: true })
  })

  it('keeps a cleared command and never adopts malformed commands', () => {
    for (const command of ['', 42, null, 'echo bad\0payload', 'a'.repeat(8001)]) {
      const result = migrateSettings({ projects: [{ ...project, worktreeSetup: { command, prompted: 'yes' } }] })
      expect(result.projects[0]).toHaveProperty('worktreeSetup', { command: '', prompted: false })
    }
    expect(migrateSettings({ projects: [project] }).projects[0]).not.toHaveProperty('worktreeSetup')
    expect(migrateSettings({ projects: [{ ...project, worktreeSetup: 'npm ci' }] }).projects[0]).not.toHaveProperty('worktreeSetup')
  })
})
