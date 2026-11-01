import { stat } from 'node:fs/promises'
import { normalizeFolder } from '../shared/folderKey'
import type { AgentEditEvent } from '../shared/codeNavExtras'
import { AgentFileActivity, type SessionEvidence } from './agentFileActivity'
import { listSessionSources } from './sessionIndex'
import { parseLogFile } from './sessionTimeline'

async function evidence(folder: string): Promise<SessionEvidence[]> {
  const sources = await listSessionSources([{ id: 'files', folder, name: 'Files', defaultAgent: 'claude' }], { limit: 20 })
  const out: SessionEvidence[] = []
  for (const source of sources) {
    const agent = source.session.agent
    try {
      const info = await stat(source.path)
      out.push({ agent, sessionId: source.session.id, events: await parseLogFile(agent, source.path, info.size), truncated: info.size > 8 * 1024 * 1024 })
    } catch { /* A rotated or removed log has no evidence to contribute. */ }
  }
  return out
}

let sink: (event: AgentEditEvent) => void = () => undefined
export const agentFileActivity = new AgentFileActivity(evidence, event => sink(event))
const watched = new Map<string, { folder: string; count: number }>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()

export function setAgentEditSink(emit: (event: AgentEditEvent) => void): void { sink = emit }

export function watchAgentFiles(folder: string): void {
  const key = normalizeFolder(folder)
  const previous = watched.get(key)
  watched.set(key, { folder, count: (previous?.count ?? 0) + 1 })
  if (!previous) void agentFileActivity.refresh(folder)
}

export function unwatchAgentFiles(folder: string): void {
  const key = normalizeFolder(folder)
  const previous = watched.get(key)
  if (previous && previous.count > 1) { watched.set(key, { ...previous, count: previous.count - 1 }); return }
  watched.delete(key)
  clearTimeout(pending.get(key))
  pending.delete(key)
  agentFileActivity.forget(folder)
}

/** Existing filesystem and session watchers call this; debounce transcript reads after edits settle. */
export function refreshAgentFiles(folder?: string): void {
  for (const [key, entry] of watched) {
    if (folder && normalizeFolder(folder) !== key) continue
    clearTimeout(pending.get(key))
    pending.set(key, setTimeout(() => {
      pending.delete(key)
      if (watched.has(key)) void agentFileActivity.refresh(entry.folder)
    }, 350))
  }
}

export function closeAgentFiles(): void {
  for (const entry of watched.values()) agentFileActivity.forget(entry.folder)
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  watched.clear()
}
