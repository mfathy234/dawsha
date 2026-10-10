import { describe, expect, it, vi } from 'vitest'
import { HELP_TEXT, cliWords, findProject, parseCli, runCli, table, type CliCommand, type CliHost } from '../../src/shared/cli'
import type { Project, ResumeSession, SavedLayout } from '../../src/shared/types'

const CWD = 'C:\\work\\acme-web'
const resolvePath = (path: string): string => (/^[A-Za-z]:/.test(path) ? path : `C:\\work\\${path}`)
const parse = (...args: string[]) => parseCli(args, CWD, resolvePath)

const PROJECTS: Project[] = [
  { id: 'a', name: 'acme-web', folder: 'C:\\work\\acme-web', defaultAgent: 'claude' },
  { id: 'b', name: 'billing-api', folder: 'C:\\work\\billing-api', defaultAgent: 'codex' },
  { id: 'd', name: 'docs-site', folder: 'C:\\work\\docs-site', defaultAgent: 'claude' }
]

const LAYOUTS: SavedLayout[] = [
  {
    id: 'l1',
    name: 'Morning',
    createdAt: 1,
    focusedIndex: 0,
    panes: [
      { projectId: 'a', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'claude', label: 'claude' }] },
      { projectId: 'b', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'codex', label: 'codex' }] },
      { projectId: 'a', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'shell', label: 'shell' }] }
    ]
  },
  {
    id: 'l2',
    name: 'Docs day',
    createdAt: 2,
    focusedIndex: 0,
    panes: [{ projectId: 'gone', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'gemini', label: 'gemini' }] }]
  }
]

const session = (over: Partial<ResumeSession> = {}): ResumeSession => ({
  agent: 'claude',
  id: '7c1e04aa-0000-4000-8000-000000000001',
  title: 'Add dark mode toggle',
  projectId: 'a',
  modifiedAt: 1_000_000 - 12 * 60_000,
  startedAt: 0,
  messageCount: 34,
  ...over
})

function host(over: Partial<CliHost> = {}): CliHost {
  return {
    version: '0.3.0',
    projects: PROJECTS,
    layouts: LAYOUTS,
    now: 1_000_000,
    openCount: (id) => (id === 'a' ? 2 : 0),
    listSessions: vi.fn(async () => [session()]),
    addProject: vi.fn(async (folder: string, name?: string) => ({
      id: 'n',
      name: name ?? 'new-thing',
      folder,
      defaultAgent: 'claude' as const
    })),
    startSession: vi.fn(async () => 3),
    resumeSession: vi.fn(async () => ({ pane: 4, alreadyOpen: false })),
    openResumePicker: vi.fn(),
    openLayout: vi.fn(async (name: string) => ({ ok: true, text: `Opened layout '${name}' (3 panes)` })),
    updateAgents: vi.fn(async () => 'Updating the agents in a shell tab.'),
    ...over
  }
}

const run = (command: CliCommand, h: CliHost = host()) => runCli(command, h)

