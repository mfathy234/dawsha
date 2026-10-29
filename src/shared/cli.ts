import { AGENT_NAMES, isAgent } from './agents'
import { formatAge } from './statusLine'
import { normalizePath } from './sessionMatch'
import { layoutProjectNames, paneCountText } from './layouts'
import { FIELD_VALUE_MAX, RUN_CHOICES, inScope, isRunChoice, modelLabel, runFields, type CrewMember, type RunChoice } from './crew'
import type { AgentKind, Project, ResumeQuery, ResumeSession, SavedLayout } from './types'

export type LayoutMode = 'replace' | 'add'

export type CliCommand =
  | { kind: 'open' }
  | { kind: 'open-layout'; name: string; mode?: LayoutMode }
  | { kind: 'layouts' }
  | { kind: 'start'; target: string | null; path: string | null; agent?: AgentKind; here: boolean }
  | { kind: 'resume'; project: string | null; path: string | null; last: boolean; agent?: AgentKind }
  | { kind: 'ls' }
  | { kind: 'sessions'; project: string | null }
  | { kind: 'add'; path: string; name?: string }
  | { kind: 'update-agents' }
  | { kind: 'crew-list' }
  | {
      kind: 'crew-run'
      member: string
      project: string | null
      path: string | null
      choice: RunChoice
      fields: Record<string, string>
      background: boolean
    }
  | { kind: 'crew-status'; run: string | null }
  | { kind: 'crew-result'; run: string }
  | { kind: 'help' }
  | { kind: 'version' }

export type CliParse = { ok: true; command: CliCommand } | { ok: false; error: string }

export interface CliRequest {
  args: string[]
  cwd: string
}

export interface CliReply {
  ok: boolean
  exit: number
  out: string
}

export const COMMAND_NAMES = ['open', 'start', 'resume', 'ls', 'layouts', 'sessions', 'add', 'update-agents', 'crew', 'help'] as const

export const HELP_TEXT = [
  'Usage: dawsha [command]',
  '',
  '  open                                   Open Dawsha (default)',
  '  open <layout> [--replace|--alongside]  Open a saved layout',
  '  layouts                                List saved layouts',
  '  . | start <project|path>               Start a session in a project',
  '      [--agent claude|codex|gemini] [--here]',
  '  resume [project] [--last] [--agent]    Resume an earlier session',
  '  ls                                     List projects',
  '  sessions [project]                     List earlier sessions',
  '  add <path> [--name]                    Add a project',
  '  update-agents                          Update installed agents',
  '  crew list                              List crew members and the fields they ask for',
  '  crew run <member> --project <name|path> [--model fable|opus|sonnet|haiku|codex|gemini]',
  '      [--field key=value ...] [--background]   Run a member and print the run id',
  "  crew status [run]                      Print a run's state: working, needs, done, failed, idle or closed",
  '  crew result <run>                      Print what a run last said',
  '  --version                              Print the version'
].join('\n')

const looksLikePath = (value: string): boolean => /^[.~]|[\\/]|^[A-Za-z]:/.test(value)

interface Flags {
  positional: string[]
  agent?: AgentKind
  here: boolean
  last: boolean
  replace: boolean
  alongside: boolean
  name?: string
  project?: string
  model?: RunChoice
  fields: Record<string, string>
  background: boolean
  error?: string
}

function readCrewFlag(flags: Flags, key: string, value: string | undefined, fields: Map<string, string>): void {
  if (value === undefined || value.startsWith('--')) {
    flags.error = `${key} needs a value.`
  } else if (key === '--project') {
    flags.project = value
  } else if (key === '--model') {
    if (isRunChoice(value) && value !== 'default') flags.model = value
    else flags.error = `Unknown model '${value}'. Use ${RUN_CHOICES.filter((c) => c !== 'default').join(', ')}.`
  } else {
    const cut = value.indexOf('=')
    const name = cut > 0 ? value.slice(0, cut) : ''
    if (!/^\w+$/.test(name)) flags.error = '--field needs key=value, for example --field target=PR123.'
    else if (value.length - cut - 1 > FIELD_VALUE_MAX) flags.error = `The value of field '${name}' is too long.`
    else fields.set(name, value.slice(cut + 1))
  }
}

