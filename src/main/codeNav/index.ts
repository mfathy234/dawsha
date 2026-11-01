import { CsharpServers } from './csharp'
import { NavigationProcesses } from './processes'
import { CodeNavRouter } from './router'
import { startTsServer } from './utility'

const processes = new NavigationProcesses()
const csharp = new CsharpServers(processes)
export const codeNavigation = new CodeNavRouter({
  typescript: folder => startTsServer(folder, processes),
  csharp: (folder, file) => csharp.server(folder, file),
  canInstall: () => csharp.canInstall()
})

export async function installCodeNav(): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await csharp.install()
  if (result.ok) codeNavigation.installed()
  return result
}

export function stopCodeNavigation(): void { codeNavigation.stop(); processes.stop() }
