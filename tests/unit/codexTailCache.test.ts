import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearCodexCaches, readCodexSessions } from '../../src/main/codexWatcher'
import { codexStatusFromMarker, codexStatusFromTail, lastTurnMarker } from '../../src/shared/codexSession'

const ID = '019aaaaa-0000-7000-8000-000000000002'
const meta = `{"timestamp":"t","type":"session_meta","payload":{"session_id":"${ID}","id":"${ID}","cwd":"C:/Work/P","timestamp":"2026-01-02T10:00:03.127Z"}}\n`
const started = '{"timestamp":"t","type":"event_msg","payload":{"type":"task_started"}}\n'
const complete = '{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete"}}\n'

describe('Codex rollout tail', () => {
  beforeEach(() => clearCodexCaches())

  it('reads the status from the last turn marker, the same as from the tail', () => {
    const tail = meta + started
    expect(lastTurnMarker(tail)).toBe('task_started')
    expect(codexStatusFromMarker(lastTurnMarker(tail), 1000, 1500)).toBe(codexStatusFromTail(tail, 1000, 1500))
    expect(codexStatusFromMarker(lastTurnMarker(tail + complete), 1000, 1500)).toBe('idle')
  })

  it('sees a rollout change after the cached tail', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-'))
    const day = join(home, 'sessions', '2026', '01', '02')
    mkdirSync(day, { recursive: true })
    const file = join(day, `rollout-2026-01-02T10-00-03-${ID}.jsonl`)
    writeFileSync(file, meta + started)
    expect((await readCodexSessions(home))[0].status).toBe('busy')
    expect((await readCodexSessions(home))[0].status).toBe('busy')
    appendFileSync(file, complete)
    expect((await readCodexSessions(home))[0].status).toBe('idle')
  })
})
