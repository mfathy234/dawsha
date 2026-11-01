import { ipcMain } from 'electron'
import { CHAT_IPC, type ChatReadRequest, type ChatReleaseRequest } from '../../shared/chatLog'
import { readChat, releaseChat } from './service'

export function registerChatIpc(): void {
  ipcMain.handle(CHAT_IPC.read, (_event, request: ChatReadRequest) => readChat(request))
  ipcMain.handle(CHAT_IPC.release, (_event, request: ChatReleaseRequest) => releaseChat(request))
}
