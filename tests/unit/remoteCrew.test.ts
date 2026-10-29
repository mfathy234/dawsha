import { describe, expect, it, vi } from 'vitest'
import { sanitizeMember, type CrewMember } from '../../src/shared/crew'
import { checkRemoteRun, remoteCrewPayload, sanitizeCrewSnapshot } from '../../src/shared/remoteCrew'
import { createRemoteCrewBridge, createRemoteCrewHost } from '../../src/main/remoteCrew'
import { IPC } from '../../src/shared/ipc'
import { describeActivity } from '../../src/shared/remoteActivity'
import type { Project } from '../../src/shared/types'

const WIN_PATH = 'C:\\Users\\me\\.claude\\agents\\rami.md'

const member = (extra: Record<string, unknown>): CrewMember =>
  sanitizeMember({ id: 'rami', name: 'Rami', role: 'Reviews PRs', initials: 'RA', colour: 'green', instructions: 'SECRET instructions text', prompt: 'Review {{pr}} for {{focus}}', source: { kind: 'agent', path: WIN_PATH, linked: true }, ...extra })!

const project = (id: string, name: string): Project => ({ id, name, folder: `C:\\work\\${name}`, defaultAgent: 'claude' }) as Project

const members = [member({}), member({ id: 'pixel', name: 'Pixel', prompt: '', projects: ['Billing'] }), { ...member({ id: 'hidden', name: 'Ghost' }), hidden: true }]
const projects = [project('p1', 'Platforms'), project('p2', 'Billing')]

describe('phone crew payload', () => {
  it('lists names, colours, fields and live state, and never instructions, prompts or paths', () => {
    const payload = remoteCrewPayload(members, { states: { rami: 'working' }, jobs: [], goal: null })
    expect(payload.members.map((m) => m.name)).toEqual(['Rami', 'Pixel'])
    expect(payload.members[0]).toMatchObject({ id: 'rami', initials: 'RA', colour: 'green', fields: ['pr', 'focus'], state: 'working' })
    expect(payload.members[1]).toMatchObject({ fields: ['task'], state: 'idle', projects: ['Billing'] })
    const text = JSON.stringify(payload)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Review {{pr}}')
    expect(text).not.toContain('rami.md')
    expect(text).not.toContain('.claude')
  })

  it('keeps the Lead and hidden members off the phone', () => {
    const lead = { ...member({ id: 'maya', name: 'Maya' }), lead: true }
    const payload = remoteCrewPayload([lead, ...members], { states: {}, jobs: [], goal: null })
    expect(payload.members.map((m) => m.name)).not.toContain('Maya')
    expect(payload.members.map((m) => m.name)).not.toContain('Ghost')
  })

  it('reads a snapshot from the desktop defensively and words the status line itself', () => {
    const snapshot = sanitizeCrewSnapshot({
      states: { rami: 'working', bad: 'exploding' },
      jobs: [
        { runId: 'r1', memberId: 'rami', name: 'Rami', initials: 'RA', colour: 'green', task: 'PR 412', state: 'needs', line: '<script>', termId: 't1', cwd: 'C:\\secret' },
        { runId: '', name: 'x', state: 'working' },
        'junk'
      ],
      goal: { title: 'Ship it', state: 'working' }
    })
    expect(snapshot.states).toEqual({ rami: 'working' })
    expect(snapshot.jobs).toHaveLength(1)
    expect(snapshot.jobs[0].line).toMatch(/Waiting for you/)
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(snapshot.goal).toMatchObject({ title: 'Ship it', state: 'working' })
    expect(sanitizeCrewSnapshot(null)).toEqual({ states: {}, jobs: [], goal: null })
  })
})

describe('phone run validation', () => {
  const ok = { member: 'rami', project: 'p1', model: 'opus', fields: { pr: '412', focus: 'tests' } }

  it('accepts a known member, project, model and complete fields', () => {
    const result = checkRemoteRun(ok, members, projects)
    expect(result.ok && result.request).toMatchObject({ choice: 'opus', fields: { pr: '412', focus: 'tests' } })
    expect(result.ok && result.request.member.name).toBe('Rami')
    expect(result.ok && result.request.project.name).toBe('Platforms')
  })

  it.each([
    ['unknown member', { ...ok, member: 'nobody' }, /not available/],
    ['hidden member', { ...ok, member: 'hidden' }, /not available/],
    ['unknown project', { ...ok, project: 'p9' }, /project/],
    ['member outside its projects', { ...ok, member: 'pixel', fields: { task: 'x' } }, /limited to Billing/],
    ['unknown model', { ...ok, model: 'gpt-9' }, /model/],
    ['missing field', { ...ok, fields: { pr: '412' } }, /Fill in focus/],
    ['blank field', { ...ok, fields: { pr: ' ', focus: 'x' } }, /Fill in pr/],
    ['unknown field', { ...ok, fields: { ...ok.fields, rm: 'x' } }, /no field rm/],
    ['non-string field', { ...ok, fields: { pr: 4, focus: 'x' } }, /too long/],
    ['extra key', { ...ok, cwd: 'C:\\' }, /Invalid/]
  ])('refuses %s', (_name, input, message) => {
    const result = checkRemoteRun(input, members, projects)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(message)
  })

  it('refuses a body that is not an object', () => {
    expect(checkRemoteRun('rami', members, projects).ok).toBe(false)
    expect(checkRemoteRun(null, members, projects).ok).toBe(false)
  })

  it('runs a member whose scope matches the project', () => {
    const result = checkRemoteRun({ member: 'pixel', project: 'p2', fields: { task: 'fix it' } }, members, projects)
    expect(result.ok).toBe(true)
    expect(result.ok && result.request.choice).toBe('default')
  })
})

