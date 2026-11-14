import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, Menu, app, ipcMain, net, powerMonitor, protocol, session } from 'electron'
import { IPC } from '../shared/ipc'
import { CodexWatcher } from './codexWatcher'
import { GeminiWatcher } from './geminiWatcher'
import { registerIpc } from './ipc'
import { stopCodeNavigation } from './codeNav'
import { closeAgentFiles, refreshAgentFiles } from './agentFiles'
import { notifyUser, handleNotificationActivation } from './desktop'
import { NOTIFICATION_SCHEME, type NotificationAnswer } from '../shared/notificationAction'
import { handleDesktopLaunch, installDesktopLaunch, refreshJumpList } from './desktopLaunch'
import { PREVIEW_SCHEME } from './filePreviewServer'
import { registerRunIpc } from './runCommands'
import { registerToolsIpc } from './toolsIpc'
import { registerTurnIpc } from './turnIpc'
import { registerMcpIpc } from './mcpIpc'
import { installMiniWindow } from './miniWindow'
import { PtyManager } from './ptyManager'
import { Recorder } from './recorder'
import { RecordingService } from './recordings'
import { SessionsWatcher } from './sessionsWatcher'
import { denyPermissionRequests } from './mediaPermissions'
import { SettingsStore } from './settingsStore'
import { StatusWatcher } from './statusWatcher'
import { OpsWatcher } from './opsWatcher'
import { bridgeDirs, claudeSettingsPath, legacyUserDataDir, opsDirs } from './paths'
import { platformExecutableDirs, resolveExecutable } from './executables'
import { migrateLegacyUserData } from './userDataMigration'
import { CliRunner } from './cliRunner'
import { startCliServer, stopCliServer } from './cliServer'
import { setupUpdates } from './updates'
import { UsageService } from './usage'
import type { UpdateController } from './updateController'
import { killAppUtilityChildren } from './childProcesses'
import { createQuitLog } from './quitLog'
import { startQuitWatchdog } from './quitWatchdog'
import { requestCloseCheck } from './closeCheck'
import { FLUSH_TIMEOUT_MS, HARD_DEADLINE_MS, WATCHDOG_GRACE_MS, armHardDeadline, exitProcess, runPhases, runQuit, stopAllServices, type ShutdownDeps } from './shutdown'
import { isPrivateRemoteBuild, isRemoteControlBuild } from '../shared/remoteBuild'
import { closeBehavior, startHidden } from '../shared/desktopSettings'
import { trayAvailable } from './trayState'
import { installLimitNotifications } from './limitNotifications'

const IMAGE_SCHEME = 'dawsha-image'
const quitLog = createQuitLog()

if (process.platform === 'win32') app.setAppUserModelId('io.github.mfathy234.dawsha')

if (process.env.DAWSHA_USER_DATA) app.setPath('userData', process.env.DAWSHA_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } }
])

let mainWindow: BrowserWindow | null = null
let cli: CliRunner | null = null
let updates: UpdateController | null = null
let quitting = false
let checkingQuit = false
let rendererReady = false
const pendingNotificationClicks: { paneId: string; answer?: NotificationAnswer }[] = []

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (handleNotificationActivation(argv, () => mainWindow, routeNotificationClick)) return
    if (handleDesktopLaunch(argv)) return
    if (!mainWindow || mainWindow.isDestroyed()) return
    // A second sign-in launch (--hidden) must not pull a running window out of the tray.
    if (!argv.includes('--hidden')) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    void cli?.executeFromArgv(argv, workingDirectory)
  })
}

function flushRenderer(): Promise<void> {
  const window = mainWindow
  if (!window || window.isDestroyed()) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener(IPC.flushDone, finish)
      resolve()
    }
    const timer = setTimeout(finish, FLUSH_TIMEOUT_MS)
    ipcMain.once(IPC.flushDone, finish)
    window.webContents.send(IPC.flushRequest)
  })
}

