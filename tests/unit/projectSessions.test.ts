import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProjectSlug, sessionIdFromFile, sessionTitle, sessionTitleInfo } from '../../src/shared/projectSessions'
import { listClaudeSessions, listCodexSessions, listGeminiSessions } from '../../src/main/projectSessions'

const line = (value: unknown): string => JSON.stringify(value)
const userLine = (content: unknown, extra: object = {}): string =>
  line({ type: 'user', message: { role: 'user', content }, ...extra })

describe('claudeProjectSlug and file names', () => {
  it('replaces every non alphanumeric character with a dash', () => {
    expect(claudeProjectSlug('C:\\Users\\dev\\Work\\acme-web')).toBe('C--Users-dev-Work-acme-web')
    expect(claudeProjectSlug('C:\\Work\\My App.v2')).toBe('C--Work-My-App-v2')
  })

  it('accepts only session jsonl names', () => {
    expect(sessionIdFromFile('d55beb28-3eec-4124-9eb8-ac707de4748f.jsonl')).toBe('d55beb28-3eec-4124-9eb8-ac707de4748f')
    expect(sessionIdFromFile('d55beb28-3eec-4124-9eb8-ac707de4748f')).toBeNull()
    expect(sessionIdFromFile('notes.jsonl')).toBeNull()
  })
})

describe('sessionTitle', () => {
  it('skips injected instructions and preserves automatic session labels', () => {
    const head = [userLine('# AGENTS.md instructions for C:\\work'), userLine('This session is being continued from a previous conversation that ran out of context.'), userLine('Please fix login')].join('\n')
    expect(sessionTitleInfo(head, '').firstPrompt).toBe('Please fix login')
    expect(sessionTitleInfo(userLine('Below is a conversation log from a Claude Code coding session. Create a summary.'), '').firstPrompt).toBe('Automatic summary of an earlier session')
  })
  it('keeps original prompts and name provenance separate without truncating manual names', () => {
    const prompt = 'Please fix the invoice report and check every edge case in the exported file. '.repeat(3)
    const manual = 'An explicit title with more than eighty characters that the owner deliberately chose for this session'
    expect(sessionTitleInfo(userLine(prompt), line({ type: 'custom-title', customTitle: manual }))).toEqual({ name: manual, nameSource: 'user', firstPrompt: prompt.trim() })
    expect(sessionTitleInfo(userLine(prompt), line({ type: 'ai-title', aiTitle: 'Invoice report' }))).toMatchObject({ name: 'Invoice report', nameSource: 'ai', firstPrompt: prompt.trim() })
    expect(sessionTitleInfo(userLine(prompt), '')).toMatchObject({ nameSource: 'prompt', firstPrompt: prompt.trim() })
  })
  it('prefers a custom title, then the generated one', () => {
    const head = [line({ type: 'ai-title', aiTitle: 'Generated' }), userLine('hello there')].join('\n')
    expect(sessionTitle(head, '')).toBe('Generated')
    const tail = line({ type: 'custom-title', customTitle: 'Renamed by user' })
    expect(sessionTitle(head, tail)).toBe('Renamed by user')
  })

  it('falls back to the first real user prompt and skips meta and command lines', () => {
    const head = [
      userLine('<command-name>/clear</command-name>'),
      userLine('caveat text', { isMeta: true }),
      userLine([{ type: 'text', text: '  Fix the   invoice\nreport  ' }])
    ].join('\n')
    expect(sessionTitle(head, '')).toBe('Fix the invoice report')
  })

  it('truncates long prompts and tolerates cut-off lines', () => {
    const long = 'x'.repeat(200)
    const title = sessionTitle(`${userLine(long)}\n{"type":"user","mess`, '')
    expect(title).toHaveLength(80)
    expect(title?.endsWith('…')).toBe(true)
    expect(sessionTitle('', '')).toBeNull()
    expect(sessionTitle('garbage\n{', 'more garbage')).toBeNull()
  })
})