function readFlags(args: string[], crew = false): Flags {
  const flags: Flags = { positional: [], here: false, last: false, replace: false, alongside: false, fields: {}, background: false }
  const fields = new Map<string, string>()
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const [key, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg, undefined]
    if (crew && key === '--background') flags.background = true
    else if (crew && (key === '--project' || key === '--model' || key === '--field')) readCrewFlag(flags, key, inline ?? args[(i += 1)], fields)
    else if (key === '--here') flags.here = true
    else if (key === '--last') flags.last = true
    else if (key === '--replace') flags.replace = true
    else if (key === '--alongside') flags.alongside = true
    else if (key === '--agent' || key === '--name') {
      const value = inline ?? args[(i += 1)]
      if (value === undefined || value.startsWith('--')) flags.error = `${key} needs a value.`
      else if (key === '--name') flags.name = value
      else if (isAgent(value)) flags.agent = value
      else flags.error = `Unknown agent '${value}'. Use claude, codex or gemini.`
    } else if (arg.startsWith('--')) flags.error = `Unknown option '${arg}'.`
    else flags.positional.push(arg)
  }
  flags.fields = Object.fromEntries(fields)
  return flags
}

function parseOpen(rest: string[]): CliParse {
  const flags = readFlags(rest)
  if (flags.error) return { ok: false, error: flags.error }
  if (flags.positional.length === 0) return { ok: true, command: { kind: 'open' } }
  if (flags.replace && flags.alongside) return { ok: false, error: 'Use --replace or --alongside, not both.' }
  const mode: LayoutMode | undefined = flags.replace ? 'replace' : flags.alongside ? 'add' : undefined
  return { ok: true, command: { kind: 'open-layout', name: flags.positional.join(' '), mode } }
}

function parseCrew(rest: string[], resolvePath: (path: string) => string): CliParse {
  const flags = readFlags(rest, true)
  if (flags.error) return { ok: false, error: flags.error }
  const [sub, first, extra] = flags.positional
  const fail = (error: string): CliParse => ({ ok: false, error })
  if (sub === undefined) return fail('crew needs list, run, status or result.')
  if (sub === 'list') return first ? fail(`Unexpected argument '${first}'.`) : { ok: true, command: { kind: 'crew-list' } }
  if (sub === 'status') return extra ? fail(`Unexpected argument '${extra}'.`) : { ok: true, command: { kind: 'crew-status', run: first ?? null } }
  if (sub === 'result') {
    if (!first) return fail('crew result needs a run id.')
    return extra ? fail(`Unexpected argument '${extra}'.`) : { ok: true, command: { kind: 'crew-result', run: first } }
  }
  if (sub !== 'run') return fail(`Unknown crew command '${sub}'. Use list, run, status or result.`)
  if (!first) return fail('crew run needs a member name.')
  if (extra) return fail(`Unexpected argument '${extra}'.`)
  if (!flags.project) return fail('crew run needs --project <name|path>.')
  const byPath = looksLikePath(flags.project)
  return {
    ok: true,
    command: {
      kind: 'crew-run',
      member: first,
      project: byPath ? null : flags.project,
      path: byPath ? resolvePath(flags.project) : null,
      choice: flags.model ?? 'default',
      fields: flags.fields,
      background: flags.background
    }
  }
}

export function parseCli(args: string[], cwd: string, resolvePath: (path: string) => string): CliParse {
  const [first, ...rest] = args
  if (first === undefined) return { ok: true, command: { kind: 'open' } }
  if (first === 'open') return parseOpen(rest)
  if (first === '--help' || first === '-h' || first === 'help') return { ok: true, command: { kind: 'help' } }
  if (first === '--version' || first === '-v') return { ok: true, command: { kind: 'version' } }
  if (first === 'crew') return parseCrew(rest, resolvePath)
  const flags = readFlags(rest)
  if (flags.error) return { ok: false, error: flags.error }
  const fail = (error: string): CliParse => ({ ok: false, error })
  const target = flags.positional[0]
  if (flags.positional.length > 1) return fail(`Unexpected argument '${flags.positional[1]}'.`)
  switch (first) {
    case '.':
      if (target) return fail(`Unexpected argument '${target}'.`)
      return { ok: true, command: { kind: 'start', target: null, path: resolvePath(cwd), agent: flags.agent, here: flags.here } }
    case 'start':
      if (!target) return fail('start needs a project name or a folder.')
      return {
        ok: true,
        command: looksLikePath(target)
          ? { kind: 'start', target: null, path: resolvePath(target), agent: flags.agent, here: flags.here }
          : { kind: 'start', target, path: null, agent: flags.agent, here: flags.here }
      }
    case 'resume':
      return {
        ok: true,
        command: {
          kind: 'resume',
          project: target && !looksLikePath(target) ? target : null,
          path: target && looksLikePath(target) ? resolvePath(target) : resolvePath(cwd),
          last: flags.last,
          agent: flags.agent
        }
      }
    case 'ls':
      return { ok: true, command: { kind: 'ls' } }
    case 'layouts':
      return { ok: true, command: { kind: 'layouts' } }
    case 'sessions':
      return { ok: true, command: { kind: 'sessions', project: target ?? null } }
    case 'add':
      if (!target) return fail('add needs a folder.')
      return { ok: true, command: { kind: 'add', path: resolvePath(target), name: flags.name } }
    case 'update-agents':
      return { ok: true, command: { kind: 'update-agents' } }
    default:
      return fail(`Unknown command '${first}'. Run dawsha --help.`)
  }
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)))
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] + 2)))
      .join('')
      .trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}

