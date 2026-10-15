import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCast } from '../../src/shared/cast'
import { DAY_MS, MEGABYTE, type RecordingSettings } from '../../src/shared/recordings'
import { Recorder } from '../../src/main/recorder'
import { RecordingService } from '../../src/main/recordings'

const info = { projectId: 'p1', projectName: 'Billing', agent: 'claude' as const, title: 'Add retry', cwd: 'C:/work/billing' }

function castFiles(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((day) => readdirSync(join(root, day)).filter((name) => name.endsWith('.cast')).map((name) => join(root, day, name)))
}

describe('Recorder', () => {
  let root: string
  let now: number
  let enabled: boolean
  const make = (overrides: Partial<ConstructorParameters<typeof Recorder>[0]> = {}): Recorder =>
    new Recorder({ root, enabled: () => enabled, clock: () => now, wallClock: () => 1_760_000_000_000, ...overrides })

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'dawsha-rec-')), 'recordings')
    now = 5000
    enabled = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(join(root, '..'), { recursive: true, force: true })
  })

  it('writes the header and sidecar at start, then timestamped output', async () => {
    const recorder = make()
    const id = recorder.start('term-1', info, { cols: 100, rows: 30 })
    expect(id).not.toBeNull()
    now += 1500
    recorder.output('term-1', 'hello\r\n')
    await recorder.closeAll()
    const [file] = castFiles(root)
    const parsed = parseCast(readFileSync(file, 'utf8'))
    expect(parsed?.header).toMatchObject({ width: 100, height: 30, title: 'Add retry' })
    expect(parsed?.events).toEqual([{ t: 1.5, kind: 'o', data: 'hello\r\n' }])
    const meta = JSON.parse(readFileSync(file.replace('.cast', '.json'), 'utf8'))
    expect(meta).toMatchObject({ terminalId: 'term-1', projectName: 'Billing', agent: 'claude', cwd: 'C:/work/billing', cols: 100, rows: 30 })
    expect(typeof meta.endedAt).toBe('number')
  })

  it('batches: nothing but the header is written until the flush interval passes', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'a')
    now += 100
    recorder.output('t', 'b')
    await recorder.settle()
    expect(parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events).toEqual([])
    vi.advanceTimersByTime(250)
    await recorder.settle()
    expect(parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events.map((event) => event.data)).toEqual(['a', 'b'])
    await recorder.closeAll()
  })

  it('writes early once the pending bytes pass the size threshold', async () => {
    const recorder = make({ flushBytes: 50 })
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'x'.repeat(80))
    await recorder.settle()
    expect(parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events).toHaveLength(1)
    await recorder.closeAll()
  })

  it('coalesces output that arrives within a few milliseconds into one event', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    for (let i = 0; i < 20; i += 1) {
      recorder.output('t', `${i};`)
      now += 1
    }
    now += 500
    recorder.output('t', 'later')
    await recorder.closeAll()
    const events = parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events ?? []
    expect(events.map((event) => event.kind)).toEqual(['o', 'o'])
    expect(events[events.length - 1]).toMatchObject({ data: 'later' })
    expect(events[0].data).toContain('0;1;2;3;')
  })

  it('records resize events in order with the output around them', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'before')
    now += 100
    recorder.resize('t', 120, 40)
    now += 100
    recorder.output('t', 'after')
    await recorder.closeAll()
    const events = parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events ?? []
    expect(events.map((event) => [event.kind, event.data])).toEqual([['o', 'before'], ['r', '120x40'], ['o', 'after']])
  })

  it('adds a prompt marker when the user presses Enter in an agent tab, throttled', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.input('t', 'typing')
    recorder.input('t', '\r')
    now += 200
    recorder.input('t', '\r')
    now += 2000
    recorder.input('t', 'more\r')
    await recorder.closeAll()
    const markers = parseCast(readFileSync(castFiles(root)[0], 'utf8'))?.events.filter((event) => event.kind === 'm') ?? []
    expect(markers.map((event) => event.data)).toEqual(['prompt', 'prompt'])
  })

  it('does not add prompt markers in plain shells and never records typed text', async () => {
    const recorder = make()
    recorder.start('t', { ...info, agent: 'shell' }, { cols: 80, rows: 24 })
    recorder.input('t', 'secret\r')
    await recorder.closeAll()
    const text = readFileSync(castFiles(root)[0], 'utf8')
    expect(text).not.toContain('secret')
    expect(parseCast(text)?.events).toEqual([])
  })

  it('adds an exit marker and the exit code when the process ends', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'bye')
    now += 50
    recorder.stop('t', 3)
    await recorder.settle()
    const [file] = castFiles(root)
    expect(parseCast(readFileSync(file, 'utf8'))?.events.map((event) => [event.kind, event.data])).toEqual([['o', 'bye'], ['m', 'exit']])
    expect(JSON.parse(readFileSync(file.replace('.cast', '.json'), 'utf8')).exitCode).toBe(3)
  })

  it('never creates a file while the setting is off', async () => {
    enabled = false
    const recorder = make()
    expect(recorder.start('t', info, { cols: 80, rows: 24 })).toBeNull()
    recorder.output('t', 'text')
    await recorder.closeAll()
    expect(castFiles(root)).toEqual([])
  })

  it('stops recording when the setting is turned off mid-session', async () => {
    const recorder = make()
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'kept')
    now += 100
    enabled = false
    recorder.output('t', 'dropped')
    now += 100
    enabled = true
    recorder.output('t', 'also dropped')
    await recorder.closeAll()
    const text = readFileSync(castFiles(root)[0], 'utf8')
    expect(text).toContain('kept')
    expect(text).not.toContain('dropped')
    expect(recorder.activeIds().size).toBe(0)
  })

  it('starting the same terminal again closes the first recording and opens a new file', async () => {
    let wall = 1_760_000_000_000
    const recorder = make({ wallClock: () => (wall += 1000) })
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'first')
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'second')
    await recorder.closeAll()
    expect(castFiles(root)).toHaveLength(2)
  })

  it('reports write errors instead of throwing into the terminal path', async () => {
    const errors: Error[] = []
    writeFileSync(join(root, '..', 'blocker'), 'x')
    const recorder = new Recorder({ root: join(root, '..', 'blocker', 'nested'), enabled: () => true, clock: () => now, onError: (error) => errors.push(error) })
    recorder.start('t', info, { cols: 80, rows: 24 })
    recorder.output('t', 'data')
    await expect(recorder.closeAll()).resolves.toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('updates the pane title in the sidecar', async () => {
    const recorder = make()
    recorder.start('t', { ...info, title: '' }, { cols: 80, rows: 24 })
    recorder.setTitle('t', 'Named later')
    await recorder.settle()
    const [file] = castFiles(root)
    expect(JSON.parse(readFileSync(file.replace('.cast', '.json'), 'utf8')).title).toBe('Named later')
    await recorder.closeAll()
  })
})

