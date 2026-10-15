import { agentLabel } from '../shared/agents'
import type { TranscriptRequest } from '../shared/transcript'
import { api } from './api'
import { toast } from './components/toast'
import { derivePanes, matchAll } from './derive'
import { folderOfPane, paneById, store } from './state'
import { getTerminal } from './terminals'

export function sessionIdOf(tab: { id: string; agent: string; sessionId?: string }): string | undefined {
  if (tab.sessionId) return tab.sessionId
  const matches = matchAll(store.state)
  if (tab.agent === 'claude') return matches.claude.get(tab.id)?.sessionId
  if (tab.agent === 'codex') return matches.codex.get(tab.id)?.sessionId
  if (tab.agent === 'gemini') return matches.gemini.get(tab.id)?.sessionId
  return undefined
}

export async function exportTranscript(paneId: string): Promise<void> {
  const state = store.state
  const pane = paneById(state, paneId)
  const view = derivePanes(state).find((v) => v.pane.id === paneId)
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? pane?.tabs[0]
  const folder = pane ? folderOfPane(state, pane) : null
  if (!pane || !view || !tab || !folder) return
  const request: TranscriptRequest = {
    agent: tab.agent,
    agentLabel: agentLabel(tab.agent),
    sessionId: sessionIdOf(tab),
    folder,
    projectName: view.project?.name ?? 'project',
    title: tab.agent !== 'shell' && view.named ? view.title : undefined
  }
  let result = await api.exportTranscript(request)
  if (result.status === 'no-session') {
    result = await api.exportTranscript({ ...request, scrollback: getTerminal(tab.id)?.bufferText() ?? '' })
  }
  if (result.status === 'saved') {
    const note = result.source === 'scrollback' ? ' (terminal text only)' : ''
    toast(`Transcript saved to ${result.path}${note}`, 'info')
  } else if (result.status === 'error') {
    toast(`Could not export the transcript: ${result.message}`)
  }
}
