import { AGENT_NAMES } from '../shared/agents'
import { failureMessage, type Block } from '../shared/terminalBlocks'
import type { TabAgent } from '../shared/types'
import { api } from './api'
import { openContextMenu, type ContextItem } from './components/contextMenu'
import { toast } from './components/toast'
import { derivePanes } from './derive'
import { insertIntoSession, requestFilesSearch } from './files/filesActions'
import { showView } from './actions'
import { store } from './state'
import type { BlockCallbacks } from './terminalBlockTools'

const SEARCH_DELAY_MS = 80

function paneOf(termId: string) {
  return derivePanes(store.state).find((view) => view.pane.tabs.some((tab) => tab.id === termId))
}

function tabOf(termId: string) {
  for (const pane of store.state.panes) {
    const tab = pane.tabs.find((candidate) => candidate.id === termId)
    if (tab) return tab
  }
  return undefined
}

const agentName = (agent: TabAgent | undefined): string => (agent && agent !== 'shell' ? AGENT_NAMES[agent] : 'the agent')

function sessionEntries(termId: string, text: string): ContextItem[] {
  const here = paneOf(termId)
  const views = derivePanes(store.state).filter((view) => view.pane.tabs.length > 0)
  const ordered = [...views.filter((view) => view.pane.id === here?.pane.id), ...views.filter((view) => view.pane.id !== here?.pane.id)]
  return ordered.map((view) => ({
    label: view.title,
    detail: view.pane.id === here?.pane.id ? 'This session' : view.project?.name,
    run: () => void insertIntoSession(view.pane.id, text)
  }))
}

function chooseSession(termId: string, text: string, at: { x: number; y: number }, label: string): void {
  const entries = sessionEntries(termId, text)
  if (entries.length === 0) return void toast('No session is open.', 'info')
  if (entries.length === 1) return entries[0].run()
  openContextMenu({ x: at.x, y: at.y, label, entries: [{ heading: label }, ...entries] })
}

/** What the block tools need from the app: the agent, clipboard, other sessions and Files. */
export function blockCallbacks(termId: string): BlockCallbacks {
  return {
    agent: () => tabOf(termId)?.agent,
    busy: () => paneOf(termId)?.status === 'busy',
    readingOnScroll: () => store.state.settings.readingOnScroll,
    agentName: () => agentName(tabOf(termId)?.agent),
    copy: (text, done) => void api.writeClipboard(text).then(() => toast(done, 'info'), () => toast('Could not copy to the clipboard.')),
    copyImage: async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        toast('Copied as an image', 'info')
      } catch {
        toast('Could not copy the image.')
      }
    },
    askSession: (text, at) => chooseSession(termId, `Here is output from another session:\n\n${text}\n`, at, 'Ask another session'),
    sendFailure: (block: Block, text: string, at) => chooseSession(termId, failureMessage(block, text), at, 'Send the failure to'),
    searchFiles: (text: string) => {
      void api.writeClipboard(text)
      showView('files')
      window.setTimeout(requestFilesSearch, SEARCH_DELAY_MS)
      toast('Copied the text. Paste it into Search.', 'info')
    }
  }
}