describe('RecordingService', () => {
  let base: string
  let root: string
  let settings: RecordingSettings
  let clockNow: number

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'dawsha-recsvc-'))
    root = join(base, 'recordings')
    settings = { enabled: true, keepDays: 14, maxMegabytes: 1024 }
    clockNow = 1_760_000_000_000
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  async function record(recorder: Recorder, terminal: string, text: string, wall: number): Promise<string> {
    const id = recorder.start(terminal, info, { cols: 80, rows: 24 })
    recorder.output(terminal, text)
    recorder.stop(terminal, 0)
    await recorder.settle()
    if (!id) throw new Error('not recorded')
    const age = new Date(wall)
    for (const ext of ['cast', 'json']) utimesSync(join(root, `${id}.${ext}`), age, age)
    return id
  }

  function setup(): { recorder: Recorder; service: RecordingService } {
    let wall = clockNow
    const recorder = new Recorder({ root, enabled: () => true, wallClock: () => (wall += 1000) })
    return { recorder, service: new RecordingService(root, recorder, () => settings, () => clockNow) }
  }

  it('lists recordings newest first with sizes and metadata', async () => {
    const { recorder, service } = setup()
    const first = await record(recorder, 'a', 'one', clockNow)
    const second = await record(recorder, 'b', 'two', clockNow)
    const list = await service.list()
    expect(list.map((item) => item.id)).toEqual([second, first])
    expect(list[0]).toMatchObject({ terminalId: 'b', projectName: 'Billing', agent: 'claude', live: false })
    expect(list[0].bytes).toBeGreaterThan(0)
    expect((await service.stats()).count).toBe(2)
  })

  it('reads a recording by id and refuses ids that escape the folder', async () => {
    const { recorder, service } = setup()
    const id = await record(recorder, 'a', 'content', clockNow)
    expect(await service.read(id)).toContain('content')
    await expect(service.read('../../etc/passwd')).rejects.toThrow('Unknown recording')
  })

  it('deletes recordings older than the keep window at cleanup', async () => {
    const { recorder, service } = setup()
    const old = await record(recorder, 'old', 'old', clockNow - 30 * DAY_MS)
    const fresh = await record(recorder, 'fresh', 'fresh', clockNow - DAY_MS)
    expect(await service.cleanup()).toEqual([old])
    expect((await service.list()).map((item) => item.id)).toEqual([fresh])
  })

  it('deletes the oldest recordings when the total passes the size cap', async () => {
    const { recorder, service } = setup()
    settings = { ...settings, maxMegabytes: 50 }
    const big = 'x'.repeat(30 * MEGABYTE)
    const a = await record(recorder, 'a', big, clockNow - 3 * DAY_MS)
    const b = await record(recorder, 'b', big, clockNow - 2 * DAY_MS)
    const c = await record(recorder, 'c', 'small', clockNow - DAY_MS)
    const doomed = await service.cleanup()
    expect(doomed).toEqual([a])
    expect((await service.list()).map((item) => item.id).sort()).toEqual([b, c].sort())
  })

  it('keeps live recordings out of delete-all and removes empty day folders', async () => {
    const { recorder, service } = setup()
    await record(recorder, 'done', 'done', clockNow)
    recorder.start('live', info, { cols: 80, rows: 24 })
    recorder.output('live', 'running')
    expect(await service.deleteAll()).toBe(1)
    const remaining = await service.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].live).toBe(true)
    await recorder.closeAll()
    expect(await service.deleteAll()).toBe(1)
    expect(readdirSync(root)).toEqual([])
  })

  it('closes recordings left open by a crash using the file time', async () => {
    const { recorder, service } = setup()
    const id = await record(recorder, 'a', 'x', clockNow)
    const sidecar = join(root, `${id}.json`)
    const meta = JSON.parse(readFileSync(sidecar, 'utf8'))
    writeFileSync(sidecar, JSON.stringify({ ...meta, endedAt: null }))
    await service.cleanup()
    expect((await service.list())[0].endedAt).not.toBeNull()
  })

  it('ignores folders and files it does not own', async () => {
    const { recorder, service } = setup()
    await record(recorder, 'a', 'x', clockNow)
    writeFileSync(join(root, 'notes.txt'), 'keep me')
    expect(await service.list()).toHaveLength(1)
    await service.deleteAll()
    expect(existsSync(join(root, 'notes.txt'))).toBe(true)
  })
})
