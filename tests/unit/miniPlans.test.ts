import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniPlans } from '../../src/main/miniPlans'
import { locateSession } from '../../src/main/transcriptExport'
import type { MiniPlanRequest } from '../../src/shared/miniWindow'

vi.mock('../../src/main/transcriptExport', () => ({ locateSession: vi.fn(async (request: MiniPlanRequest) => ({ path: join(request.folder, `${request.sessionId}.jsonl`), modifiedAt: 0 })) }))
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks() })
const plan = (id: string, status: string): string => JSON.stringify({ type: 'assistant', uuid: id, message: { content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos: [{ content: 'Run tests', status }] } }] } }) + '\n'

describe('Mini plan readers', () => {
  it('updates more than eight real logs incrementally without recycling their readers or stale versions', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'dawsha-mini-plans-'))
    dirs.push(folder)
    const requests: MiniPlanRequest[] = Array.from({ length: 12 }, (_, n) => ({ paneId: `p${n}`, agent: 'claude', sessionId: `s${n}`, folder }))
    for (const request of requests) writeFileSync(join(folder, `${request.sessionId}.jsonl`), plan('a', 'in_progress'))
    const reader = new MiniPlans()
    expect(Object.keys(await reader.read(requests))).toHaveLength(12)
    expect(locateSession).toHaveBeenCalledTimes(12)
    for (const request of requests) appendFileSync(join(folder, `${request.sessionId}.jsonl`), plan('b', 'completed'))
    const updated = await reader.read(requests)
    expect(Object.values(updated).every(items => items[0]?.status === 'completed')).toBe(true)
    expect(locateSession).toHaveBeenCalledTimes(12)
    await reader.read([])
    await reader.read(requests.slice(0, 1))
    expect(locateSession).toHaveBeenCalledTimes(13)
    reader.clear()
    await reader.read(requests.slice(0, 1))
    expect(locateSession).toHaveBeenCalledTimes(14)
  })
  it('ignores missing logs and discards an in-flight result when the window hides', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'dawsha-mini-plans-'))
    dirs.push(folder)
    const reader = new MiniPlans()
    const request: MiniPlanRequest = { paneId: 'p', agent: 'claude', sessionId: 's', folder }
    expect(await reader.read([request])).toEqual({})
    writeFileSync(join(folder, 's.jsonl'), plan('a', 'pending'))
    reader.clear()
    const pending = reader.read([request])
    reader.clear()
    expect(await pending).toEqual({})
    expect((await reader.read([request])).p).toEqual([{ text: 'Run tests', status: 'pending' }])
  })
})
