import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bridgeCommand,
  bridgePreview,
  bridgeStatus,
  installBridge,
  uninstallBridge,
  type BridgeLocations
} from '../../src/main/statusBridge'
import { readStatusDir } from '../../src/main/statusWatcher'
import { BRIDGE_SCRIPT_NAME } from '../../src/main/bridgeScript'

const payload = readFileSync(join(__dirname, 'fixtures', 'statusline-payload.json'), 'utf8')

function sandbox(settings?: string): BridgeLocations & { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'cg-bridge-'))
  const claude = join(root, 'claude-home')
  mkdirSync(claude, { recursive: true })
  if (settings !== undefined) writeFileSync(join(claude, 'settings.json'), settings, 'utf8')
  return {
    root,
    settingsPath: join(claude, 'settings.json'),
    binDir: join(root, 'userData', 'bin'),
    statusDir: join(root, 'userData', 'status'),
    nodePath: process.execPath
  }
}

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))

describe('installBridge and uninstallBridge', () => {
  it('adds a statusLine to a settings file without one and removes it again', () => {
    const where = sandbox(JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash'] } }, null, 2))
    expect(bridgePreview(where)).toEqual({ settingsPath: where.settingsPath, previousCommand: null, error: null })
    expect(bridgeStatus(where).installed).toBe(false)

    expect(installBridge(where)).toEqual({ ok: true })
    const installed = readJson(where.settingsPath)
    expect(installed.statusLine).toEqual({ type: 'command', command: bridgeCommand(where) })
    expect(installed.theme).toBe('dark')
    expect(installed.permissions).toEqual({ allow: ['Bash'] })
    expect(existsSync(join(where.binDir, BRIDGE_SCRIPT_NAME))).toBe(true)
    expect(existsSync(`${where.settingsPath}.dawsha-backup`)).toBe(true)
    expect(bridgeStatus(where).installed).toBe(true)

    expect(uninstallBridge(where)).toEqual({ ok: true, note: undefined })
    expect(readJson(where.settingsPath)).toEqual({ theme: 'dark', permissions: { allow: ['Bash'] } })
    expect(bridgeStatus(where).installed).toBe(false)
  })

  it('backs up the previous statusLine, keeps its padding and restores it exactly', () => {
    const previous = { type: 'command', command: 'echo hello', padding: 2 }
    const original = JSON.stringify({ a: 1, statusLine: previous, z: [1, 2] }, null, 2)
    const where = sandbox(original)
    expect(bridgePreview(where).previousCommand).toBe('echo hello')

    expect(installBridge(where).ok).toBe(true)
    expect(readJson(where.settingsPath).statusLine).toEqual({ type: 'command', command: bridgeCommand(where), padding: 2 })
    expect(readFileSync(`${where.settingsPath}.dawsha-backup`, 'utf8')).toBe(original)
    expect(readJson(join(where.binDir, 'bridge-state.json')).previous).toEqual(previous)
    expect(bridgePreview(where).previousCommand).toBeNull()

    expect(uninstallBridge(where).ok).toBe(true)
    expect(readJson(where.settingsPath)).toEqual({ a: 1, statusLine: previous, z: [1, 2] })
  })

  it('creates the settings file when missing and deletes it key on toggle off', () => {
    const where = sandbox()
    expect(existsSync(where.settingsPath)).toBe(false)
    expect(installBridge(where).ok).toBe(true)
    expect(readJson(where.settingsPath).statusLine.command).toBe(bridgeCommand(where))
    expect(uninstallBridge(where).ok).toBe(true)
    expect(readJson(where.settingsPath)).toEqual({})
  })

  it('refuses to touch a settings file that does not parse and says why', () => {
    const where = sandbox('{ "a": 1,, }')
    const preview = bridgePreview(where)
    expect(preview.error).toContain('could not be parsed')
    const result = installBridge(where)
    expect(result.ok).toBe(false)
    expect(readFileSync(where.settingsPath, 'utf8')).toBe('{ "a": 1,, }')
    expect(bridgeStatus(where).error).toContain('could not be parsed')
    expect(uninstallBridge(where).ok).toBe(false)
  })

  it('refuses a settings file that is not an object and a missing node', () => {
    expect(installBridge(sandbox('[1,2]')).ok).toBe(false)
    const where = sandbox('{}')
    const result = installBridge({ ...where, nodePath: null })
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(where.settingsPath, 'utf8')).toBe('{}')
  })

  it('leaves a statusLine the user changed after install alone', () => {
    const where = sandbox('{}')
    installBridge(where)
    writeFileSync(where.settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }), 'utf8')
    const result = uninstallBridge(where)
    expect(result.ok && result.note).toContain('left as it is')
    expect(readJson(where.settingsPath).statusLine.command).toBe('mine')
  })

  it('is idempotent and keeps tab indentation', () => {
    const where = sandbox('{\n\t"a": 1\n}\n')
    installBridge(where)
    expect(installBridge(where)).toEqual({ ok: true, note: 'Already installed.' })
    expect(readFileSync(where.settingsPath, 'utf8')).toContain('\n\t"statusLine"')
    expect(readJson(join(where.binDir, 'bridge-state.json')).previous).toBeNull()
  })
})

describe('the bridge script', () => {
  const run = (where: BridgeLocations, input: string) =>
    spawnSync(process.execPath, [join(where.binDir, BRIDGE_SCRIPT_NAME)], { input, encoding: 'utf8' })

  it('saves the payload by session id and prints nothing without a previous status line', () => {
    const where = sandbox('{}')
    installBridge(where)
    const result = run(where, payload)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    const saved = join(where.statusDir, 'ae9082cf-4451-411e-845b-65cf4e620014.json')
    expect(readFileSync(saved, 'utf8')).toBe(payload)
  })

  it('runs the previous command with the same stdin and prints its output unchanged', () => {
    const script = "process.stdin.on('data', d => process.stdout.write('prev:' + d.length + ':ok'))"
    const previous = `"${process.execPath}" -e "${script}"`
    const where = sandbox(JSON.stringify({ statusLine: { type: 'command', command: previous } }))
    installBridge(where)
    const result = run(where, payload)
    expect(result.stdout).toBe(`prev:${Buffer.byteLength(payload)}:ok`)
    expect(existsSync(join(where.statusDir, 'ae9082cf-4451-411e-845b-65cf4e620014.json'))).toBe(true)
  })

  it('never fails the status line on junk input or an unsafe session id', () => {
    const where = sandbox('{}')
    installBridge(where)
    expect(run(where, 'not json').status).toBe(0)
    expect(run(where, JSON.stringify({ session_id: '../escape' })).status).toBe(0)
    expect(existsSync(join(where.root, 'userData', 'escape.json'))).toBe(false)
  })
})

describe('readStatusDir', () => {
  it('parses saved payloads and skips damaged files', async () => {
    const where = sandbox('{}')
    installBridge(where)
    run()
    function run(): void {
      spawnSync(process.execPath, [join(where.binDir, BRIDGE_SCRIPT_NAME)], { input: payload })
    }
    writeFileSync(join(where.statusDir, 'broken.json'), '{nope', 'utf8')
    const infos = await readStatusDir(where.statusDir)
    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ sessionId: 'ae9082cf-4451-411e-845b-65cf4e620014', family: 'opus' })
    expect(await readStatusDir(join(where.root, 'missing'))).toEqual([])
  })
})
