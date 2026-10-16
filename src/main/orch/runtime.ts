import { startOrchMcpServer, type OrchMcpServer } from './mcpServer'
import { OrchService } from './service'
import { OrchStore } from './store'

/** Owns the orchestrator's database and MCP server for the life of the app (experimental feature). */
export class OrchRuntime {
  private store: OrchStore | null = null
  private server: OrchMcpServer | null = null
  private starting: Promise<OrchMcpServer> | null = null
  service: OrchService | null = null

  constructor(private readonly dbPath: string, private readonly version: string) {}

  get running(): boolean {
    return this.server !== null
  }

  start(): Promise<OrchMcpServer> {
    if (this.server) return Promise.resolve(this.server)
    if (!this.starting) this.starting = this.open().finally(() => (this.starting = null))
    return this.starting
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined)
    const server = this.server
    this.server = null
    this.service = null
    if (server) await server.close()
    this.store?.close()
    this.store = null
  }

  private async open(): Promise<OrchMcpServer> {
    const store = new OrchStore(this.dbPath)
    const service = new OrchService(store)
    try {
      const server = await startOrchMcpServer(service, { version: this.version })
      this.store = store
      this.service = service
      this.server = server
      return server
    } catch (error) {
      store.close()
      throw error
    }
  }
}
