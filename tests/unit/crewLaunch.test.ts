import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { launchSpec } from '../../src/main/agentLaunch'
import type { CrewLaunch } from '../../src/shared/crew'
import { BUILTIN_MEMBERS } from '../../src/shared/crewBuiltins'
import { READ_ONLY_NOTE, commandPreview, composeInstructions, crewArgs, crewFullAccess, crewPrompt } from '../../src/shared/crewLaunch'
import { matchPaste, readPaste } from '../../src/shared/crewPaste'
import { AVATAR_LABELS, DONE_VISIBLE_MS, START_GRACE_MS, formatCost, formatSpan, memberState, stepTrack, stripSummary, visibleState, type RunTrack, type TrackInput } from '../../src/shared/crewLive'
import { draftFromSkill } from '../../src/shared/crewImport'

const launch = (change: Partial<CrewLaunch> = {}): CrewLaunch => ({ instructions: 'Be careful.', model: 'sonnet', effort: '', permissions: 'ask', startup: 'lean', ...change })
const MCP = { emptyMcpConfig: 'C:\\tmp\\empty.json' }

describe('claude launch arguments', () => {
  it('appends the instructions last, after the lean start-up flags', () => {
    expect(crewArgs('claude', launch(), MCP)).toEqual(['--model', 'sonnet', '--strict-mcp-config', '--mcp-config', 'C:\\tmp\\empty.json', '--append-system-prompt', 'Be careful.'])
  })

  it('uses plan mode for read only and passes the effort', () => {
    const args = crewArgs('claude', launch({ permissions: 'read', effort: 'high', model: 'opus' }), MCP)
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'high', '--permission-mode', 'plan']))
    expect(args.at(-2)).toBe('--append-system-prompt')
  })

  it('does not restrict MCP servers for the usual start-up', () => {
    const args = crewArgs('claude', launch({ startup: 'usual' }), MCP)
    expect(args).not.toContain('--strict-mcp-config')
    expect(args).not.toContain('--mcp-config')
  })

  it('loads only the project servers for some, and falls back to none without a project file', () => {
    expect(crewArgs('claude', launch({ startup: 'some' }), { ...MCP, projectMcpConfig: 'C:\\p\\.mcp.json' })).toEqual(expect.arrayContaining(['--strict-mcp-config', 'C:\\p\\.mcp.json']))
    expect(crewArgs('claude', launch({ startup: 'some' }), MCP)).toContain('C:\\tmp\\empty.json')
  })

  it('keeps instructions with quotes and newlines as one argument', () => {
    const text = 'Say "hi"\nand\\then `stop` $(x)'
    const args = crewArgs('claude', launch({ instructions: text }), MCP)
    expect(args.at(-1)).toBe(text)
    expect(args.filter((a) => a === text)).toHaveLength(1)
  })

  it('omits empty instructions and models', () => {
    expect(crewArgs('claude', launch({ instructions: '', model: '', startup: 'usual' }), MCP)).toEqual([])
  })
})

