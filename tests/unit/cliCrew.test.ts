import { describe, expect, it, vi } from 'vitest'
import { HELP_TEXT, cliWords, parseCli, runCli, type CliCommand, type CliHost } from '../../src/shared/cli'
import { defaultCrew } from '../../src/shared/crew'
import { crewMembers } from '../../src/shared/crewBuiltins'
import type { Project } from '../../src/shared/types'

const resolvePath = (path: string): string => (/^[A-Za-z]:/.test(path) ? path : `C:\\work\\${path}`)
const parse = (...args: string[]) => parseCli(args, 'C:\\work\\acme-web', resolvePath)

const PROJECTS: Project[] = [
  { id: 'a', name: 'acme-web', folder: 'C:\\work\\acme-web', defaultAgent: 'claude' },
  { id: 'b', name: 'billing-api', folder: 'C:\\work\\billing-api', defaultAgent: 'codex' }
]

function host(over: Partial<CliHost> = {}): CliHost {
  return {
    version: '1',
    projects: PROJECTS,
    layouts: [],
    now: 0,
    openCount: () => 0,
    listSessions: vi.fn(async () => []),
    addProject: vi.fn(),
    startSession: vi.fn(async () => 1),
    resumeSession: vi.fn(),
    openResumePicker: vi.fn(),
    openLayout: vi.fn(),
    updateAgents: vi.fn(),
    crewMembers: () => crewMembers({ ...defaultCrew(), hidden: ['hana'] }),
    crewRun: vi.fn(async () => ({ ok: true as const, runId: 'k3m9qz' })),
    crewRuns: () => [
      { id: 'k3m9qz', member: 'Sami', title: 'Sami · PR 7', state: 'working' },
      { id: 'p2', member: 'Yara', title: 'Yara · cli', state: 'done' }
    ],
    crewResult: vi.fn(async (run: string) => (run === 'k3m9qz' ? 'No blocking issues.' : null)),
    ...over
  } as CliHost
}

const run = (command: CliCommand, h: CliHost = host()) => runCli(command, h)

