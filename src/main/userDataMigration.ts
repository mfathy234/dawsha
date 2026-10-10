import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bridgeCommand, isRecord, loadSettings, readState, writeBridgeFiles, writeJson, type BridgeLocations } from './statusBridge'

export interface MigrationInput {
  legacyDir: string
  newDir: string
  claudeSettingsPath: string
  nodePath: string | null
}

export interface MigrationResult {
  migrated: boolean
  bridge: 'none' | 'repointed' | 'left'
  note: string | null
}

const NOT_MIGRATED: MigrationResult = { migrated: false, bridge: 'none', note: null }

const LEFT_NOTE =
  'Dawsha copied your settings from the old Claude Grid folder. Live session info still points at the old ' +
  'folder because ~/.claude/settings.json was changed after it was turned on. Turn it off and on again in ' +
  'the Theme popover to re-enable it.'

const locations = (dir: string, input: MigrationInput): BridgeLocations => ({
  settingsPath: input.claudeSettingsPath,
  binDir: join(dir, 'bin'),
  statusDir: join(dir, 'status'),
  nodePath: input.nodePath
})

function copyIfPresent(from: string, to: string): void {
  if (existsSync(from)) cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
}

function repointBridge(input: MigrationInput): MigrationResult['bridge'] {
  const oldWhere = locations(input.legacyDir, input)
  const newWhere = locations(input.newDir, input)
  const state = readState(oldWhere.binDir)
  if (state === null) return 'none'
  const loaded = loadSettings(input.claudeSettingsPath)
  const current = loaded.ok ? loaded.data.statusLine : undefined
  const matches = isRecord(current) && current.command === state.command
  if (!loaded.ok || !matches) return 'left'
  const command = bridgeCommand(newWhere)
  const previousCommand = isRecord(state.previous) && typeof state.previous.command === 'string' ? state.previous.command : null
  writeBridgeFiles(newWhere, previousCommand, { command, previous: state.previous })
  writeJson(
    input.claudeSettingsPath,
    { ...loaded.data, statusLine: { ...(current as Record<string, unknown>), command } },
    loaded.indent
  )
  return 'repointed'
}

export function migrateLegacyUserData(input: MigrationInput): MigrationResult {
  if (existsSync(join(input.newDir, 'settings.json'))) return NOT_MIGRATED
  if (!existsSync(join(input.legacyDir, 'settings.json'))) return NOT_MIGRATED
  mkdirSync(input.newDir, { recursive: true })
  cpSync(join(input.legacyDir, 'settings.json'), join(input.newDir, 'settings.json'))
  copyIfPresent(join(input.legacyDir, 'status'), join(input.newDir, 'status'))
  const bridge = repointBridge(input)
  return { migrated: true, bridge, note: bridge === 'left' ? LEFT_NOTE : null }
}