describe('parseCli', () => {
  it('treats no arguments and open as open', () => {
    expect(parse()).toEqual({ ok: true, command: { kind: 'open' } })
    expect(parse('open')).toEqual({ ok: true, command: { kind: 'open' } })
  })

  it('parses help and version spellings', () => {
    for (const word of ['--help', '-h', 'help']) expect(parse(word)).toEqual({ ok: true, command: { kind: 'help' } })
    for (const word of ['--version', '-v']) expect(parse(word)).toEqual({ ok: true, command: { kind: 'version' } })
  })

  it('turns a dot into a start of the working folder', () => {
    expect(parse('.')).toEqual({ ok: true, command: { kind: 'start', target: null, path: CWD, agent: undefined, here: false } })
    expect(parse('.', '--agent', 'codex', '--here')).toMatchObject({
      ok: true,
      command: { kind: 'start', agent: 'codex', here: true }
    })
  })

  it('parses start with a project name, a path and an inline agent value', () => {
    expect(parse('start', 'billing-api', '--agent', 'codex')).toEqual({
      ok: true,
      command: { kind: 'start', target: 'billing-api', path: null, agent: 'codex', here: false }
    })
    expect(parse('start', 'C:\\work\\docs-site', '--agent=gemini')).toMatchObject({
      ok: true,
      command: { kind: 'start', target: null, path: 'C:\\work\\docs-site', agent: 'gemini' }
    })
  })

  it('parses resume with a project, --last and an agent, defaulting to the working folder', () => {
    expect(parse('resume')).toMatchObject({
      ok: true,
      command: { kind: 'resume', project: null, path: CWD, last: false }
    })
    expect(parse('resume', 'billing-api', '--last', '--agent', 'claude')).toMatchObject({
      ok: true,
      command: { kind: 'resume', project: 'billing-api', last: true, agent: 'claude' }
    })
  })

  it('parses ls, sessions, add and update-agents', () => {
    expect(parse('ls')).toEqual({ ok: true, command: { kind: 'ls' } })
    expect(parse('sessions', 'acme-web')).toEqual({ ok: true, command: { kind: 'sessions', project: 'acme-web' } })
    expect(parse('sessions')).toEqual({ ok: true, command: { kind: 'sessions', project: null } })
    expect(parse('add', 'C:\\work\\new-thing', '--name', 'thing')).toEqual({
      ok: true,
      command: { kind: 'add', path: 'C:\\work\\new-thing', name: 'thing' }
    })
    expect(parse('update-agents')).toEqual({ ok: true, command: { kind: 'update-agents' } })
  })

  it('parses open with a layout name, joining several words and reading the mode', () => {
    expect(parse('open', 'morning')).toEqual({ ok: true, command: { kind: 'open-layout', name: 'morning', mode: undefined } })
    expect(parse('open', 'docs', 'day', '--replace')).toEqual({
      ok: true,
      command: { kind: 'open-layout', name: 'docs day', mode: 'replace' }
    })
    expect(parse('open', 'morning', '--alongside')).toMatchObject({ command: { mode: 'add' } })
    expect(parse('open', 'morning', '--replace', '--alongside')).toEqual({
      ok: false,
      error: 'Use --replace or --alongside, not both.'
    })
    expect(parse('open', '--bogus')).toEqual({ ok: false, error: "Unknown option '--bogus'." })
    expect(parse('layouts')).toEqual({ ok: true, command: { kind: 'layouts' } })
  })

  it('rejects unknown commands, options, agents and missing values', () => {
    expect(parse('launch')).toEqual({ ok: false, error: "Unknown command 'launch'. Run dawsha --help." })
    expect(parse('ls', '--wide')).toEqual({ ok: false, error: "Unknown option '--wide'." })
    expect(parse('start', 'x', '--agent', 'cursor')).toEqual({
      ok: false,
      error: "Unknown agent 'cursor'. Use claude, codex or gemini."
    })
    expect(parse('start', 'x', '--agent')).toEqual({ ok: false, error: '--agent needs a value.' })
    expect(parse('start')).toEqual({ ok: false, error: 'start needs a project name or a folder.' })
    expect(parse('add')).toEqual({ ok: false, error: 'add needs a folder.' })
    expect(parse('ls', 'extra', 'more')).toEqual({ ok: false, error: "Unexpected argument 'more'." })
  })
})

describe('cliWords', () => {
  it('only accepts a known first word so Chromium switches never run as commands', () => {
    expect(cliWords(['ls'])).toEqual(['ls'])
    expect(cliWords(['.'])).toEqual(['.'])
    expect(cliWords(['layouts'])).toEqual(['layouts'])
    expect(cliWords(['open', 'morning', '--replace'])).toEqual(['open', 'morning', '--replace'])
    expect(cliWords(['--version'])).toEqual(['--version'])
    expect(cliWords(['--no-sandbox'])).toBeNull()
    expect(cliWords(['--allow-file-access-from-files', 'ls', '--wide'])).toEqual(['ls', '--wide'])
    expect(cliWords([])).toBeNull()
  })
})

describe('table', () => {
  it('pads columns by the widest cell and leaves the last column ragged', () => {
    expect(table(['NAME', 'N'], [['acme-web', '2'], ['docs', '0']])).toBe('NAME      N\nacme-web  2\ndocs      0')
  })
})

