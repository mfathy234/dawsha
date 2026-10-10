import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BridgePreview, BridgeResult, BridgeStatus } from '../shared/types'
import { BRIDGE_CONFIG_NAME, BRIDGE_SCRIPT, BRIDGE_SCRIPT_NAME } from './bridgeScript'

const STATE_NAME = 'bridge-state.json'
const BACKUP_SUFFIX = '.dawsha-backup'
const DEFAULT_INDENT = 2

export interface BridgeLocations {
  settingsPath: string
  binDir: string
  statusDir: string
  nodePath: string | null
}

export type Json = Record<string, unknown>

export interface BridgeState {
  command: string
  previous: unknown
}

type Loaded = { ok: true; data: Json; indent: string | number; existed: boolean } | { ok: false; error: string }

export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const forward = (path: string): string => path.replace(/\\/g, '/')

export const bridgeCommand = (where: BridgeLocations): string =>
  `node "${forward(join(where.binDir, BRIDGE_SCRIPT_NAME))}"`

function detectIndent(text: string): string | number {
  const match = /^([ \t]+)"/m.exec(text)
  return match ? match[1] : DEFAULT_INDENT
}

export function loadSettings(path: string): Loaded {
  if (!existsSync(path)) return { ok: true, data: {}, indent: DEFAULT_INDENT, existed: false }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { ok: false, error: `${path} could not be read: ${(error as Error).message}` }
  }
  try {
    const data: unknown = JSON.parse(text.replace(/^﻿/, ''))
    if (!isRecord(data)) return { ok: false, error: `${path} is not a JSON object.` }
    return { ok: true, data, indent: detectIndent(text), existed: true }
  } catch (error) {
    return { ok: false, error: `${path} could not be parsed as JSON: ${(error as Error).message}` }
  }
}

export function writeJson(path: string, data: unknown, indent: string | number): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(data, null, indent)}\n`, 'utf8')
  renameSync(temp, path)
}

export function readState(binDir: string): BridgeState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(binDir, STATE_NAME), 'utf8'))
    if (isRecord(raw) && typeof raw.command === 'string') return { command: raw.command, previous: raw.previous ?? null }
  } catch {
    return null
  }
  return null
}

const commandOf = (value: unknown): string | null =>
  isRecord(value) && typeof value.command === 'string' ? value.command : null

const isOurs = (value: unknown, where: BridgeLocations): boolean => commandOf(value) === bridgeCommand(where)

export function bridgePreview(where: BridgeLocations): BridgePreview {
  const loaded = loadSettings(where.settingsPath)
  if (!loaded.ok) return { settingsPath: where.settingsPath, previousCommand: null, error: loaded.error }
  const current = loaded.data.statusLine
  return {
    settingsPath: where.settingsPath,
    previousCommand: isOurs(current, where) ? null : commandOf(current),
    error: null
  }
}

export function bridgeStatus(where: BridgeLocations): BridgeStatus {
  const loaded = loadSettings(where.settingsPath)
  if (!loaded.ok) return { installed: false, settingsPath: where.settingsPath, error: loaded.error }
  return { installed: isOurs(loaded.data.statusLine, where), settingsPath: where.settingsPath, error: null }
}

export function writeBridgeFiles(where: BridgeLocations, previousCommand: string | null, state: BridgeState): void {
  mkdirSync(where.binDir, { recursive: true })
  mkdirSync(where.statusDir, { recursive: true })
  writeFileSync(join(where.binDir, BRIDGE_SCRIPT_NAME), BRIDGE_SCRIPT, 'utf8')
  writeFileSync(
    join(where.binDir, BRIDGE_CONFIG_NAME),
    JSON.stringify({ statusDir: where.statusDir, previousCommand }, null, 2),
    'utf8'
  )
  writeFileSync(join(where.binDir, STATE_NAME), JSON.stringify(state, null, 2), 'utf8')
}

export function installBridge(where: BridgeLocations): BridgeResult {
  if (!where.nodePath) {
    return { ok: false, error: 'Node.js was not found on PATH. The status-line script needs it to run.' }
  }
  const loaded = loadSettings(where.settingsPath)
  if (!loaded.ok) return loaded
  const command = bridgeCommand(where)
  const current = loaded.data.statusLine
  if (isOurs(current, where)) return { ok: true, note: 'Already installed.' }
  try {
    const previous = current === undefined ? null : current
    writeBridgeFiles(where, commandOf(previous), { command, previous })
    if (loaded.existed) copyFileSync(where.settingsPath, `${where.settingsPath}${BACKUP_SUFFIX}`)
    const base = isRecord(previous) ? previous : {}
    writeJson(where.settingsPath, { ...loaded.data, statusLine: { ...base, type: 'command', command } }, loaded.indent)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `Could not edit ${where.settingsPath}: ${(error as Error).message}` }
  }
}

export function uninstallBridge(where: BridgeLocations): BridgeResult {
  const loaded = loadSettings(where.settingsPath)
  if (!loaded.ok) return loaded
  const state = readState(where.binDir)
  try {
    let note: string | undefined
    if (isOurs(loaded.data.statusLine, where)) {
      const data = { ...loaded.data }
      if (state === null || state.previous === null) delete data.statusLine
      else data.statusLine = state.previous
      writeJson(where.settingsPath, data, loaded.indent)
    } else if (loaded.data.statusLine !== undefined) {
      note = 'The statusLine in settings.json was changed after install, so it was left as it is.'
    }
    rmSync(join(where.binDir, STATE_NAME), { force: true })
    rmSync(join(where.binDir, BRIDGE_CONFIG_NAME), { force: true })
    return { ok: true, note }
  } catch (error) {
    return { ok: false, error: `Could not edit ${where.settingsPath}: ${(error as Error).message}` }
  }
}
