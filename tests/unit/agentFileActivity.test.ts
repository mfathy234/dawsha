import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AgentFileActivity } from '../../src/main/agentFileActivity'
import type { AgentEditEvent } from '../../src/shared/codeNavExtras'
import type { TimelineEvent } from '../../src/shared/timeline'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-agent-files-'))
  roots.push(root)
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true }) }
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Tests'])
  git(['config', 'user.email', 'tests@example.test'])
  git(['config', 'core.autocrlf', 'false'])
  writeFileSync(join(root, 'a.ts'), 'original\n')
  git(['add', 'a.ts'])
  git(['commit', '-qm', 'initial'])
  writeFileSync(join(root, 'a.ts'), 'changed\nsecond\n')
  return root
}
const edit = (id: string, at: number, path: string): TimelineEvent => ({ id, at, path, kind: 'edit', text: 'edited file', editStatus: 'succeeded' })
it('returns file-level session evidence for changed lines without claiming line ownership', async () => {
  const root = fixture()
  const activity = new AgentFileActivity(async () => [
    { sessionId: 'first', agent: 'claude', events: [edit('1', 10, join(root, 'a.ts'))] },
    { sessionId: 'latest', agent: 'codex', events: [edit('2', 20, 'a.ts')] }
  ], () => undefined)
  expect(await activity.lineSessions(root, 'a.ts')).toMatchObject({ ok: true, precision: 'file', note: expect.stringMatching(/file.*line/i), lines: [
    { line: 1, session: { sessionId: 'latest', agent: 'codex', at: 20, precision: 'file' } },
    { line: 2, session: { sessionId: 'latest', precision: 'file' } }
  ] })
  expect(await activity.lineSessions(root, '../secret')).toMatchObject({ ok: false })
})
it('reports unknown ownership without evidence and ignores outside paths', async () => {
  const root = fixture()
  const activity = new AgentFileActivity(async () => [{ sessionId: 'outside', agent: 'claude', events: [edit('1', 1, join(root, '../a.ts'))] }], () => undefined)
  expect(await activity.lineSessions(root, 'a.ts')).toMatchObject({ ok: true, precision: 'unknown', lines: [{ line: 1 }, { line: 2 }] })
})
it('emits each newly recorded edit once, without replaying history or labeling reads as edits', async () => {
  const root = fixture()
  const events: AgentEditEvent[] = []
  let records = [edit('old', 10, 'a.ts')]
  const activity = new AgentFileActivity(async () => [{ sessionId: 'agent', agent: 'codex', events: records }], event => events.push(event))
  await activity.refresh(root)
  expect(events).toEqual([])
  const at = Date.now()
  records = [...records, edit('new', at, 'a.ts'), { id: 'read', at, path: 'a.ts', kind: 'read', text: 'read' }, edit('outside', at, '../secret')]
  await activity.refresh(root)
  await activity.refresh(root)
  expect(events).toEqual([{ folder: expect.any(String), path: 'a.ts', sessionId: 'agent', agent: 'codex', at, precision: 'file' }])
  activity.forget(root)
})
it('maps relative session edits correctly for a project under a repository root', async () => {
  const root = fixture()
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'app/code.ts'), 'new\n')
  const activity = new AgentFileActivity(async () => [{ sessionId: 'agent', agent: 'claude', events: [edit('1', 10, 'code.ts')] }], () => undefined)
  expect(await activity.lineSessions(join(root, 'app'), 'app/code.ts')).toMatchObject({ ok: true, precision: 'file', lines: [{ line: 1, session: { sessionId: 'agent' } }] })
})
it('does not replay a recorded edit when its session briefly disappears from discovery', async () => {
  const root = fixture()
  const events: AgentEditEvent[] = []
  let records = [edit('old', 10, 'a.ts')]
  let available = true
  const activity = new AgentFileActivity(async () => available ? [{ sessionId: 'agent', agent: 'codex', events: records }] : [], event => events.push(event))
  await activity.refresh(root)
  records = [...records, edit('new', Date.now(), 'a.ts')]
  await activity.refresh(root)
  available = false
  await activity.refresh(root)
  available = true
  await activity.refresh(root)
  expect(events).toHaveLength(1)
})
it('does not publish or retain a refresh after the folder is unwatched', async () => {
  const root = fixture()
  const events: AgentEditEvent[] = []
  let release: (() => void) | undefined
  let waiting = false
  const activity = new AgentFileActivity(async () => {
    if (waiting) await new Promise<void>(resolve => { release = resolve })
    return [{ sessionId: 'agent', agent: 'codex', events: [edit('new', waiting ? Date.now() : 10, 'a.ts')] }]
  }, event => events.push(event))
  await activity.refresh(root)
  waiting = true
  const pending = activity.refresh(root)
  await new Promise(resolve => setImmediate(resolve))
  activity.forget(root)
  release?.()
  await pending
  expect(events).toHaveLength(0)
})
it('excludes failed and pending attempts from both attribution and follow events', async () => {
  const root = fixture()
  const emitted: AgentEditEvent[] = []
  let records: TimelineEvent[] = []
  const activity = new AgentFileActivity(async () => [{ sessionId: 'agent', agent: 'codex', events: records }], event => emitted.push(event))
  await activity.refresh(root)
  records = [{ ...edit('failed', Date.now(), 'a.ts'), editStatus: 'failed' }, { ...edit('pending', Date.now(), 'a.ts'), editStatus: 'pending' }]
  await activity.refresh(root)
  expect(emitted).toHaveLength(0)
  expect(await activity.lineSessions(root, 'a.ts')).toMatchObject({ ok: true, precision: 'unknown' })
})
