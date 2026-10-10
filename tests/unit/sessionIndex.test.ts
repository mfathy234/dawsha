import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProjectSlug } from '../../src/shared/projectSessions'
import type { Project } from '../../src/shared/types'
import { listAllSessions, type SessionHomes } from '../../src/main/sessionIndex'

const line = (value: unknown): string => JSON.stringify(value)
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface World {
  homes: SessionHomes
  projects: Project[]
  folders: Record<string, string>
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-index-'))
  const folders = { web: 'C:\\work\\acme-web', api: 'C:\\work\\billing-api', site: 'C:\\work\\docs-site' }
  const homes = { claudeProjects: join(root, 'claude'), codex: join(root, 'codex'), gemini: join(root, 'gemini') }
  const projects: Project[] = [
    { id: 'web', name: 'acme-web', folder: folders.web, defaultAgent: 'claude' },
    { id: 'api', name: 'billing-api', folder: folders.api, defaultAgent: 'codex' },
    { id: 'site', name: 'docs-site', folder: folders.site, defaultAgent: 'gemini' }
  ]
  return { homes, projects, folders }
}

function claudeSession(w: World, project: keyof World['folders'], n: number, title: string, minutesAgo: number): void {
  const dir = join(w.homes.claudeProjects, claudeProjectSlug(w.folders[project]))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${uuid(n)}.jsonl`)
  writeFileSync(
    path,
    [
      line({ type: 'user', timestamp: '2026-10-08T09:00:00.000Z', message: { content: `Prompt for ${title}` } }),
      line({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: `Reply for ${title}` }] } }),
      line({ type: 'ai-title', aiTitle: title })
    ].join('\n') + '\n'
  )
  const when = new Date(Date.now() - minutesAgo * 60_000)
  utimesSync(path, when, when)
}

function codexSession(w: World, n: number, cwd: string, name: string, minutesAgo: number): void {
  const dir = join(w.homes.codex, 'sessions', '2026', '10', '08')
  mkdirSync(dir, { recursive: true })
  const id = `019aaaaa-0000-7000-8000-${String(n).padStart(12, '0')}`
  const path = join(dir, `rollout-2026-10-08T12-00-00-${id}.jsonl`)
  writeFileSync(
    path,
    [
      line({ type: 'session_meta', payload: { id, cwd, timestamp: '2026-10-08T12:00:00.000Z' } }),
      line({ type: 'event_msg', payload: { type: 'user_message', message: 'Fix the flaky login test' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', message: 'Replaced the sleep.' } })
    ].join('\n') + '\n'
  )
  writeFileSync(join(w.homes.codex, 'session_index.jsonl'), line({ id, thread_name: name }) + '\n', { flag: 'a' })
  const when = new Date(Date.now() - minutesAgo * 60_000)
  utimesSync(path, when, when)
}

function geminiSession(w: World, slug: string, folder: string, id: string, minutesAgo: number): void {
  const dir = join(w.homes.gemini, 'tmp', slug)
  mkdirSync(join(dir, 'chats'), { recursive: true })
  writeFileSync(join(dir, '.project_root'), folder)
  const path = join(dir, 'chats', `session-2026-10-08T12-00-${id.slice(0, 8)}.jsonl`)
  writeFileSync(
    path,
    [
      line({ sessionId: id, startTime: '2026-10-08T12:00:00.000Z', lastUpdated: '2026-10-08T12:00:00.000Z', kind: 'main' }),
      line({ id: 'm1', type: 'user', content: [{ text: 'Rewrite the start guide' }] }),
      line({ id: 'm2', type: 'gemini', content: 'Done.', model: 'gemini-2.5-pro' })
    ].join('\n') + '\n'
  )
  const when = new Date(Date.now() - minutesAgo * 60_000)
  utimesSync(path, when, when)
}

describe('listAllSessions', () => {
  it('merges the three agents across projects, newest first, with details', async () => {
    const w = world()
    claudeSession(w, 'web', 1, 'Add dark mode toggle', 12)
    claudeSession(w, 'api', 2, 'Refactor invoice export', 180)
    codexSession(w, 3, w.folders.api, 'Fix flaky login test', 60)
    geminiSession(w, 'docs-site', w.folders.site, '11111111-2222-4333-8444-555555555555', 1500)
    codexSession(w, 4, 'C:\\somewhere\\else', 'Not a project', 5)

    const sessions = await listAllSessions(w.projects, {}, w.homes)
    expect(sessions.map((s) => s.title)).toEqual([
      'Add dark mode toggle',
      'Fix flaky login test',
      'Refactor invoice export',
      'Rewrite the start guide'
    ])
    expect(sessions.map((s) => [s.agent, s.projectId])).toEqual([
      ['claude', 'web'],
      ['codex', 'api'],
      ['claude', 'api'],
      ['gemini', 'site']
    ])
    expect(sessions[0]).toMatchObject({ model: 'Opus', messageCount: 2, firstPrompt: 'Prompt for Add dark mode toggle' })
    expect(sessions[1]).toMatchObject({ messageCount: 2, lastAssistant: 'Replaced the sleep.' })
    expect(sessions[3]).toMatchObject({ model: 'gemini-2.5-pro', lastAssistant: 'Done.' })
  })

  it('filters by project, agent and query and honours the limit', async () => {
    const w = world()
    claudeSession(w, 'web', 1, 'Add dark mode toggle', 12)
    claudeSession(w, 'web', 2, 'Investigate slow CI', 4000)
    codexSession(w, 3, w.folders.web, 'Migrate to the new router', 30)

    expect((await listAllSessions(w.projects, { projectId: 'api' }, w.homes))).toEqual([])
    expect((await listAllSessions(w.projects, { agent: 'codex' }, w.homes)).map((s) => s.title)).toEqual(['Migrate to the new router'])
    expect((await listAllSessions(w.projects, { query: 'slow ci' }, w.homes)).map((s) => s.title)).toEqual(['Investigate slow CI'])
    expect((await listAllSessions(w.projects, { query: 'acme-web codex' }, w.homes)).map((s) => s.agent)).toEqual(['codex'])
    expect(await listAllSessions(w.projects, { limit: 1 }, w.homes)).toHaveLength(1)
  })

  it('returns nothing when no agent folders exist', async () => {
    expect(await listAllSessions(world().projects, {}, world().homes)).toEqual([])
  })
})
