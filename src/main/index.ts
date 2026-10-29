import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, Menu, app, ipcMain, net, powerMonitor, protocol, session } from 'electron'
import { IPC } from '../shared/ipc'
import { CodexWatcher } from './codexWatcher'
import { GeminiWatcher } from './geminiWatcher'
import { registerIpc } from './ipc'
import { notifyUser } from './desktop'
import { PREVIEW_SCHEME } from './filePreviewServer'
import { registerRunIpc } from './runCommands'
import { PtyManager } from './ptyManager'
import { Recorder } from './recorder'
import { RecordingService } from './recordings'
import { SessionsWatcher } from './sessionsWatcher'
import { denyPermissionRequests } from './mediaPermissions'
import { SettingsStore } from './settingsStore'
import { StatusWatcher } from './statusWatcher'
import { OpsWatcher } from './opsWatcher'
import { bridgeDirs, claudeSettingsPath, legacyUserDataDir, opsDirs } from './paths'
import { applyPendingPaneonImport } from './paneonImport'
import { platformExecutableDirs, resolveExecutable } from './executables'
import { migrateLegacyUserData } from './userDataMigration'
import { CliRunner } from './cliRunner'
import { startCliServer } from './cliServer'
import { setupUpdates } from './updates'
import { UsageService } from './usage'
import type { UpdateController } from './updateController'
import { createQuitLog } from './quitLog'
import { startQuitWatchdog } from './quitWatchdog'
import { requestCloseCheck } from './closeCheck'
import { FLUSH_TIMEOUT_MS, HARD_DEADLINE_MS, WATCHDOG_GRACE_MS, armHardDeadline, exitProcess, runPhases, runQuit, type ShutdownDeps } from './shutdown'
import { isPrivateRemoteBuild, isRemoteControlBuild } from '../shared/remoteBuild'

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
const pendingNotificationClicks: string[] = []

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
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
  return requestCloseCheck(ipcMain, window.webContents, quitLog)
}

function terminateProcess(code: number): void {
  exitProcess(code, { exit: (value) => app.exit(value), log: quitLog })
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function routeNotificationClick(paneId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!rendererReady) {
    pendingNotificationClicks.push(paneId)
    return
  }
  send(IPC.notifyClick, paneId)
}

ipcMain.on(IPC.cliReady, () => {
  rendererReady = true
  for (const paneId of pendingNotificationClicks.splice(0)) send(IPC.notifyClick, paneId)
})

function createWindow(): BrowserWindow {
  rendererReady = false
  // Automated tests set DAWSHA_OFFSCREEN=1: the window renders as usual but off-screen, out of the taskbar and
  // without taking focus, so test runs do not pop windows up on the user's desktop.
  const offscreen = process.env.DAWSHA_OFFSCREEN === '1'
  const window = new BrowserWindow({
    ...(offscreen ? { x: -32000, y: -32000, skipTaskbar: true, show: false } : {}),
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
  if (offscreen) window.showInactive()
  window.webContents.on('did-start-loading', () => {
    if (mainWindow === window) rendererReady = false
  })
  window.webContents.on('render-process-gone', () => {
    if (mainWindow === window) rendererReady = false
  })
  let flushedOnClose = false
  let asking = false
  window.on('close', (event) => {
    if (flushedOnClose) return
    event.preventDefault()
    if (asking) return
    asking = true
    // A quit that was already approved does not ask a second time as its windows close.
    void (quitting ? Promise.resolve(true) : askMayClose()).then((ok) => {
      asking = false
      if (!ok) return
      flushedOnClose = true
      void flushRenderer().finally(() => window.close())
    })
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
  let importNote: string | null = null
  try { importNote = applyPendingPaneonImport(userData) } catch (error) { importNote = `Paneon import was not applied: ${(error as Error).message}` }
  const store = new SettingsStore(join(userData, 'settings.json'))
  const loaded = store.load()
  const warning = [migration?.note, importNote, loaded.warning].filter(Boolean).join(' ') || null
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
  const watcher = new SessionsWatcher((sessions) => send(IPC.sessionsUpdate, sessions))
  const codexWatcher = new CodexWatcher((sessions) => send(IPC.codexUpdate, sessions))
  const geminiWatcher = new GeminiWatcher((sessions) => send(IPC.geminiUpdate, sessions))
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
  recordings.startSchedule()
  mainWindow = createWindow()
  cli = new CliRunner(() => mainWindow)
  const cliServer = startCliServer((request) => (cli as CliRunner).execute(request))
  app.on('will-quit', () => cliServer.close())
  void cli.executeFromArgv(process.argv, process.cwd())
  mainWindow.webContents.once('did-finish-load', () => {
    watcher.start()
    codexWatcher.start()
    geminiWatcher.start()
    statusWatcher.start()
    opsWatcher.start()
  })
  const shutdownDeps: ShutdownDeps = {
    log: quitLog,
    stopServices: async () => {
      watcher.stop()
      codexWatcher.stop()
      geminiWatcher.stop()
      statusWatcher.stop()
      opsWatcher.stop()
      updates?.stop()
      usage.flush()
      recordings.stopSchedule()
      await stopRunCommands()
      await remoteAccess?.stop()
    },
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
  app.on('will-quit', () => quitLog('will-quit'))
  app.on('quit', () => quitLog('quit'))
})

app.on('window-all-closed', () => app.quit())
