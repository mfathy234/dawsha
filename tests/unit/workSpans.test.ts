import { mkdtemp, writeFile, appendFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkSpanReader } from '../../src/main/workSpans'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function file(text: string, extension = 'jsonl'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dawsha-work-spans-'))
  dirs.push(dir)
  const path = join(dir, `session.${extension}`)
  await writeFile(path, text)
  return path
}
const base = Date.parse('2026-10-16T10:00:00Z')
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString()
const lines = (...records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n')

it.each(['claude', 'codex'] as const)('reads every %s record including the middle of a long transcript and out-of-order times', async agent => {
  const path = await file(lines(...[0, 4, 8, 12, 16, 20, 60, 64, 62].map(m => ({ timestamp: at(m), content: 'x'.repeat(800_000) }))) + '\n{incomplete')
  expect(await new WorkSpanReader().read(path, agent)).toEqual([[base, base + 20 * 60_000], [base + 60 * 60_000, base + 64 * 60_000]])
})

it('reads Codex metadata timestamps and ignores malformed records and invalid timestamps', async () => {
  const path = await file(lines({ type: 'session_meta', payload: { timestamp: at(0) } }, { timestamp: 'bad' }, { timestamp: at(4) }, { timestamp: 123 }))
  expect(await new WorkSpanReader().read(path, 'codex')).toEqual([[base, base + 4 * 60_000]])
})

it.each([false, true])('streams Gemini messages and metadata (legacy JSON: %s) without treating text as activity', async legacy => {
  const messages = [0, 4, 8].map(m => ({ id: String(m), type: 'user', timestamp: at(m), content: 'quoted "timestamp": "2020-01-01" and \\ escapes' }))
  const text = legacy ? JSON.stringify({ startTime: at(0), lastUpdated: at(8), messages }, null, 2)
    : lines({ sessionId: 's', startTime: at(0) }, ...messages, { $set: { lastUpdated: at(8) } })
  expect(await new WorkSpanReader().read(await file(text, legacy ? 'json' : 'jsonl'), 'gemini')).toEqual([[base, base + 8 * 60_000]])
})

it('reuses unchanged spans, coalesces reads, and invalidates on size or modified time changes', async () => {
  const path = await file(lines({ timestamp: at(0) }, { timestamp: at(4) }))
  const reader = new WorkSpanReader()
  const [first, concurrent] = await Promise.all([reader.read(path, 'claude'), reader.read(path, 'claude')])
  expect(concurrent).toBe(first)
  expect(await reader.read(path, 'claude')).toBe(first)
  await appendFile(path, '\n' + lines({ timestamp: at(8) }))
  expect(await reader.read(path, 'claude')).toEqual([[base, base + 8 * 60_000]])
  await writeFile(path, lines({ timestamp: at(0) }, { timestamp: at(4) }, { timestamp: at(9) }))
  await utimes(path, new Date(), new Date(Date.now() + 2000))
  expect(await reader.read(path, 'claude')).toEqual([[base, base + 9 * 60_000]])
})

it('evicts old files at the cache limit and retries after read failures', async () => {
  const a = await file(lines({ timestamp: at(0) }))
  const b = await file(lines({ timestamp: at(1) }))
  const reader = new WorkSpanReader(1)
  const first = await reader.read(a, 'claude')
  await reader.read(b, 'claude')
  expect(await reader.read(a, 'claude')).not.toBe(first)
  await expect(reader.read(a + '.missing', 'claude')).rejects.toThrow()
  await writeFile(a + '.missing', lines({ timestamp: at(0) }))
  expect(await reader.read(a + '.missing', 'claude')).toEqual([[base, base + 60_000]])
  expect(await reader.read(await file('garbage\n{}'), 'claude')).toEqual([])
})
