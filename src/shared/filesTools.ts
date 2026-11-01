import type { BrowserCapture, BrowserCommand, BrowserErrors, BrowserResult, BrowserState } from './browserPane'
import type { ConfigReport, ConfigRevealRequest, ConfigRevealResult } from './configFiles'
import type { PrActionResult, PrOverviewResult, PrRequest } from './prFlow'

export const TOOLS_IPC = {
  configRead: 'tools:config-read',
  configReveal: 'tools:config-reveal',
  pr: 'tools:pr',
  browser: 'tools:browser',
  browserShot: 'tools:browser-shot',
  browserErrors: 'tools:browser-errors',
  browserState: 'tools:browser-state'
} as const

/** Config, pull request and browser tools of the Files bottom panel. */
export interface FilesToolsApi {
  readConfig(folder: string): Promise<ConfigReport>
  revealConfig(request: ConfigRevealRequest): Promise<ConfigRevealResult>
  pullRequest(request: Extract<PrRequest, { action: 'overview' }>): Promise<PrOverviewResult>
  pullRequest(request: Exclude<PrRequest, { action: 'overview' }>): Promise<PrActionResult>
  browser(command: BrowserCommand): Promise<BrowserResult>
  browserShot(): Promise<BrowserCapture>
  browserErrors(): Promise<BrowserErrors>
  onBrowserState(listener: (state: BrowserState) => void): () => void
}