export interface CliHost {
  version: string
  projects: Project[]
  layouts: SavedLayout[]
  now: number
  openCount(projectId: string): number
  listSessions(query: ResumeQuery): Promise<ResumeSession[]>
  addProject(folder: string, name?: string): Promise<Project | string>
  startSession(projectId: string, agent: AgentKind | undefined, here: boolean): Promise<number>
  resumeSession(session: ResumeSession): Promise<{ pane: number; alreadyOpen: boolean }>
  openResumePicker(projectId?: string): void
  openLayout(name: string, mode?: LayoutMode): Promise<{ ok: boolean; text: string }>
  updateAgents(): Promise<string>
  crewMembers(): CrewMember[]
  crewRun(request: CrewRunRequest): Promise<{ ok: true; runId: string } | { ok: false; error: string }>
  crewRuns(): CrewRunStatus[]
  crewResult(run: string): Promise<string | null>
}

export interface CrewRunRequest {
  member: CrewMember
  project: Project
  choice: RunChoice
  fields: Record<string, string>
  background: boolean
}

export interface CrewRunStatus {
  id: string
  member: string
  title: string
  /** One word: working, needs, done, failed, idle or closed. */
  state: string
}

const failure = (out: string): CliReply => ({ ok: false, exit: 1, out })
const success = (out: string): CliReply => ({ ok: true, exit: 0, out })

export function findProject(projects: Project[], name: string | null, path: string | null): Project | undefined {
  if (name) return projects.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (path) return projects.find((p) => normalizePath(p.folder) === normalizePath(path))
  return undefined
}

export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

async function ensureProject(
  host: CliHost,
  path: string
): Promise<{ project: Project; added: boolean } | CliReply> {
  const known = findProject(host.projects, null, path)
  if (known) return { project: known, added: false }
  const result = await host.addProject(path)
  return typeof result === 'string' ? failure(result) : { project: result, added: true }
}

async function runStart(command: Extract<CliCommand, { kind: 'start' }>, host: CliHost): Promise<CliReply> {
  let project = command.target ? findProject(host.projects, command.target, null) : undefined
  let added = false
  if (command.target && !project) return failure(`No project named '${command.target}'. Run dawsha ls.`)
  if (command.path) {
    const ensured = await ensureProject(host, command.path)
    if ('ok' in ensured) return ensured
    project = ensured.project
    added = ensured.added
  }
  if (!project) return failure('No project to start.')
  const pane = await host.startSession(project.id, command.agent, command.here)
  const agent = command.agent ?? project.defaultAgent
  const label = agent === 'claude' ? 'Claude Code' : AGENT_NAMES[agent]
  if (added) return success(`Added project ${project.name} · started ${label}`)
  if (command.agent) return success(`${project.name}: started ${label} in pane ${pane}`)
  return success(`${project.name}: started ${label} (default agent) in a new pane`)
}

async function runResume(command: Extract<CliCommand, { kind: 'resume' }>, host: CliHost): Promise<CliReply> {
  const project = findProject(host.projects, command.project, command.project ? null : command.path)
  if (command.project && !project) return failure(`No project named '${command.project}'. Run dawsha ls.`)
  if (!command.last) {
    host.openResumePicker(project?.id)
    return success(project ? `Opened the resume picker for ${project.name}` : 'Opened the resume picker')
  }
  const found = await host.listSessions({ projectId: project?.id, agent: command.agent, limit: 1 })
  const session = found[0]
  if (!session) return failure('No earlier sessions found.')
  const opened = await host.resumeSession(session)
  const label = session.agent === 'claude' ? 'Claude Code' : AGENT_NAMES[session.agent]
  if (opened.alreadyOpen) return success(`'${session.title}' (${label}) is already open in pane ${opened.pane}`)
  return success(`Resumed '${session.title}' (${label}) in pane ${opened.pane}`)
}

async function runSessions(command: Extract<CliCommand, { kind: 'sessions' }>, host: CliHost): Promise<CliReply> {
  const project = command.project ? findProject(host.projects, command.project, null) : undefined
  if (command.project && !project) return failure(`No project named '${command.project}'. Run dawsha ls.`)
  const sessions = await host.listSessions({ projectId: project?.id })
  if (sessions.length === 0) return success('No earlier sessions found.')
  const rows = sessions.map((s) => [s.agent, s.title, `${formatAge(host.now - s.modifiedAt)} ago`, s.id.slice(0, 6)])
  return success(table(['AGENT', 'TITLE', 'LAST ACTIVE', 'ID'], rows))
}

