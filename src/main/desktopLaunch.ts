import { app } from 'electron'
import { buildJumpList, parseDesktopAction, type DesktopAction } from '../shared/platformActions'
import type { Settings } from '../shared/types'
import type { CliRunner } from './cliRunner'

let miniWindowHandler = (): void => { /* The Mini window owner supplies this hook during app startup. */ }
export function setMiniWindowLaunchHandler(handler: () => void): void { miniWindowHandler = handler }
export function openMiniWindowFromDesktop(): void { miniWindowHandler() }

let launch: ((action: DesktopAction) => Promise<void>) | null = null
const pending: DesktopAction[] = []

/** Shared by initial launch and second-instance; actions wait for the window and CLI bridge. */
export function handleDesktopLaunch(argv: readonly string[]): boolean {
  const action = parseDesktopAction(argv)
  if (!action) return false
  if (launch) void launch(action)
  else pending.push(action)
  return true
}

export function installDesktopLaunch(getSettings: () => Settings, cli: CliRunner): void {
  launch = async (action) => {
    if (action.kind === 'mini-window') return openMiniWindowFromDesktop()
    if (!action.projectId) return cli.openSessionPicker()
    const project = getSettings().projects.find(project => project.id === action.projectId)
    if (project) await cli.execute({ args: ['start', project.folder, '--agent', 'claude'], cwd: project.folder })
  }
  for (const action of pending.splice(0)) void launch(action)
}

export function refreshJumpList(settings: Settings): void {
  if (process.platform !== 'win32') return
  try {
    const removed = app.getJumpListSettings().removedItems.map(item => item.args ?? '')
    const prefix = app.isPackaged ? '' : `"${app.getAppPath()}" `
    app.setJumpList(buildJumpList(settings.projects, settings.recentProjectIds, process.execPath, removed, prefix))
  } catch { /* Windows privacy settings may disallow custom jump lists. */ }
}
