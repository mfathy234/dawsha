import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { MCP_IPC, publicServer, type McpActionResult, type McpOpenResult, type McpReport, type McpRevealResult } from '../shared/mcp'
import { listMcpServers, mcpPaths, mcpServerFile, revealMcpValue, toggleMcpServer, type McpProject } from './mcpServers'

interface McpStore {
  get(): { projects: ReadonlyArray<McpProject> }
}

const MAX_ID = 600
const BAD = 'That request was not valid.'
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID && !value.includes('\0')
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

function fromAppWindow(window: BrowserWindow | null, event: IpcMainInvokeEvent): boolean {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
}

/** MCP page handlers. Requests name a listed server by id; they never carry a path, and only the agents' own config files are written. */
export function registerMcpIpc(getWindow: () => BrowserWindow | null, store: McpStore): void {
  const projects = (): McpProject[] => store.get().projects.map(({ name, folder }) => ({ name, folder }))
  const report = async (): Promise<McpReport> => ({ servers: (await listMcpServers(mcpPaths(), projects())).map(publicServer) })
  const handle = <R>(channel: string, refusal: R, run: (request: Record<string, unknown>) => Promise<R>): void => {
    ipcMain.handle(channel, (event, request: unknown) => (fromAppWindow(getWindow(), event) ? run(record(request)) : refusal))
  }

  ipcMain.handle(MCP_IPC.list, (event): Promise<McpReport> | McpReport => (fromAppWindow(getWindow(), event) ? report() : { servers: [] }))
  handle<McpActionResult>(MCP_IPC.toggle, { ok: false, error: BAD }, async ({ id, enabled }) => {
    if (!isId(id) || typeof enabled !== 'boolean') return { ok: false, error: BAD }
    const done = await toggleMcpServer(mcpPaths(), projects(), id, enabled)
    return done.ok ? { ok: true, report: await report() } : done
  })
  handle<McpRevealResult>(MCP_IPC.reveal, { ok: false, error: BAD }, async ({ id, key, group }) => {
    if (!isId(id) || typeof key !== 'string' || key.length > 300 || (group !== 'env' && group !== 'headers')) return { ok: false, error: BAD }
    const value = await revealMcpValue(mcpPaths(), projects(), id, key, group)
    return value === null ? { ok: false, error: 'That value could not be found.' } : { ok: true, value }
  })
  handle<McpOpenResult>(MCP_IPC.openFile, { ok: false, error: BAD }, async ({ id }) => {
    if (!isId(id)) return { ok: false, error: BAD }
    const file = await mcpServerFile(mcpPaths(), projects(), id)
    if (!file) return { ok: false, error: 'That server is no longer listed.' }
    const failed = await shell.openPath(file)
    return failed ? { ok: false, error: 'The file could not be opened.' } : { ok: true }
  })
}