describe('runCli', () => {
  it('prints help and the version', async () => {
    expect((await run({ kind: 'help' })).out).toBe(HELP_TEXT)
    expect(await run({ kind: 'version' })).toEqual({ ok: true, exit: 0, out: 'Dawsha 0.3.0' })
  })

  it('lists projects with their open session counts', async () => {
    const reply = await run({ kind: 'ls' })
    const rows = reply.out.split('\n')
    expect(rows[0]).toMatch(/^NAME\s+AGENT\s+FOLDER\s+SESSIONS$/)
    expect(rows[1]).toMatch(/^acme-web\s+claude\s+C:\\work\\acme-web\s+2$/)
    expect(rows[2]).toMatch(/^billing-api\s+codex\s+C:\\work\\billing-api\s+0$/)
  })

  it('says so when there are no projects', async () => {
    expect((await run({ kind: 'ls' }, host({ projects: [] }))).out).toBe('No projects yet. Run dawsha add <path>.')
  })

  it('starts the default agent of an existing project', async () => {
    const h = host()
    const reply = await run({ kind: 'start', target: 'acme-web', path: null, here: false }, h)
    expect(reply.out).toBe('acme-web: started Claude Code (default agent) in a new pane')
    expect(h.startSession).toHaveBeenCalledWith('a', undefined, false)
  })

  it('starts a chosen agent and reports the pane', async () => {
    const reply = await run({ kind: 'start', target: 'billing-api', path: null, agent: 'codex', here: false })
    expect(reply.out).toBe('billing-api: started Codex in pane 3')
  })

  it('fails on an unknown project name', async () => {
    const reply = await run({ kind: 'start', target: 'nope', path: null, here: false })
    expect(reply).toEqual({ ok: false, exit: 1, out: "No project named 'nope'. Run dawsha ls." })
  })

  it('adds a folder that is not a project yet and then starts it', async () => {
    const h = host()
    const reply = await run({ kind: 'start', target: null, path: 'C:\\work\\new-thing', here: false }, h)
    expect(h.addProject).toHaveBeenCalledWith('C:\\work\\new-thing')
    expect(h.startSession).toHaveBeenCalledWith('n', undefined, false)
    expect(reply.out).toBe('Added project new-thing · started Claude Code')
  })

  it('does not add a folder twice, ignoring case and trailing separators', async () => {
    const h = host()
    const reply = await run({ kind: 'start', target: null, path: 'c:\\WORK\\acme-web\\', here: false }, h)
    expect(h.addProject).not.toHaveBeenCalled()
    expect(reply.out).toContain('acme-web: started')
  })

  it('passes add errors through', async () => {
    const h = host({ addProject: vi.fn(async () => 'C:\\x: This folder does not exist.') })
    expect(await run({ kind: 'add', path: 'C:\\x' }, h)).toEqual({ ok: false, exit: 1, out: 'C:\\x: This folder does not exist.' })
    expect((await run({ kind: 'add', path: 'C:\\work\\docs', name: 'docs' })).out).toBe('Added project docs (C:\\work\\docs)')
  })

  it('opens the resume picker for the project of the working folder', async () => {
    const h = host()
    const reply = await run({ kind: 'resume', project: null, path: CWD, last: false }, h)
    expect(h.openResumePicker).toHaveBeenCalledWith('a')
    expect(reply.out).toBe('Opened the resume picker for acme-web')
    const other = await run({ kind: 'resume', project: null, path: 'C:\\elsewhere', last: false }, h)
    expect(h.openResumePicker).toHaveBeenLastCalledWith(undefined)
    expect(other.out).toBe('Opened the resume picker')
  })

  it('resumes the newest matching session with --last', async () => {
    const h = host()
    const reply = await run({ kind: 'resume', project: null, path: CWD, last: true, agent: 'claude' }, h)
    expect(h.listSessions).toHaveBeenCalledWith({ projectId: 'a', agent: 'claude', limit: 1 })
    expect(reply.out).toBe("Resumed 'Add dark mode toggle' (Claude Code) in pane 4")
  })

  it('reports an already open session and an empty history', async () => {
    const open = host({ resumeSession: vi.fn(async () => ({ pane: 2, alreadyOpen: true })) })
    expect((await run({ kind: 'resume', project: 'acme-web', path: null, last: true }, open)).out).toBe(
      "'Add dark mode toggle' (Claude Code) is already open in pane 2"
    )
    const none = host({ listSessions: vi.fn(async () => []) })
    expect(await run({ kind: 'resume', project: 'acme-web', path: null, last: true }, none)).toEqual({
      ok: false,
      exit: 1,
      out: 'No earlier sessions found.'
    })
  })

  it('lists earlier sessions with relative age and a short id', async () => {
    const reply = await run({ kind: 'sessions', project: 'acme-web' })
    expect(reply.out).toBe('AGENT   TITLE                 LAST ACTIVE  ID\nclaude  Add dark mode toggle  12m ago      7c1e04')
    expect((await run({ kind: 'sessions', project: 'nope' })).ok).toBe(false)
  })

  it('lists saved layouts with their pane counts and projects', async () => {
    const reply = await run({ kind: 'layouts' })
    expect(reply.out).toBe(
      ['NAME      PANES    PROJECTS', 'Morning   3 panes  acme-web, billing-api', 'Docs day  1 pane   removed project'].join('\n')
    )
    expect((await run({ kind: 'layouts' }, host({ layouts: [] }))).out).toBe(
      'No saved layouts. Use Layouts in the top bar to save one.'
    )
  })

  it('opens a layout through the host and reports failures with a non-zero exit', async () => {
    const h = host()
    const reply = await run({ kind: 'open-layout', name: 'morning', mode: 'add' }, h)
    expect(h.openLayout).toHaveBeenCalledWith('morning', 'add')
    expect(reply).toEqual({ ok: true, exit: 0, out: "Opened layout 'morning' (3 panes)" })
    const missing = host({ openLayout: vi.fn(async () => ({ ok: false, text: "No layout named 'x'. Run dawsha layouts." })) })
    expect(await run({ kind: 'open-layout', name: 'x' }, missing)).toEqual({
      ok: false,
      exit: 1,
      out: "No layout named 'x'. Run dawsha layouts."
    })
  })

  it('delegates update-agents to the host', async () => {
    expect((await run({ kind: 'update-agents' })).out).toBe('Updating the agents in a shell tab.')
  })
})

describe('findProject', () => {
  it('matches names case-insensitively and folders by normalized path', () => {
    expect(findProject(PROJECTS, 'ACME-WEB', null)?.id).toBe('a')
    expect(findProject(PROJECTS, null, 'c:/work/docs-site/')?.id).toBe('d')
    expect(findProject(PROJECTS, null, null)).toBeUndefined()
  })
})