// Asks the page whether the app may close (unsaved Files tabs ask the user); a page that is not there answers yes.
function askMayClose(): Promise<boolean> {
  const window = mainWindow
  if (!window || window.isDestroyed() || !rendererReady) return Promise.resolve(true)
  // Quit can come from the tray; any unsaved-files confirmation must be reachable.
  if (!window.isVisible()) {
    if (window.isMinimized()) window.restore()
    if (process.env.DAWSHA_OFFSCREEN === '1') window.showInactive()
    else { window.show(); window.focus() }
  }
  return requestCloseCheck(ipcMain, window.webContents, quitLog)
}

function terminateProcess(code: number): void {
  killAppUtilityChildren(app.getAppMetrics(), process.pid, quitLog)
  exitProcess(code, { exit: (value) => app.exit(value), log: quitLog })
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function routeNotificationClick(paneId: string, answer?: NotificationAnswer): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!rendererReady) {
    pendingNotificationClicks.push({ paneId, answer })
    return
  }
  send(IPC.notifyClick, paneId, answer)
}

ipcMain.on(IPC.cliReady, () => {
  rendererReady = true
  for (const { paneId, answer } of pendingNotificationClicks.splice(0)) send(IPC.notifyClick, paneId, answer)
})

function createWindow(settings: SettingsStore, hidden: boolean): BrowserWindow {
  rendererReady = false
  // Automated tests set DAWSHA_OFFSCREEN=1: the window renders as usual but off-screen, out of the taskbar and
  // without taking focus, so test runs do not pop windows up on the user's desktop.
  const offscreen = process.env.DAWSHA_OFFSCREEN === '1'
  const window = new BrowserWindow({
    ...(offscreen ? { x: -32000, y: -32000, skipTaskbar: true, show: false } : {}),
    show: false,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Dawsha',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: '#0c0e12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Hidden from the start, the page still owns session state, Mini publishing and saving.
  if (hidden) window.webContents.backgroundThrottling = false
  else {
    if (offscreen) window.showInactive()
    else window.show()
  }
  window.webContents.on('did-start-loading', () => {
    if (mainWindow === window) rendererReady = false
  })
  window.webContents.on('render-process-gone', () => {
    if (mainWindow === window) rendererReady = false
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    if (checkingQuit) return
    if (closeBehavior(settings.get().desktop.closeBehavior, quitting, trayAvailable()) === 'quit') {
      app.quit()
      return
    }
    window.hide()
    if (process.platform !== 'darwin' && !settings.get().trayNoticeShown) {
      try { settings.update({ trayNoticeShown: true }) } catch (error) { console.warn('Could not save tray notice preference', error) }
      notifyUser(() => window, { paneId: '', title: 'Dawsha is still running in the tray', body: 'Choose Show Dawsha from the tray to return.', sound: settings.get().sessionInfo.sound, flash: false }, () => undefined)
    }
  })
  window.on('focus', () => window.flashFrame(false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // Electron shows no context menu by default; offer Copy / Cut / Paste / Select all only where they apply
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.selectionText && !params.isEditable) return
    const items = params.isEditable
      ? [{ role: 'cut' as const }, { role: 'copy' as const }, { role: 'paste' as const }, { type: 'separator' as const }, { role: 'selectAll' as const }]
      : [{ role: 'copy' as const }, { type: 'separator' as const }, { role: 'selectAll' as const }]
    Menu.buildFromTemplate(items).popup({ window })
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, isPrivateRemoteBuild ? '../renderer-private/index.html' : '../renderer/index.html'))
  return window
}

function registerImageProtocol(settings: SettingsStore): void {
  protocol.handle(IMAGE_SCHEME, async () => {
    const path = settings.get().theme.image.path
    if (!path) return new Response('No background image', { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { bypassCustomProtocolHandlers: true })
  })
}

app.whenReady().then(async () => {
  if (!gotLock) return
  Menu.setApplicationMenu(null)
  denyPermissionRequests()
  const userData = app.getPath('userData')
  const legacyDir = legacyUserDataDir()
  const migration = legacyDir
    ? migrateLegacyUserData({
        legacyDir,
        newDir: userData,
        claudeSettingsPath: claudeSettingsPath(),
        nodePath: resolveExecutable(process.platform === 'win32' ? 'node.exe' : 'node', platformExecutableDirs())
      })
    : null
  const store = new SettingsStore(join(userData, 'settings.json'))
  const loaded = store.load()
  const warning = [migration?.note, loaded.warning].filter(Boolean).join(' ') || null
  const remoteTerminals = isRemoteControlBuild
    ? new (await import('./remoteTerminalState')).RemoteTerminalState()
    : null
  const recorder = new Recorder({
    root: join(userData, 'recordings'),
    enabled: () => store.get().recordings.enabled
  })
  const recordings = new RecordingService(join(userData, 'recordings'), recorder, () => store.get().recordings)
  const ptys = new PtyManager({
    onData: (id, data) => send(IPC.ptyData, id, data),
    onExit: (id, code) => send(IPC.ptyExit, id, code)
  }, remoteTerminals, {
    recorder,
    projectName: (projectId) => store.get().projects.find((project) => project.id === projectId)?.name ?? ''
  })
  const watcher = new SessionsWatcher((sessions) => { send(IPC.sessionsUpdate, sessions); refreshAgentFiles() })
  const codexWatcher = new CodexWatcher((sessions) => { send(IPC.codexUpdate, sessions); refreshAgentFiles() })
  const geminiWatcher = new GeminiWatcher((sessions) => { send(IPC.geminiUpdate, sessions); refreshAgentFiles() })
  const usage = new UsageService(join(userData, 'usage-history.json'))
  usage.load()
  const statusWatcher = new StatusWatcher(bridgeDirs(app.getPath('userData')).statusDir, (infos) => {
    send(IPC.statusUpdate, infos)
    usage.recordStatus(infos)
  })
  const opsWatcher = new OpsWatcher(opsDirs(), (snapshots) => send(IPC.opsUpdate, snapshots))
  const remoteAccess = isRemoteControlBuild
    ? (await import('./remoteAccessController')).createRemoteAccessController({
        userDataDir: userData,
        assetDirectory: join(__dirname, isPrivateRemoteBuild ? '../renderer-private' : '../renderer'),
        settings: store,
        ptys,
        getWindow: () => mainWindow,
        crew: (await import('./remoteCrew')).createRemoteCrewBridge({ getWindow: () => mainWindow, ipc: ipcMain }),
        idleSeconds: () => powerMonitor.getSystemIdleTime(),
        notify: (title, body) => notifyUser(() => mainWindow, { paneId: '', title, body, sound: false }, () => undefined)
      })
    : undefined
  if (remoteAccess) {
    powerMonitor.on('resume', () => remoteAccess.onSystemResume())
    powerMonitor.on('unlock-screen', () => remoteAccess.onSystemResume())
  }
  registerImageProtocol(store)
  registerIpc(() => mainWindow, routeNotificationClick, store, ptys, statusWatcher, opsWatcher, usage, warning, remoteAccess, recordings)
  const stopRunCommands = registerRunIpc(() => mainWindow, store)
  const closeBrowserPane = registerToolsIpc(() => mainWindow, store)
  const stopTurnChecks = registerTurnIpc(() => mainWindow, store)
  registerMcpIpc(() => mainWindow, store)
  recordings.startSchedule()
  const openedAtLogin = app.isPackaged && process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
  mainWindow = createWindow(store, startHidden(process.argv, process.platform, store.get().desktop, openedAtLogin))
  // Test sandboxes and dev runs must not replace the installed app's registered protocol handler.
  const registerProtocol = app.isPackaged || process.env.DAWSHA_REGISTER_PROTOCOL === '1'
  if (process.platform === 'win32' && registerProtocol && !process.env.DAWSHA_NOTIFY_LOG) {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(NOTIFICATION_SCHEME, process.execPath, [resolve(process.argv[1])])
    else if (!process.defaultApp) app.setAsDefaultProtocolClient(NOTIFICATION_SCHEME)
  }
  const stopMiniWindow = installMiniWindow(mainWindow, store)
  // Without a tray icon a hidden window could never be brought back.
  if (!trayAvailable() && !mainWindow.isVisible()) mainWindow.show()
  const stopLimitNotifications = installLimitNotifications(() => mainWindow, store, usage, statusWatcher)
  cli = new CliRunner(() => mainWindow)
  installDesktopLaunch(() => store.get(), cli)
  refreshJumpList(store.get())
  const cliServer = startCliServer((request) => (cli as CliRunner).execute(request))
  app.on('will-quit', () => { void stopCliServer(cliServer) })
  if (!handleNotificationActivation(process.argv, () => mainWindow, routeNotificationClick) && !handleDesktopLaunch(process.argv)) void cli.executeFromArgv(process.argv, process.cwd())
  mainWindow.webContents.once('did-finish-load', () => {
    watcher.start()
    codexWatcher.start()
    geminiWatcher.start()
    statusWatcher.start()
    opsWatcher.start()
  })
  const shutdownDeps: ShutdownDeps = {
    log: quitLog,
    stopServices: () => stopAllServices([
      ['Mini window', stopMiniWindow], ['CLI bridge', () => stopCliServer(cliServer)],
      ['limit notifications', stopLimitNotifications],
      ['code navigation', stopCodeNavigation], ['browser pane', closeBrowserPane],
      ['sessions watcher', () => watcher.stop()], ['agent files', closeAgentFiles],
      ['Codex watcher', () => codexWatcher.stop()], ['Gemini watcher', () => geminiWatcher.stop()],
      ['status watcher', () => statusWatcher.stop()], ['ops watcher', () => opsWatcher.stop()],
      ['updates', () => updates?.stop()], ['usage', () => usage.flush()],
      ['recording schedule', () => recordings.stopSchedule()],
      ['run commands', stopRunCommands], ['turn checks', stopTurnChecks],
      ['Remote Control', () => remoteAccess?.stop()],
      ['Chromium connections', () => session.defaultSession.closeAllConnections()]
    ], quitLog),
    flushRenderer,
    flushStorage: async () => {
      await recorder.closeAll()
      session.defaultSession.flushStorageData()
      await session.defaultSession.cookies.flushStore()
    },
    terminateAll: (timeoutMs) => ptys.terminateAll(timeoutMs, quitLog),
    finish: () => {
      if (!updates?.installOnQuit()) terminateProcess(0)
    },
    exit: terminateProcess
  }
  const armWatchdog = (): void => {
    startQuitWatchdog({ ms: HARD_DEADLINE_MS + WATCHDOG_GRACE_MS })
  }
  const shutdown = async (): Promise<void> => {
    armWatchdog()
    armHardDeadline(shutdownDeps)
    await runPhases(shutdownDeps)
  }
  updates = setupUpdates({
    settings: store,
    send,
    shutdown,
    autoUpdates: !isPrivateRemoteBuild,
    mayQuit: askMayClose,
    markQuitting: () => {
      quitting = true
    }
  })
  app.on('before-quit', (event) => {
    quitLog(`before-quit fired (already quitting: ${quitting})`)
    if (quitting) return
    event.preventDefault()
    if (checkingQuit) return
    checkingQuit = true
    void askMayClose().then((ok) => {
      checkingQuit = false
      if (!ok) return
      quitting = true
      armWatchdog()
      void runQuit(shutdownDeps)
    })
  })
  app.on('will-quit', () => {
    quitLog('will-quit')
    killAppUtilityChildren(app.getAppMetrics(), process.pid, quitLog)
  })
  app.on('quit', () => quitLog('quit'))
})

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