describe('crew command parsing', () => {
  it('parses list, status and result', () => {
    expect(parse('crew', 'list')).toEqual({ ok: true, command: { kind: 'crew-list' } })
    expect(parse('crew', 'status')).toEqual({ ok: true, command: { kind: 'crew-status', run: null } })
    expect(parse('crew', 'status', 'k3m9qz')).toEqual({ ok: true, command: { kind: 'crew-status', run: 'k3m9qz' } })
    expect(parse('crew', 'result', 'k3m9qz')).toEqual({ ok: true, command: { kind: 'crew-result', run: 'k3m9qz' } })
  })

  it('parses run with a project name, fields, a model and background', () => {
    expect(parse('crew', 'run', 'sami', '--project', 'acme-web', '--field', 'target=PR 7', '--model', 'opus', '--background')).toEqual({
      ok: true,
      command: { kind: 'crew-run', member: 'sami', project: 'acme-web', path: null, choice: 'opus', fields: { target: 'PR 7' }, background: true }
    })
  })

  it('parses a project path, inline values, values with equals signs and repeated fields', () => {
    const parsed = parse('crew', 'run', 'rami', '--project=C:\\work\\billing-api', '--field=pr=8841', '--field', 'mode=a=b', '--field', 'pr=9')
    expect(parsed).toEqual({
      ok: true,
      command: { kind: 'crew-run', member: 'rami', project: null, path: 'C:\\work\\billing-api', choice: 'default', fields: { pr: '9', mode: 'a=b' }, background: false }
    })
    expect(parse('crew', 'run', 'sami', '--project', '.\\sub')).toMatchObject({ command: { path: 'C:\\work\\.\\sub', project: null } })
  })

  it('does not let a field key pollute the prototype', () => {
    const parsed = parse('crew', 'run', 'sami', '--project', 'acme-web', '--field', '__proto__=x')
    if (!parsed.ok || parsed.command.kind !== 'crew-run') throw new Error('expected a run')
    expect(Object.keys(parsed.command.fields)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(Object.getPrototypeOf(parsed.command.fields)).toBe(Object.prototype)
  })

  it('rejects bad input with a plain message', () => {
    expect(parse('crew')).toEqual({ ok: false, error: 'crew needs list, run, status, result, plan, ask or note.' })
    expect(parse('crew', 'jump')).toMatchObject({ ok: false, error: expect.stringContaining("Unknown crew command 'jump'") })
    expect(parse('crew', 'run')).toEqual({ ok: false, error: 'crew run needs a member name.' })
    expect(parse('crew', 'run', 'sami')).toEqual({ ok: false, error: 'crew run needs --project <name|path>.' })
    expect(parse('crew', 'run', 'sami', '--project')).toEqual({ ok: false, error: '--project needs a value.' })
    expect(parse('crew', 'run', 'sami', '--project', 'x', '--model', 'gpt')).toMatchObject({ ok: false, error: expect.stringContaining("Unknown model 'gpt'") })
    expect(parse('crew', 'run', 'sami', '--project', 'x', '--model', 'default')).toMatchObject({ ok: false })
    expect(parse('crew', 'run', 'sami', '--project', 'x', '--field', 'novalue')).toMatchObject({ ok: false, error: expect.stringContaining('key=value') })
    expect(parse('crew', 'run', 'sami', '--project', 'x', '--field', '=x')).toMatchObject({ ok: false })
    expect(parse('crew', 'run', 'sami', '--project', 'x', '--field', `a=${'x'.repeat(5000)}`)).toMatchObject({ ok: false, error: expect.stringContaining('too long') })
    expect(parse('crew', 'run', 'a', 'b', '--project', 'x')).toEqual({ ok: false, error: "Unexpected argument 'b'." })
    expect(parse('crew', 'result')).toEqual({ ok: false, error: 'crew result needs a run id.' })
    expect(parse('crew', 'list', 'x')).toEqual({ ok: false, error: "Unexpected argument 'x'." })
  })

  it('keeps the crew flags out of other commands', () => {
    expect(parse('start', 'acme-web', '--project', 'x')).toEqual({ ok: false, error: "Unknown option '--project'." })
    expect(parse('ls', '--background')).toEqual({ ok: false, error: "Unknown option '--background'." })
  })

  it('knows crew as a command word and documents it', () => {
    expect(cliWords(['node', 'dawsha.cjs', 'crew', 'list'])).toEqual(['crew', 'list'])
    expect(HELP_TEXT).toContain('crew run <member> --project <name|path>')
    expect(HELP_TEXT).toContain('crew result <run>')
  })
})

describe('crew commands', () => {
  it('lists visible members with their fields', async () => {
    const out = (await run({ kind: 'crew-list' })).out.split('\n')
    expect(out[0]).toMatch(/^NAME\s+ROLE\s+MODEL\s+FIELDS$/)
    expect(out.join('\n')).toMatch(/Sami\s+Code reviewer\s+claude Sonnet\s+target/)
    expect(out.join('\n')).toMatch(/Maya\s+Lead\s+claude Opus\s+goal/)
    expect(out.join('\n')).not.toContain('Hana')
  })

  const runCmd = (over: Partial<Extract<CliCommand, { kind: 'crew-run' }>> = {}): CliCommand => ({
    kind: 'crew-run',
    member: 'sami',
    project: 'acme-web',
    path: null,
    choice: 'default',
    fields: { target: 'PR 7' },
    background: false,
    ...over
  })

  it('runs a member in a known project and prints only the run id', async () => {
    const h = host()
    expect(await run(runCmd({ choice: 'haiku', background: true }), h)).toEqual({ ok: true, exit: 0, out: 'k3m9qz' })
    expect(h.crewRun).toHaveBeenCalledWith(expect.objectContaining({ project: PROJECTS[0], choice: 'haiku', background: true, fields: { target: 'PR 7' } }))
    expect(vi.mocked(h.crewRun).mock.calls[0][0].member.id).toBe('sami')
    const byPath = host()
    await run(runCmd({ project: null, path: 'C:\\WORK\\billing-api\\' }), byPath)
    expect(vi.mocked(byPath.crewRun).mock.calls[0][0].project.id).toBe('b')
  })

  it('refuses an unknown member, the Lead, an unknown project and a folder that is not a project', async () => {
    const h = host()
    expect((await run(runCmd({ member: 'nobody' }), h)).out).toBe("No crew member named 'nobody'. Run dawsha crew list.")
    expect((await run(runCmd({ member: 'Maya' }), h)).out).toMatch(/is the Lead and takes goals from the Agents page/)
    expect((await run(runCmd({ project: 'nope' }), h)).out).toBe("No project named 'nope'. Run dawsha ls.")
    expect((await run(runCmd({ project: null, path: 'C:\\elsewhere' }), h)).out).toBe('C:\\elsewhere is not a project. Run dawsha add <path> first.')
    expect(h.crewRun).not.toHaveBeenCalled()
  })

  it('refuses unknown and missing fields, and members limited to other projects', async () => {
    const h = host()
    expect((await run(runCmd({ fields: { target: 'x', bogus: 'y' } }), h)).out).toBe("Sami has no field 'bogus'. Fields: target.")
    expect((await run(runCmd({ fields: {} }), h)).out).toBe('Sami needs --field target=....')
    expect((await run(runCmd({ fields: { target: '  ' } }), h)).ok).toBe(false)
    const scoped = host({ crewMembers: () => crewMembers(defaultCrew()).map((m) => (m.id === 'sami' ? { ...m, projects: ['billing-api'] } : m)) })
    expect((await run(runCmd(), scoped)).out).toBe('Sami is limited to billing-api, not acme-web.')
  })

  it('passes on a failure from the app', async () => {
    const h = host({ crewRun: vi.fn(async () => ({ ok: false as const, error: 'Gemini is not signed in.' })) })
    expect(await run(runCmd(), h)).toEqual({ ok: false, exit: 1, out: 'Gemini is not signed in.' })
  })

  it('prints a state word for one run and a table for all', async () => {
    expect(await run({ kind: 'crew-status', run: 'k3m9qz' })).toEqual({ ok: true, exit: 0, out: 'working' })
    expect((await run({ kind: 'crew-status', run: 'nope' })).out).toBe("No run 'nope'.")
    const table = (await run({ kind: 'crew-status', run: null })).out
    expect(table).toMatch(/RUN\s+MEMBER\s+STATE\s+TITLE/)
    expect(table).toMatch(/p2\s+Yara\s+done\s+Yara · cli/)
    expect((await run({ kind: 'crew-status', run: null }, host({ crewRuns: () => [] }))).out).toBe('No crew runs yet.')
  })

  it('prints a result or says the run is unknown', async () => {
    expect(await run({ kind: 'crew-result', run: 'k3m9qz' })).toEqual({ ok: true, exit: 0, out: 'No blocking issues.' })
    expect(await run({ kind: 'crew-result', run: 'zzz' })).toEqual({ ok: false, exit: 1, out: "No run 'zzz'." })
  })
})