describe('codex and gemini launch', () => {
  it('passes the model and reasoning effort to codex', () => {
    expect(crewArgs('codex', launch({ model: 'gpt-5.6', effort: 'high' }), MCP)).toEqual(['-m', 'gpt-5.6', '-c', 'model_reasoning_effort=high'])
    expect(crewArgs('codex', launch({ model: '', effort: 'max' }), MCP)).toEqual(['-c', 'model_reasoning_effort=xhigh'])
    expect(crewArgs('codex', launch({ model: '' }), MCP)).toEqual([])
  })

  it('passes only the model to gemini, never the effort or Claude flags', () => {
    expect(crewArgs('gemini', launch({ model: 'gemini-2.5-pro', effort: 'high', permissions: 'read' }), MCP)).toEqual(['-m', 'gemini-2.5-pro'])
  })

  it('puts the instructions in front of the first message', () => {
    expect(crewPrompt('codex', launch(), 'Review PR 7')).toBe('<instructions>\nBe careful.\n</instructions>\n\nReview PR 7')
    expect(crewPrompt('gemini', launch(), '')).toBe('<instructions>\nBe careful.\n</instructions>')
    expect(crewPrompt('claude', launch(), 'Review PR 7')).toBe('Review PR 7')
    expect(crewPrompt('codex', launch({ instructions: '' }), 'x')).toBe('x')
  })

  it('turns read only into a sentence for codex and gemini, but not claude', () => {
    const sami = BUILTIN_MEMBERS.find((m) => m.id === 'sami')!
    expect(composeInstructions(sami, 'codex')).toContain(READ_ONLY_NOTE)
    expect(composeInstructions(sami, 'gemini')).toContain(READ_ONLY_NOTE)
    expect(composeInstructions(sami, 'claude')).not.toContain(READ_ONLY_NOTE)
    const omar = BUILTIN_MEMBERS.find((m) => m.id === 'omar')!
    expect(composeInstructions(omar, 'codex')).not.toContain(READ_ONLY_NOTE)
  })

  it('tells a skill member on codex or gemini to read the skill file first', () => {
    const skill = draftFromSkill({ name: 'x', description: 'Do x', body: '', path: 'C:/s/x', agent: 'claude' }, { names: [], colours: [] }, []).member
    const bare = { ...skill, instructions: 'Follow it.' }
    expect(composeInstructions(bare, 'codex')).toContain('read the skill file at C:/s/x')
    expect(composeInstructions(bare, 'claude')).toBe('Follow it.')
    expect(composeInstructions(skill, 'gemini')).toBe(skill.instructions)
  })

  it('caps the instructions', () => {
    expect(composeInstructions({ ...BUILTIN_MEMBERS[1], instructions: 'x'.repeat(20_000) }, 'claude').length).toBe(8000)
  })

  it('runs codex with full access always, and others by permission', () => {
    expect(crewFullAccess('codex', 'read')).toBe(true)
    expect(crewFullAccess('claude', 'read')).toBe(false)
    expect(crewFullAccess('claude', 'ask')).toBe(false)
    expect(crewFullAccess('claude', 'full')).toBe(true)
    expect(crewFullAccess('gemini', 'ask')).toBe(false)
    expect(crewFullAccess('gemini', 'full')).toBe(true)
  })

  it('previews a command without printing the instructions', () => {
    const text = commandPreview('claude', launch({ permissions: 'read' }), { name: 'Sami', role: 'Code reviewer' })
    expect(text).toContain('claude --model sonnet')
    expect(text).toContain('<Sami, Code reviewer>')
    expect(text).not.toContain('Be careful')
    expect(commandPreview('codex', launch({ model: '' }), { name: 'T', role: '' })).toContain('--dangerously-bypass-approvals-and-sandbox')
  })
})

const SAMI = BUILTIN_MEMBERS.find((m) => m.id === 'sami')!
const TAREK = BUILTIN_MEMBERS.find((m) => m.id === 'tarek')!
const ZAID = draftFromSkill(
  { name: 'correlation-id', description: 'Investigates a correlation id. Use when the user names an environment (dev, stage, uat).', body: '', path: 'C:/s', agent: 'claude' },
  { names: [], colours: [] },
  []
).member

describe('paste matching', () => {
  const GUID = '3f2b8c1e-9a47-4d6b-8e21-0c5d7a9b1f44'

  it('recognises a correlation id with an environment', () => {
    const [hit] = matchPaste(`${GUID} on stage`, [SAMI, ZAID])
    expect(hit.member.id).toBe(ZAID.id)
    expect(hit.fields).toEqual({ id: GUID, env: 'stage' })
    expect(hit.why).toBe('an id on stage')
    expect(matchPaste(GUID, [ZAID])[0].fields).toEqual({ id: GUID })
    expect(matchPaste('3f2b8c1e9a474d6b8e210c5d7a9b1f44 on uat', [ZAID])[0].fields.env).toBe('uat')
    expect(matchPaste(`${GUID} on staging`, [ZAID])[0].fields.env).toBe('stage')
  })

  it('recognises an Azure DevOps pull request URL and a PR number', () => {
    const url = 'https://dev.azure.com/MicrotecEgypt/Platforms/_git/Platforms/pullrequest/8841'
    expect(matchPaste(url, [SAMI, ZAID])[0]).toMatchObject({ member: SAMI, fields: { target: url } })
    expect(matchPaste('please look at PR 123', [SAMI])[0].fields).toEqual({ target: 'PR 123' })
    expect(matchPaste('pr #45', [SAMI])[0].why).toBe('PR 45')
    expect(matchPaste('PR 7', [{ ...SAMI, paste: [{ kind: 'pr', field: 'pr' }] }])[0].fields).toEqual({ pr: '7' })
  })

  it('recognises a build URL', () => {
    const url = 'https://dev.azure.com/MicrotecEgypt/Platforms/_build/results?buildId=9912&view=logs'
    expect(matchPaste(url, [TAREK])[0].fields).toEqual({ problem: url })
    expect(matchPaste(url, [SAMI])).toEqual([])
  })

  it('offers nothing for plain text or an empty paste, and orders by score', () => {
    expect(matchPaste('hello there', [SAMI, TAREK, ZAID])).toEqual([])
    expect(matchPaste('   ', [SAMI])).toEqual([])
    const both = matchPaste(`PR 5 ${GUID}`, [SAMI, ZAID])
    expect(both).toHaveLength(2)
    expect(both[0].score).toBeGreaterThanOrEqual(both[1].score)
  })

  it('reads the facts of a paste', () => {
    expect(readPaste('see https://example.com/x and PR 9 on dev')).toMatchObject({ prNumber: '9', env: 'dev', url: 'https://example.com/x' })
    expect(readPaste('nothing')).toEqual({ guid: null, env: null, prNumber: null, prUrl: null, buildUrl: null, url: null })
  })
})

