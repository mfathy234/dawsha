import { dropPasteText, DROP_FILE_LIMIT, pathsFromUriList, shellKindOf } from '../shared/clipboard'
import { store } from './state'
import type { TabAgent } from '../shared/types'
import { api } from './api'
import { getTerminal } from './terminals'

export const hasFiles = (transfer: DataTransfer | null): boolean => transfer?.types.includes('Files') === true

export function droppedPaths(transfer: DataTransfer): string[] {
  const fromFiles = [...transfer.files].slice(0, DROP_FILE_LIMIT).map((file) => api.pathForFile(file))
  if (fromFiles.some((path) => path !== '')) return fromFiles.filter((path) => path !== '')
  return pathsFromUriList(transfer.getData('text/uri-list'))
}

export function dropFiles(transfer: DataTransfer, tabId: string, agent: TabAgent | undefined): void {
  const text = dropPasteText(agent, droppedPaths(transfer), shellKindOf(store.state.info.shellCommand))
  if (text === '') return
  const view = getTerminal(tabId)
  if (!view) return
  view.focus()
  view.insertText(text)
}

export function guardWindowDrops(): void {
  const block = (event: DragEvent): void => {
    if (hasFiles(event.dataTransfer)) event.preventDefault()
  }
  window.addEventListener('dragover', block)
  window.addEventListener('drop', block)
}
