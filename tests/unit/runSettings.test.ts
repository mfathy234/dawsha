import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildTransferData } from '../../src/shared/settingsTransfer'

const projects = [{ id: 'api', name: 'API', folder: 'C:\\work\\api', defaultAgent: 'claude' as const }]
const saved = [{ projectId: 'api', folder: 'C:\\work\\api-review', commands: [{ id: 'api-dev', name: 'Run API', cwd: '.', shellCommand: 'dotnet run --project src/Api/Api.csproj' }] }]

describe('local run command settings', () => {
  it('retains user commands for known projects across a settings reload', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-run-settings-')), 'settings.json')
    const store = new SettingsStore(file)
    store.update({ projects, runCommands: saved })
    expect(new SettingsStore(file).load().settings.runCommands).toEqual(saved)
  })

  it('drops invalid commands and unknown projects and starts empty for older settings', () => {
    expect(defaultSettings().runCommands).toEqual([])
    const migrated = migrateSettings({ projects, runCommands: [...saved, { ...saved[0], projectId: 'gone' }, { ...saved[0], commands: [{ ...saved[0].commands[0], cwd: '..' }] }] })
    expect(migrated.runCommands).toEqual([saved[0], { ...saved[0], commands: [] }])
  })

  it('excludes executable local commands from settings exports', () => {
    const settings = migrateSettings({ projects, runCommands: saved })
    expect(buildTransferData(settings)).not.toHaveProperty('runCommands')
  })
})
