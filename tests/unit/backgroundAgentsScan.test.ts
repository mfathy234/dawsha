import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackgroundAgentScanner, projectForFolder } from '../../src/main/backgroundAgents'
import { claudeProjectSlug } from '../../src/shared/projectSessions'
import type { Project } from '../../src/shared/types'

const NOW = Date.now()
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')
const iso = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
const touch = (path: string, minutes: number): void => utimesSync(path, new Date(NOW - minutes * 60_000), new Date(NOW - minutes * 60_000))

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dawsha-bg-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const projects: Project[] = [{ id: 'demo', name: 'Demo', folder: 'C:\\work\\demo' }] as Project[]
const prices = () => null

function seedClaude(): void {
  const dir = join(root, 'claude', 'projects', claudeProjectSlug('C:\\work\\demo'))
  const sub = join(dir, 'parent-1', 'subagents')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(dir, 'parent-1.jsonl'), lines({ type: 'ai-title', aiTitle: 'Release polish' }))
  const agent = (id: string, finished: boolean, ageMinutes: number, text: string) => {
    writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: `Task ${id}`, spawnDepth: 1, ...(finished ? { finished: true } : {}) }))
    writeFileSync(join(sub, `agent-${id}.jsonl`), lines({ type: 'user', timestamp: iso(ageMinutes + 10), cwd: 'C:\\work\\demo', message: { content: 'go' } }, { type: 'assistant', timestamp: iso(ageMinutes), message: { id: `m-${id}`, stop_reason: text ? 'end_turn' : 'tool_use', usage: { input_tokens: 10, output_tokens: 20 }, content: [text ? { type: 'text', text } : { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }))
    touch(join(sub, `agent-${id}.jsonl`), ageMinutes)
  }
  agent('run', false, 1, '')
  agent('done', true, 30, 'All good')
  agent('old', true, 600, 'Ancient')
  const stray = join(root, 'claude', 'projects', 'C--elsewhere', 'p2', 'subagents')
  mkdirSync(stray, { recursive: true })
  writeFileSync(join(stray, 'agent-x.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Elsewhere', finished: true }))
  writeFileSync(join(stray, 'agent-x.jsonl'), lines({ type: 'user', timestamp: iso(20), cwd: 'D:\\other\\place', message: { content: 'go' } }, { type: 'assistant', timestamp: iso(19), message: { id: 'z', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } }))
}

describe('BackgroundAgentScanner', () => {
  it('finds Claude agents inside the range, names their parent, maps projects and caches', async () => {
    seedClaude()
    const scanner = new BackgroundAgentScanner(() => ({ claudeProjects: join(root, 'claude', 'projects'), codex: join(root, 'codex') }))
    const report = await scanner.list('2h', projects, prices, NOW)
    const byId = Object.fromEntries(report.agents.map((agent) => [agent.id, agent]))
    expect(Object.keys(byId).sort()).toEqual(['done', 'run', 'x'])
    expect(byId.run).toMatchObject({ status: 'running', projectId: 'demo', parentTitle: 'Release polish', lastStep: 'Read a.ts', tokens: 30 })
    expect(byId.done).toMatchObject({ status: 'done', result: 'All good', description: 'Task done' })
    expect(byId.x).toMatchObject({ projectId: null, projectLabel: 'place' })
    expect(scanner.pathOf('claude', 'done')).toContain('agent-done.jsonl')
    expect(scanner.pathOf('claude', 'old')).toBeNull()
    const wider = await scanner.list('7d', projects, prices, NOW)
    expect(wider.agents.map((agent) => agent.id)).toContain('old')
  })

  it('finds Codex sub-agents, climbs nested ones to the root session and skips ordinary sessions', async () => {
    const day = join(root, 'codex', 'sessions', '2026', '01', '01')
    mkdirSync(day, { recursive: true })
    const stamp = new Date(NOW - 3_600_000)
    const name = (id: string) => `rollout-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}T${String(stamp.getHours()).padStart(2, '0')}-00-00-${id}.jsonl`
    const ids = { root: '11111111-1111-1111-1111-111111111111', mid: '22222222-2222-2222-2222-222222222222', leaf: '33333333-3333-3333-3333-333333333333' }
    const meta = (id: string, parent: string | null) => ({ type: 'session_meta', timestamp: iso(40), payload: { id, timestamp: iso(40), cwd: 'C:\\work\\demo', ...(parent ? { parent_thread_id: parent, source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } } : { source: 'vscode' }) } })
    writeFileSync(join(day, name(ids.root)), lines(meta(ids.root, null)))
    writeFileSync(join(day, name(ids.mid)), lines(meta(ids.mid, ids.root), { type: 'event_msg', timestamp: iso(10), payload: { type: 'task_complete', last_agent_message: 'mid done' } }))
    writeFileSync(join(day, name(ids.leaf)), lines(meta(ids.leaf, ids.mid), { type: 'event_msg', timestamp: iso(2), payload: { type: 'task_started' } }))
    writeFileSync(join(root, 'codex', 'session_index.jsonl'), lines({ id: ids.root, thread_name: 'Trial import' }))
    for (const id of Object.values(ids)) touch(join(day, name(id)), 1)
    const scanner = new BackgroundAgentScanner(() => ({ claudeProjects: join(root, 'none'), codex: join(root, 'codex') }))
    const report = await scanner.list('24h', projects, prices, NOW)
    expect(report.agents.map((agent) => agent.id).sort()).toEqual([ids.leaf, ids.mid].sort())
    for (const agent of report.agents) expect(agent).toMatchObject({ parentId: ids.root, parentTitle: 'Trial import', projectId: 'demo' })
    expect(report.agents.find((agent) => agent.id === ids.leaf)?.status).toBe('running')
  })

  it('returns nothing for missing homes', async () => {
    const scanner = new BackgroundAgentScanner(() => ({ claudeProjects: join(root, 'a'), codex: join(root, 'b') }))
    expect((await scanner.list('1h', projects, prices, NOW)).agents).toEqual([])
  })

  it('matches a folder to the deepest containing project', () => {
    const nested = [...projects, { id: 'sub', name: 'Sub', folder: 'C:\\work\\demo\\sub' }] as Project[]
    expect(projectForFolder('C:\\work\\demo\\sub\\x', nested)?.id).toBe('sub')
    expect(projectForFolder('C:\\work\\demo2', nested)).toBeNull()
  })
})
