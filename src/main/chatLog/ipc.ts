import { ipcMain } from 'electron'
import { CHAT_IPC, type ChatReadRequest, type ChatReleaseRequest } from '../../shared/chatLog'
import type { ChatImageActionRequest, ChatImageRequest } from '../../shared/chatImage'
import { loadChatImage, runChatImageAction } from './imageService'
import { readChat, releaseChat } from './service'

export function registerChatIpc(): void {
  ipcMain.handle(CHAT_IPC.read, (_event, request: ChatReadRequest) => readChat(request))
  ipcMain.handle(CHAT_IPC.release, (_event, request: ChatReleaseRequest) => releaseChat(request))
  ipcMain.handle(CHAT_IPC.image, (_event, request: ChatImageRequest) => loadChatImage(request))
  ipcMain.handle(CHAT_IPC.imageAction, (_event, request: ChatImageActionRequest) => runChatImageAction(request))
}
