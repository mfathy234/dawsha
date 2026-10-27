import { api } from './api'
import type { FileLinkHost } from './terminalLinks'
import type { HighlightHost } from './terminalHighlights'
import { workFolderOfPane } from './derive'
import { store } from './state'
import { openTerminalLink, openTerminalLinkMenu } from './terminalFileLinks'
import { currentBundle } from './themeManager'
import type { TerminalView } from './terminalView'

const CACHE_MS = 4000
const CACHE_LIMIT = 2000

const cache = new Map<string, { at: number; path: string | null }>()

function folderOfTerm(id: string): string | null {
  const pane = store.state.panes.find((p) => p.tabs.some((t) => t.id === id))
  return pane ? workFolderOfPane(store.state, pane) : null
}

async function existing(folder: string, paths: string[]): Promise<(string | null)[]> {
  const now = Date.now()
  const key = (path: string): string => `${folder}\n${path}`
  const missing = paths.filter((path) => {
    const hit = cache.get(key(path))
    return !hit || now - hit.at > CACHE_MS
  })
  if (missing.length > 0) {
    const found = await api.existingFiles(folder, missing)
    if (cache.size > CACHE_LIMIT) cache.clear()
    missing.forEach((path, i) => cache.set(key(path), { at: now, path: found[i] ?? null }))
  }
  return paths.map((path) => cache.get(key(path))?.path ?? null)
}

export function fileLinkHost(id: string): FileLinkHost {
  return {
    existing: async (paths) => {
      const folder = folderOfTerm(id)
      return folder ? existing(folder, paths) : paths.map(() => null)
    },
    open: (ref, mods) => void openTerminalLink(id, ref, mods, existing),
    menu: (ref, x, y, restoreFocus) => void openTerminalLinkMenu(id, ref, x, y, restoreFocus, existing)
  }
}

export const highlightHost = (): HighlightHost => ({
  config: () => ({ settings: store.state.settings.highlights, kind: currentBundle().theme.kind })
})

export function watchHighlights(views: () => Iterable<TerminalView>): void {
  let last = store.state.settings.highlights
  store.subscribe((state) => {
    if (state.settings.highlights === last) return
    last = state.settings.highlights
    for (const view of views()) view.refreshHighlights()
  })
}
