import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCodexCaches, readMeta } from '../../src/main/codexWatcher'

const ID = '019aaaaa-0000-7000-8000-000000000001'
const metaLine = `{"timestamp":"t","type":"session_meta","payload":{"session_id":"${ID}","id":"${ID}","cwd":"C:/Work/P","timestamp":"2026-01-02T10:00:03.127Z"}}\n`
const prompt = '{"timestamp":"t","type":"event_msg","payload":{"type":"user_message","message":"Fix the login bug"}}\n'

describe('readMeta cache', () => {
  beforeEach(() => clearCodexCaches())

  it('does not re-read a rollout with no prompt until it grows', async () => {
    const read = vi.fn(async () => metaLine)
    const size = metaLine.length
    expect((await readMeta('/r.jsonl', size, read))?.sessionId).toBe(ID)
    await readMeta('/r.jsonl', size, read)
    await readMeta('/r.jsonl', size, read)
    expect(read).toHaveBeenCalledTimes(1)
    await readMeta('/r.jsonl', size + prompt.length, read)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('stops reading once the prompt is found', async () => {
    const read = vi.fn(async () => metaLine + prompt)
    const size = metaLine.length + prompt.length
    await readMeta('/p.jsonl', size, read)
    await readMeta('/p.jsonl', size * 3, read)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