describe('listClaudeSessions', () => {
  function seed(): { projects: string; folder: string; dir: string } {
    const projects = mkdtempSync(join(tmpdir(), 'cg-projects-'))
    const folder = 'C:\\Work\\Example App'
    const dir = join(projects, claudeProjectSlug(folder))
    mkdirSync(dir, { recursive: true })
    return { projects, folder, dir }
  }
  const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('lists titled sessions newest first, max 15, and skips empty or unnamed files', async () => {
    const { projects, folder, dir } = seed()
    for (let n = 1; n <= 20; n += 1) {
      const path = join(dir, `${idOf(n)}.jsonl`)
      writeFileSync(path, `${userLine(`Prompt number ${n}`)}\n`, 'utf8')
      const time = new Date(Date.UTC(2026, 9, 1, 0, n))
      utimesSync(path, time, time)
    }
    writeFileSync(join(dir, `${idOf(99)}.jsonl`), '', 'utf8')
    writeFileSync(join(dir, `${idOf(98)}.jsonl`), `${line({ type: 'mode', mode: 'normal' })}\n`, 'utf8')
    writeFileSync(join(dir, 'readme.txt'), 'x', 'utf8')
    const entries = await listClaudeSessions(folder, projects)
    expect(entries).toHaveLength(15)
    expect(entries[0]).toMatchObject({ id: idOf(20), title: 'Prompt number 20' })
    expect(entries[14].id).toBe(idOf(6))
    expect(entries.every((e, i) => i === 0 || entries[i - 1].modifiedAt >= e.modifiedAt)).toBe(true)
  })

  it('returns an empty list for a folder Claude never saw', async () => {
    expect(await listClaudeSessions('C:\\Nowhere', mkdtempSync(join(tmpdir(), 'cg-projects-')))).toEqual([])
  })
})

describe('listCodexSessions', () => {
  it('lists rollouts of the folder with their thread names', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cg-codex-'))
    const dir = join(home, 'sessions', '2026', '10', '08')
    mkdirSync(dir, { recursive: true })
    const make = (id: string, cwd: string, minute: number): void => {
      const path = join(dir, `rollout-2026-10-08T12-00-00-${id}.jsonl`)
      const meta = { type: 'session_meta', payload: { id, cwd, timestamp: '2026-10-08T12:00:00.000Z' } }
      writeFileSync(path, `${line(meta)}\n`, 'utf8')
      const time = new Date(Date.UTC(2026, 9, 8, 12, minute))
      utimesSync(path, time, time)
    }
    const a = '019aaaaa-0000-7000-8000-00000000000a'
    const b = '019aaaaa-0000-7000-8000-00000000000b'
    const other = '019aaaaa-0000-7000-8000-00000000000c'
    make(a, 'C:\\Work\\Example App', 1)
    make(b, 'c:/work/example app', 5)
    make(other, 'C:\\Work\\Else', 9)
    writeFileSync(join(home, 'session_index.jsonl'), `${line({ id: a, thread_name: 'Older thread' })}\n`, 'utf8')
    const entries = await listCodexSessions('C:\\Work\\Example App', home)
    expect(entries.map((e) => [e.id, e.title])).toEqual([
      [b, 'Codex session'],
      [a, 'Older thread']
    ])
  })
})

describe('listGeminiSessions', () => {
  it('lists chats of the project whose marker matches the folder, newest first, skipping empty ones', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cg-gemini-home-'))
    const mine = join(home, 'tmp', 'example-app')
    const other = join(home, 'tmp', 'else')
    for (const dir of [join(mine, 'chats'), join(other, 'chats')]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(mine, '.project_root'), 'C:\\Work\\Example App', 'utf8')
    writeFileSync(join(other, '.project_root'), 'C:\\Work\\Else', 'utf8')
    const head = (id: string): string => line({ sessionId: id, projectHash: 'h', startTime: '2026-10-08T12:00:00.000Z' })
    const make = (dir: string, name: string, id: string, prompt: string | null, minute: number): void => {
      const body = prompt ? `${head(id)}\n${line({ id: 'm', type: 'user', content: prompt })}\n` : `${head(id)}\n`
      const path = join(dir, 'chats', name)
      writeFileSync(path, body, 'utf8')
      const time = new Date(Date.UTC(2026, 9, 8, 12, minute))
      utimesSync(path, time, time)
    }
    make(mine, 'session-2026-10-08T12-00-aaaaaaaa.jsonl', 'aaaaaaaa-0000-4000-8000-000000000001', 'older prompt', 1)
    make(mine, 'session-2026-10-08T12-05-bbbbbbbb.jsonl', 'bbbbbbbb-0000-4000-8000-000000000002', 'newer prompt', 5)
    make(mine, 'session-2026-10-08T12-09-cccccccc.jsonl', 'cccccccc-0000-4000-8000-000000000003', null, 9)
    make(other, 'session-2026-10-08T12-07-dddddddd.jsonl', 'dddddddd-0000-4000-8000-000000000004', 'elsewhere', 7)
    const entries = await listGeminiSessions('c:/work/example app', home)
    expect(entries.map((e) => [e.id, e.title])).toEqual([
      ['bbbbbbbb-0000-4000-8000-000000000002', 'newer prompt'],
      ['aaaaaaaa-0000-4000-8000-000000000001', 'older prompt']
    ])
  })

  it('returns nothing when the folder has no Gemini project directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cg-gemini-empty-'))
    expect(await listGeminiSessions('C:\\Work\\None', home)).toEqual([])
  })
})