const at = (change: Partial<TrackInput>): TrackInput => ({ session: 'idle', tab: 'running', startedAt: 0, now: 100_000, ...change })

describe('avatar state mapping', () => {
  it('starts as working, then follows the session through needs, working and done', () => {
    let track: RunTrack | undefined = stepTrack(undefined, at({ tab: 'starting', now: 1000 }))
    expect(track.state).toBe('working')
    track = stepTrack(track, at({ session: 'idle', now: 5000 }))
    expect(track.state).toBe('working')
    track = stepTrack(track, at({ session: 'working', now: 6000 }))
    expect(track).toMatchObject({ state: 'working', busySeen: true })
    track = stepTrack(track, at({ session: 'needs', now: 7000 }))
    expect(track.state).toBe('needs')
    track = stepTrack(track, at({ session: 'working', now: 8000 }))
    track = stepTrack(track, at({ session: 'idle', now: 9000 }))
    expect(track).toMatchObject({ state: 'done', since: 9000 })
    expect(stepTrack(track, at({ session: 'done', now: 20_000 })).since).toBe(9000)
  })

  it('goes idle when it never worked and the start-up grace is over', () => {
    expect(stepTrack(undefined, at({ now: START_GRACE_MS + 1 })).state).toBe('idle')
    expect(stepTrack(undefined, at({ now: 100 })).state).toBe('working')
  })

  it('marks an exit as done or failed and keeps a failure', () => {
    expect(stepTrack(undefined, at({ tab: 'exited', exitCode: 0 })).state).toBe('done')
    const failed = stepTrack(undefined, at({ tab: 'exited', exitCode: 1 }))
    expect(failed.state).toBe('failed')
    expect(stepTrack(failed, at({ tab: 'exited', exitCode: 0 }))).toBe(failed)
  })

  it('shows Done for ten minutes or until it is seen', () => {
    const done: RunTrack = { state: 'done', since: 0, busySeen: true, seen: false }
    expect(visibleState(done, DONE_VISIBLE_MS)).toBe('done')
    expect(visibleState(done, DONE_VISIBLE_MS + 1)).toBe('idle')
    expect(visibleState({ ...done, seen: true }, 10)).toBe('idle')
    expect(visibleState(undefined, 0)).toBe('idle')
    expect(visibleState({ ...done, state: 'failed' }, DONE_VISIBLE_MS * 9)).toBe('failed')
  })

  it('picks the most urgent state for a member and words the strip', () => {
    expect(memberState(['working', 'needs', 'done'])).toBe('needs')
    expect(memberState(['done', 'working'])).toBe('working')
    expect(memberState(['failed', 'working'])).toBe('failed')
    expect(memberState([])).toBe('idle')
    expect(stripSummary(['needs', 'working', 'working', 'done'])).toBe('1 needs you · 2 working · 1 done')
    expect(stripSummary(['idle'])).toBe('')
    expect(AVATAR_LABELS.needs).toBe('Needs you')
  })

  it('formats costs and durations', () => {
    expect(formatCost(0.223)).toBe('$0.22')
    expect(formatCost(0.001)).toBe('<$0.01')
    expect(formatCost(null)).toBe('')
    expect(formatSpan(45_000)).toBe('45s')
    expect(formatSpan(6 * 60_000)).toBe('6m')
    expect(formatSpan(75 * 60_000)).toBe('1h 15m')
  })
})

