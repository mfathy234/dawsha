import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bridgeCommand, installBridge, type BridgeLocations } from '../../src/main/statusBridge'
import { migrateLegacyUserData } from '../../src/main/userDataMigration'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })))

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))

function setup(claudeSettings: string, withBridge: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-migrate-'))
  roots.push(root)
  const legacyDir = join(root, 'claude-grid')
  const newDir = join(root, 'Dawsha')
  const claudeSettingsPath = join(root, 'claude-home', 'settings.json')
  mkdirSync(legacyDir, { recursive: true })
  mkdirSync(join(root, 'claude-home'), { recursive: true })
  writeFileSync(join(legacyDir, 'settings.json'), JSON.stringify({ version: 2, projects: [{ id: 'a', name: 'acme-web', folder: root }] }))
  writeFileSync(claudeSettingsPath, claudeSettings)
  const old: BridgeLocations = {
    settingsPath: claudeSettingsPath,
    binDir: join(legacyDir, 'bin'),
    statusDir: join(legacyDir, 'status'),
    nodePath: process.execPath
  }
  if (withBridge) {
    expect(installBridge(old).ok).toBe(true)
    writeFileSync(join(old.statusDir, 'sess-1.json'), '{"session_id":"sess-1"}')
  }
  const input = { legacyDir, newDir, claudeSettingsPath, nodePath: process.execPath }
  return { root, old, input, claudeSettingsPath, legacyDir, newDir }
}

describe('migrateLegacyUserData', () => {
  it('does nothing when there is no legacy settings file', () => {
    const s = setup('{}', false)
    rmSync(join(s.legacyDir, 'settings.json'))
    expect(migrateLegacyUserData(s.input)).toEqual({ migrated: false, bridge: 'none', note: null })
    expect(existsSync(s.newDir)).toBe(false)
  })

  it('does nothing when the new settings file already exists', () => {
    const s = setup('{}', false)
    mkdirSync(s.newDir)
    writeFileSync(join(s.newDir, 'settings.json'), '{"version":2,"projects":[]}')
    expect(migrateLegacyUserData(s.input).migrated).toBe(false)
    expect(readJson(join(s.newDir, 'settings.json')).projects).toEqual([])
  })

  it('copies settings and keeps the legacy folder untouched', () => {
    const s = setup(JSON.stringify({ theme: 'dark' }), false)
    const result = migrateLegacyUserData(s.input)
    expect(result).toEqual({ migrated: true, bridge: 'none', note: null })
    expect(readJson(join(s.newDir, 'settings.json')).projects[0].name).toBe('acme-web')
    expect(existsSync(join(s.legacyDir, 'settings.json'))).toBe(true)
    expect(readJson(s.claudeSettingsPath)).toEqual({ theme: 'dark' })
  })

  it('copies the status folder and re-points the installed status line', () => {
    const s = setup(JSON.stringify({ theme: 'dark' }, null, 2), true)
    const oldCommand = bridgeCommand(s.old)
    expect(readJson(s.claudeSettingsPath).statusLine.command).toBe(oldCommand)
    const result = migrateLegacyUserData(s.input)
    expect(result).toEqual({ migrated: true, bridge: 'repointed', note: null })
    const moved: BridgeLocations = { ...s.old, binDir: join(s.newDir, 'bin'), statusDir: join(s.newDir, 'status') }
    const settings = readJson(s.claudeSettingsPath)
    expect(settings.theme).toBe('dark')
    expect(settings.statusLine).toEqual({ type: 'command', command: bridgeCommand(moved) })
    expect(bridgeCommand(moved)).not.toBe(oldCommand)
    expect(existsSync(join(s.newDir, 'status', 'sess-1.json'))).toBe(true)
    expect(readJson(join(s.newDir, 'bin', 'bridge-state.json')).command).toBe(bridgeCommand(moved))
    expect(readJson(join(s.newDir, 'bin', 'bridge-config.json')).statusDir).toBe(moved.statusDir)
    expect(existsSync(join(s.legacyDir, 'bin', 'bridge-state.json'))).toBe(true)
  })

  it('keeps the previous status line of the user when re-pointing', () => {
    const s = setup(JSON.stringify({ statusLine: { type: 'command', command: 'my-line', padding: 1 } }), true)
    migrateLegacyUserData(s.input)
    const moved: BridgeLocations = { ...s.old, binDir: join(s.newDir, 'bin'), statusDir: join(s.newDir, 'status') }
    expect(readJson(s.claudeSettingsPath).statusLine).toEqual({ type: 'command', command: bridgeCommand(moved), padding: 1 })
    expect(readJson(join(s.newDir, 'bin', 'bridge-state.json')).previous.command).toBe('my-line')
  })

  it('leaves a status line that no longer matches what the app installed and returns a note', () => {
    const s = setup(JSON.stringify({}), true)
    const edited = { statusLine: { type: 'command', command: 'something-else' } }
    writeFileSync(s.claudeSettingsPath, JSON.stringify(edited))
    const result = migrateLegacyUserData(s.input)
    expect(result.migrated).toBe(true)
    expect(result.bridge).toBe('left')
    expect(result.note).toContain('Turn it off and on again')
    expect(readJson(s.claudeSettingsPath)).toEqual(edited)
    expect(existsSync(join(s.newDir, 'bin'))).toBe(false)
  })
})
