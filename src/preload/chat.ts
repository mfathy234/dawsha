import { ipcRenderer } from 'electron'
import { CHAT_IPC, type ChatApi } from '../shared/chatLog'

export function createChatPreload(): ChatApi {
  return {
    read: (request) => ipcRenderer.invoke(CHAT_IPC.read, request),
    release: (request) => ipcRenderer.invoke(CHAT_IPC.release, request)
  }
}