describe('launchSpec for a crew run', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  const base = { id: 't', cwd: process.cwd(), resume: false, cols: 80, rows: 24 } as const

  it('adds the crew flags after the extra arguments and before the first message, even for overridden commands', () => {
    process.env.DAWSHA_CLAUDE_COMMAND = process.execPath
    process.env.DAWSHA_CLAUDE_ARGS = '["--fake"]'
    const spec = launchSpec({ ...base, agent: 'claude', prompt: 'Review PR 7', crew: launch({ permissions: 'read', model: 'opus' }) })
    if (typeof spec === 'string') throw new Error(spec)
    expect(spec.args.slice(0, 1)).toEqual(['--fake'])
    expect(spec.args).toEqual(expect.arrayContaining(['--model', 'opus', '--permission-mode', 'plan', '--strict-mcp-config']))
    expect(spec.args.at(-1)).toBe('Review PR 7')
    expect(spec.args.at(-3)).toBe('--append-system-prompt')
    const config = spec.args[spec.args.indexOf('--mcp-config') + 1]
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ mcpServers: {} })
  })

  it('sends codex and gemini the instructions inside the first message', () => {
    process.env.DAWSHA_CODEX_COMMAND = process.execPath
    process.env.DAWSHA_GEMINI_COMMAND = process.execPath
    const codex = launchSpec({ ...base, agent: 'codex', prompt: 'Go', crew: launch({ model: 'gpt-5.6', effort: 'high' }) })
    if (typeof codex === 'string') throw new Error(codex)
    expect(codex.args).toEqual(['-m', 'gpt-5.6', '-c', 'model_reasoning_effort=high', '<instructions>\nBe careful.\n</instructions>\n\nGo'])
    const gemini = launchSpec({ ...base, agent: 'gemini', prompt: 'Go', crew: launch({ model: 'gemini-2.5-pro' }) })
    if (typeof gemini === 'string') throw new Error(gemini)
    expect(gemini.args).toEqual(['-m', 'gemini-2.5-pro', '--prompt-interactive=<instructions>\nBe careful.\n</instructions>\n\nGo'])
  })

  it('refuses a crew model that is not a model name, and still starts a crew member with no model', () => {
    process.env.DAWSHA_CLAUDE_COMMAND = process.execPath
    process.env.DAWSHA_CODEX_COMMAND = process.execPath
    expect(launchSpec({ ...base, agent: 'claude', crew: launch({ model: '--yolo' }) })).toContain('not valid')
    expect(launchSpec({ ...base, agent: 'codex', crew: launch({ model: '--yolo' }) })).toContain('not valid')
    const spec = launchSpec({ ...base, agent: 'codex', crew: launch({ model: 'gpt-5.6-sol', effort: '' }) })
    if (typeof spec === 'string') throw new Error(spec)
    expect(spec.args.slice(0, 2)).toEqual(['-m', 'gpt-5.6-sol'])
    expect(typeof launchSpec({ ...base, agent: 'claude', crew: launch({ model: '' }) })).toBe('object')
  })

  it('ignores a malformed crew section and never adds it to a shell tab', () => {
    process.env.DAWSHA_CLAUDE_COMMAND = process.execPath
    const bad = launchSpec({ ...base, agent: 'claude', prompt: 'x', crew: { instructions: 5 } as never })
    expect(bad).toEqual({ file: process.execPath, args: ['x'] })
    process.env.DAWSHA_SHELL = process.execPath
    const shell = launchSpec({ ...base, agent: 'shell', crew: launch() })
    if (typeof shell === 'string') throw new Error(shell)
    expect(shell.args.join(' ')).not.toContain('append-system-prompt')
  })
})

describe('the Lead tool allowance', () => {
  const launch = { instructions: 'Lead', model: 'opus', effort: 'high' as const, permissions: 'ask' as const, startup: 'lean' as const }

  it('lets Claude run dawsha crew without asking, before the instructions flag', () => {
    const args = crewArgs('claude', { ...launch, allow: 'Bash(dawsha crew:*)' }, { emptyMcpConfig: 'e.json' })
    expect(args.slice(-4)).toEqual(['--allowedTools', 'Bash(dawsha crew:*)', '--append-system-prompt', 'Lead'])
  })

  it('adds nothing without an allowance', () => {
    expect(crewArgs('claude', launch, { emptyMcpConfig: 'e.json' })).not.toContain('--allowedTools')
  })
})
