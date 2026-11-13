import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { MINI_IPC, isMiniAction, miniBounds, miniContentBounds, type MiniSnapshot } from '../shared/miniWindow'
import { isPrivateRemoteBuild } from '../shared/remoteBuild'
import type { SettingsStore } from './settingsStore'
import { MiniPlans } from './miniPlans'
import { onAttentionCount } from './desktop'
import { setMiniWindowLaunchHandler } from './desktopLaunch'
import type { MiniPlanRequest } from '../shared/miniWindow'

/** Owns native lifecycle only. Session state and approval execution belong to the main renderer. */
const MAX_PLAN_REQUESTS = 50

export function installMiniWindow(main: BrowserWindow, settings: SettingsStore): () => void {
  let mini: BrowserWindow | null = null
  let snapshot: MiniSnapshot | null = null
  let stopping = false
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  const offscreen = process.env.DAWSHA_OFFSCREEN === '1'
  const plans = new MiniPlans()
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent, window: BrowserWindow | null): boolean =>
    !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  const host = (channel: string, value: unknown): void => { if (!main.isDestroyed()) main.webContents.send(channel, value) }
  const showMain = (): void => {
    if (main.isDestroyed()) return
    if (main.isMinimized()) main.restore()
    if (offscreen) main.showInactive()
    else { main.show(); main.focus() }
  }
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  const tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('Dawsha')
  const updateMenu = (): void => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dawsha', click: showMain },
    { label: 'Mini window', type: 'checkbox', checked: !!mini?.isVisible(), click: () => toggle() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]))
  const visibility = (visible: boolean): void => {
    if (stopping) return
    // The source renderer must keep publishing while its native window is minimized.
    if (!main.isDestroyed()) main.webContents.backgroundThrottling = !visible
    host(MINI_IPC.visibility, visible)
    if (!visible) plans.clear()
    updateMenu()
  }
  const persist = (): void => {
    clearTimeout(persistTimer)
    if (offscreen || !mini || mini.isDestroyed()) return
    const bounds = mini.getBounds()
    try {
      settings.update({ miniWindow: { ...settings.get().miniWindow, bounds } })
      host(MINI_IPC.bounds, bounds)
    } catch (error) { console.warn('Could not save Mini window position', error) }
  }
  const schedulePersist = (): void => {
    if (stopping) return
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persist, 200)
  }
  const resize = (height: number): void => {
    if (!mini || mini.isDestroyed()) return
    const previous = mini.getBounds()
    const area = screen.getDisplayMatching(previous).workArea
    const next = miniContentBounds(previous, height, area, offscreen)
    if (previous.height !== next.height) mini.setBounds(next)
  }
  const open = (): void => {
    if (stopping) return
    if (!mini || mini.isDestroyed()) {
      const bounds = miniBounds(settings.get().miniWindow.bounds, screen.getAllDisplays().map(d => d.workArea), screen.getDisplayMatching(main.getBounds()).workArea)
      mini = new BrowserWindow({
        ...bounds, ...(offscreen ? { x: -32000, y: -32000 } : {}),
        minWidth: 300, minHeight: 52, maxHeight: 640, show: false, title: 'Dawsha Mini',
        frame: false, alwaysOnTop: true, skipTaskbar: true, maximizable: false, fullscreenable: false,
        backgroundColor: '#16191f', icon,
        webPreferences: { preload: join(__dirname, '../preload/mini.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
      })
      mini.setMenu(null)
      mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      mini.webContents.on('will-navigate', event => event.preventDefault())
      mini.on('close', event => {
        if (stopping) return
        event.preventDefault()
        persist()
        mini?.hide()
      })
      mini.on('show', () => visibility(true))
      mini.on('hide', () => visibility(false))
      mini.on('move', schedulePersist)
      mini.on('resize', schedulePersist)
      mini.once('ready-to-show', () => { if (!stopping) mini?.showInactive() })
      if (process.env.ELECTRON_RENDERER_URL) void mini.loadURL(`${process.env.ELECTRON_RENDERER_URL}/mini.html`)
      else void mini.loadFile(join(__dirname, isPrivateRemoteBuild ? '../renderer-private/mini.html' : '../renderer/mini.html'))
    } else {
      if (!offscreen) mini.setBounds(miniBounds(mini.getBounds(), screen.getAllDisplays().map(d => d.workArea), screen.getDisplayMatching(main.getBounds()).workArea))
      mini.showInactive()
    }
  }
  function toggle(): void {
    if (mini?.isVisible()) { persist(); mini.hide() }
    else open()
  }
  const onToggle = (event: IpcMainEvent): void => { if (trusted(event, main)) toggle() }
  const onPublish = (event: IpcMainEvent, next: MiniSnapshot): void => {
    if (!trusted(event, main)) return
    snapshot = next
    if (mini && !mini.isDestroyed()) mini.webContents.send(MINI_IPC.snapshot, next)
  }
  const onAction = (event: IpcMainEvent, value: unknown): void => {
    if (!trusted(event, mini) || !isMiniAction(value)) return
    if (value.kind === 'close') { persist(); mini?.hide(); return }
    if (value.kind === 'open' || value.kind === 'answer' || value.kind === 'review' || value.kind === 'send') {
      if (!snapshot?.sessions.some(s => s.paneId === value.paneId)) return
    }
    if (value.kind === 'open' || value.kind === 'new' || value.kind === 'review') showMain()
    host(MINI_IPC.action, value)
  }
  const onResize = (event: IpcMainEvent, height: unknown): void => {
    if (trusted(event, mini) && typeof height === 'number' && Number.isFinite(height)) resize(height)
  }
  ipcMain.on(MINI_IPC.toggle, onToggle)
  ipcMain.on(MINI_IPC.publish, onPublish)
  ipcMain.on(MINI_IPC.action, onAction)
  ipcMain.on(MINI_IPC.resize, onResize)
  ipcMain.handle(MINI_IPC.get, event => trusted(event, mini) ? snapshot : null)
  ipcMain.handle(MINI_IPC.plans, (event, requests: unknown) => {
    if (!trusted(event, main) || !mini?.isVisible() || !Array.isArray(requests)) return {}
    if (!requests.every((r): r is MiniPlanRequest => !!r && typeof r === 'object' && typeof r.paneId === 'string' &&
      (r.agent === 'claude' || r.agent === 'codex') && typeof r.sessionId === 'string' && typeof r.folder === 'string')) return {}
    return plans.read(requests.slice(0, MAX_PLAN_REQUESTS))
  })
  const minimize = (): void => { if (settings.get().miniWindow.showOnMinimize) open() }
  main.on('minimize', minimize)
  // A hidden Mini window must not keep the app alive after its main window closes.
  main.once('closed', () => app.quit())
  tray.on('click', toggle)
  updateMenu()
  // The taskbar jump list's Mini window entry, and the tray tooltip saying how many sessions wait for you.
  setMiniWindowLaunchHandler(open)
  const stopAttention = onAttentionCount((count) => {
    if (!tray.isDestroyed()) tray.setToolTip(count > 0 ? `Dawsha, ${count} waiting for you` : 'Dawsha')
  })
  return () => {
    if (stopping) return
    persist()
    stopping = true
    clearTimeout(persistTimer)
    main.removeListener('minimize', minimize)
    ipcMain.removeListener(MINI_IPC.toggle, onToggle)
    ipcMain.removeListener(MINI_IPC.publish, onPublish)
    ipcMain.removeListener(MINI_IPC.action, onAction)
    ipcMain.removeListener(MINI_IPC.resize, onResize)
    ipcMain.removeHandler(MINI_IPC.get)
    ipcMain.removeHandler(MINI_IPC.plans)
    stopAttention()
    setMiniWindowLaunchHandler(() => undefined)
    plans.clear()
    mini?.destroy()
    mini = null
    tray.destroy()
  }
}
