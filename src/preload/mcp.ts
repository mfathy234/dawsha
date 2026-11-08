import { ipcRenderer } from 'electron'
import { MCP_IPC, type McpApi } from '../shared/mcp'

export function createMcpPreload(): McpApi {
  return {
    list: () => ipcRenderer.invoke(MCP_IPC.list),
    toggle: (request) => ipcRenderer.invoke(MCP_IPC.toggle, request),
    reveal: (request) => ipcRenderer.invoke(MCP_IPC.reveal, request),
    openFile: (request) => ipcRenderer.invoke(MCP_IPC.openFile, request)
  }
}
