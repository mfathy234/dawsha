import { store, type PaneState } from './state'
import { workFolderOfPane } from './derive'

const directories = new Map<string, string>()
const drawers = new Map<string, string>()
export const registerDrawer = (id: string, paneId: string): void => { drawers.set(id, paneId) }
export const terminalPane = (id: string): PaneState | undefined =>
  store.state.panes.find((pane) => pane.tabs.some((tab) => tab.id === id) || drawers.get(id) === pane.id)
export const terminalAgent = (id: string) => drawers.has(id) ? 'shell' as const : terminalPane(id)?.tabs.find((tab) => tab.id === id)?.agent
export const terminalDirectory = (id: string): string | null => {
  const pane = terminalPane(id)
  return directories.get(id) ?? (pane ? workFolderOfPane(store.state, pane) : null)
}
export const setTerminalDirectory = (id: string, folder: string): void => { directories.set(id, folder) }
export const forgetTerminalSession = (id: string): void => { directories.delete(id); drawers.delete(id) }