function fakeIpc() {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()
  return {
    listeners,
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => { listeners.set(channel, listener) },
    removeListener: (channel: string) => { listeners.delete(channel) }
  }
}

describe('crew bridge and host', () => {
  function setup(sendReply?: (id: string, request: Record<string, unknown>) => void, timeoutMs = 1000) {
    const ipc = fakeIpc()
    const send = vi.fn((channel: string, id: string, request: Record<string, unknown>) => {
      if (channel === IPC.remoteCrewRun) sendReply?.(id, request)
    })
    const window = { isDestroyed: () => false, webContents: { send: send as (channel: string, ...args: unknown[]) => void } }
    const bridge = createRemoteCrewBridge({ getWindow: () => window, ipc, timeoutMs })
    const settings = { get: () => ({ crew: { members: members.filter((m) => !m.hidden), hidden: [] }, projects }) }
    const host = createRemoteCrewHost({ settings, bridge })
    return { ipc, send, bridge, host }
  }
  const body = { member: 'rami', project: 'p1', fields: { pr: '1', focus: 'x' } }

  it('hands a validated run to the desktop window and returns its run id', async () => {
    const context = setup((id) => context.ipc.listeners.get(IPC.remoteCrewRunResult)!({}, id, { ok: true, runId: 'run42' }))
    const result = await context.host.run(body)
    expect(result).toEqual({ ok: true, runId: 'run42', member: 'Rami', project: 'Platforms' })
    expect(context.send).toHaveBeenCalledWith(IPC.remoteCrewRun, expect.any(String), { memberId: 'rami', projectId: 'p1', choice: 'default', fields: { pr: '1', focus: 'x' }, deadline: expect.any(Number) })
  })

  it('sends the desktop a deadline matching how long the phone waits', async () => {
    const before = Date.now()
    const context = setup(undefined, 5_000)
    void context.host.run(body)
    await vi.waitFor(() => expect(context.send).toHaveBeenCalled())
    const sent = context.send.mock.calls[0][2] as { deadline: number }
    expect(sent.deadline).toBeGreaterThanOrEqual(before + 5_000)
    expect(sent.deadline).toBeLessThanOrEqual(Date.now() + 5_000)
  })

  it('ignores a desktop answer that arrives after the phone gave up', async () => {
    const context = setup(undefined, 20)
    const result = await context.host.run(body)
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/in time/) })
    const id = context.send.mock.calls[0][1] as string
    expect(() => context.ipc.listeners.get(IPC.remoteCrewRunResult)!({}, id, { ok: true, runId: 'late' })).not.toThrow()
    expect(await context.host.run(body)).toMatchObject({ ok: false })
    expect(context.send).toHaveBeenCalledTimes(2)
  })

  it('never reaches the desktop window for an invalid run', async () => {
    const context = setup()
    const result = await context.host.run({ member: 'rami', project: 'p1', fields: {} })
    expect(result.ok).toBe(false)
    expect(context.send).not.toHaveBeenCalled()
  })

  it('reports the desktop error and times out when the window never answers', async () => {
    const failing = setup((id) => failing.ipc.listeners.get(IPC.remoteCrewRunResult)!({}, id, { ok: false, error: 'Could not open a pane for the run.' }))
    expect(await failing.host.run(body)).toEqual({ ok: false, error: 'Could not open a pane for the run.' })
    const silent = setup(undefined, 20)
    expect(await silent.host.run(body)).toMatchObject({ ok: false, error: expect.stringMatching(/in time/) })
  })

  it('lists the crew with the live state the desktop sent', () => {
    const context = setup()
    context.ipc.listeners.get(IPC.remoteCrewSnapshot)!({}, { states: { rami: 'needs' }, jobs: [], goal: null })
    expect(context.host.list().members.find((m) => m.id === 'rami')?.state).toBe('needs')
  })
})

describe('activity wording', () => {
  it('says which agent a phone ran and where', () => {
    expect(describeActivity({ id: '1', time: 1, device: 'Pixel 9', action: 'crew-run', session: 'Platforms', detail: 'Rami' })).toBe('Pixel 9 ran Rami on Platforms')
  })
})