function runLayouts(host: CliHost): CliReply {
  if (host.layouts.length === 0) return success('No saved layouts. Use Layouts in the top bar to save one.')
  const rows = host.layouts.map((layout) => [
    layout.name,
    paneCountText(layout.panes.length),
    layoutProjectNames(layout, host.projects).join(', ')
  ])
  return success(table(['NAME', 'PANES', 'PROJECTS'], rows))
}

function runCrewList(host: CliHost): CliReply {
  const members = host.crewMembers().filter((member) => !member.hidden)
  const rows = members.map((member) => [
    member.name,
    member.role,
    `${member.runner} ${modelLabel(member.runner, member.model)}`,
    member.lead ? 'coming next' : runFields(member).join(', ')
  ])
  return success(table(['NAME', 'ROLE', 'MODEL', 'FIELDS'], rows))
}

async function runCrewRun(command: Extract<CliCommand, { kind: 'crew-run' }>, host: CliHost): Promise<CliReply> {
  const wanted = command.member.trim().toLowerCase()
  const member = host.crewMembers().find((m) => m.id.toLowerCase() === wanted || m.name.toLowerCase() === wanted)
  if (!member) return failure(`No crew member named '${command.member}'. Run dawsha crew list.`)
  if (member.lead) return failure(`${member.name} the Lead is not available yet. Run a member instead.`)
  const project = findProject(host.projects, command.project, command.path)
  if (!project) {
    return failure(
      command.project ? `No project named '${command.project}'. Run dawsha ls.` : `${command.path} is not a project. Run dawsha add <path> first.`
    )
  }
  if (!inScope(member, project.name)) return failure(`${member.name} is limited to ${member.projects.join(', ')}, not ${project.name}.`)
  const fields = runFields(member)
  const unknown = Object.keys(command.fields).find((key) => !fields.includes(key))
  if (unknown) return failure(`${member.name} has no field '${unknown}'. Fields: ${fields.join(', ')}.`)
  const missing = fields.filter((key) => (command.fields[key] ?? '').trim() === '')
  if (missing.length > 0) return failure(`${member.name} needs ${missing.map((key) => `--field ${key}=...`).join(' ')}.`)
  const result = await host.crewRun({ member, project, choice: command.choice, fields: command.fields, background: command.background })
  return result.ok ? success(result.runId) : failure(result.error)
}

function runCrewStatus(command: Extract<CliCommand, { kind: 'crew-status' }>, host: CliHost): CliReply {
  const runs = host.crewRuns()
  if (command.run) {
    const run = runs.find((r) => r.id === command.run)
    return run ? success(run.state) : failure(`No run '${command.run}'.`)
  }
  if (runs.length === 0) return success('No crew runs yet.')
  return success(table(['RUN', 'MEMBER', 'STATE', 'TITLE'], runs.map((r) => [r.id, r.member, r.state, r.title])))
}

export async function runCli(command: CliCommand, host: CliHost): Promise<CliReply> {
  switch (command.kind) {
    case 'open':
      return success('Opened Dawsha')
    case 'help':
      return success(HELP_TEXT)
    case 'version':
      return success(`Dawsha ${host.version}`)
    case 'ls':
      if (host.projects.length === 0) return success('No projects yet. Run dawsha add <path>.')
      return success(
        table(
          ['NAME', 'AGENT', 'FOLDER', 'SESSIONS'],
          host.projects.map((p) => [p.name, p.defaultAgent, p.folder, String(host.openCount(p.id))])
        )
      )
    case 'layouts':
      return runLayouts(host)
    case 'open-layout': {
      const result = await host.openLayout(command.name, command.mode)
      return result.ok ? success(result.text) : failure(result.text)
    }
    case 'sessions':
      return runSessions(command, host)
    case 'add': {
      const result = await host.addProject(command.path, command.name)
      return typeof result === 'string'
        ? failure(result)
        : success(`Added project ${result.name || folderName(command.path)} (${result.folder})`)
    }
    case 'start':
      return runStart(command, host)
    case 'resume':
      return runResume(command, host)
    case 'update-agents':
      return success(await host.updateAgents())
    case 'crew-list':
      return runCrewList(host)
    case 'crew-run':
      return runCrewRun(command, host)
    case 'crew-status':
      return runCrewStatus(command, host)
    case 'crew-result': {
      const text = await host.crewResult(command.run)
      return text === null ? failure(`No run '${command.run}'.`) : success(text)
    }
  }
}

export function cliWords(argv: string[]): string[] | null {
  const known = new Set<string>(['.', '--help', '-h', '--version', '-v', ...COMMAND_NAMES])
  const start = argv.findIndex((word) => known.has(word))
  return start < 0 ? null : argv.slice(start)
}
