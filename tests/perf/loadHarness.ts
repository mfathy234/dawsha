import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectSlug } from '../../src/shared/projectSessions'
import type { Sandbox } from '../e2e/helpers'

export const PROJECTS = 16
export const PANES = Number(process.env.PERF_PANES ?? 9)

export interface LoadSetup {
  folders: string[]
  chatSessionId: string
}

/** Writes about `megabytes` of Claude-style session log, mostly tool results, for one session. */
export function writeChatLog(sandbox: Sandbox, folder: string, sessionId: string, megabytes: number): string {
  const dir = join(sandbox.claudeHome, 'projects', claudeProjectSlug(folder))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sessionId}.jsonl`)
  const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(12)
  let written = 0
  let index = 0
  let batch: string[] = []
  const flush = (): void => { appendFileSync(file, batch.join('\n') + '\n'); batch = [] }
  writeFileSync(file, '')
  while (written < megabytes * 1024 * 1024) {
    const at = new Date(Date.now() - (200_000 - index) * 1000).toISOString()
    const id = `toolu_${index}`
    const lines = [
      { type: 'user', uuid: `u${index}`, sessionId, cwd: folder, timestamp: at, message: { role: 'user', content: `Step ${index}: please look at the parser and fix the failing case.` } },
      { type: 'assistant', uuid: `a${index}`, sessionId, timestamp: at, message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: `${filler.slice(0, 600)} (${index})` }, { type: 'tool_use', id, name: 'Bash', input: { command: `npm test -- case-${index}`, description: 'Run the tests' } }] } },
      { type: 'user', uuid: `r${index}`, sessionId, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: filler.slice(0, 4000) }] } }
    ].map((record) => JSON.stringify(record))
    for (const line of lines) { batch.push(line); written += line.length + 1 }
    index += 1
    if (batch.length > 600) flush()
  }
  flush()
  return file
}

export function seedLoad(sandbox: Sandbox, options: { chat: boolean; chatView: boolean }): LoadSetup {
  const folders = Array.from({ length: PROJECTS }, (_, i) => join(sandbox.root, `Project ${String(i + 1).padStart(2, '0')}`))
  for (const folder of folders) mkdirSync(folder, { recursive: true })
  const chatSessionId = '11111111-2222-4333-8444-555555555555'
  const settings = {
    version: 2,
    lastSeenVersion: process.env.PERF_VERSION ?? require('../../package.json').version,
    tourSeen: true,
    appearance: { panes: 'quiet', frame: 'sidebar', tone: 'warm' },
    projects: folders.map((folder, i) => ({ id: `p${i}`, name: `Project ${String(i + 1).padStart(2, '0')}`, folder })),
    workspace: {
      focusedIndex: 0,
      maximizedIndex: 0,
      panes: Array.from({ length: PANES }, (_, i) => ({
        projectId: `p${i}`,
        activeIndex: 0,
        tabs: [{ agent: 'claude', label: 'claude', ...(i === 0 && options.chat ? { sessionId: chatSessionId } : {}), ...(i === 0 && options.chatView ? { view: 'chat' } : {}) }]
      }))
    }
  }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
  if (options.chat) writeChatLog(sandbox, folders[0], chatSessionId, 15)
  return { folders, chatSessionId }
}
