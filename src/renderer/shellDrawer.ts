import { api } from './api'
import { h, iconButton } from './dom'
import { ICONS } from './icons'
import { store } from './state'
import { workFolderOfPane } from './derive'
import { disposeTerminal, ensureTerminal, getTerminal } from './terminals'
import { registerDrawer, terminalDirectory, terminalPane } from './terminalSession'
import { saveSettings, startSessionIn } from './actions'
import './shellDrawer.css'

const drawers = new Map<string, ShellDrawer>()
export const toggleShellDrawer = (paneId: string): void => { void drawers.get(paneId)?.toggle() }

export class ShellDrawer {
  readonly el = h('section', { class: 'shell-drawer', 'aria-label': 'Shell drawer', hidden: true })
  private readonly body = h('div', { class: 'shell-drawer-body' })
  private readonly folder = h('span', { class: 'shell-drawer-folder' })
  private readonly id = `drawer-${crypto.randomUUID()}`
  private started = false
  private starting = false
  private disposed = false
  private returnFocus: HTMLElement | null = null
  private readonly stopExit: () => void

  constructor(private readonly paneId: string) {
    drawers.set(paneId, this)
    registerDrawer(this.id, paneId)
    const handle = h('div', { class: 'shell-drawer-handle', role: 'separator', 'aria-label': 'Shell drawer height', 'aria-orientation': 'horizontal', tabindex: '0' })
    handle.addEventListener('pointerdown', (event) => this.drag(event, handle))
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      this.remember(this.el.clientHeight + (event.key === 'ArrowUp' ? 20 : -20))
    })
    const here = h('button', { class: 'btn ghost small', type: 'button', onClick: () => {
      const pane = terminalPane(this.id)
      const folder = terminalDirectory(this.id)
      if (pane && folder) void startSessionIn(pane.projectId, folder)
    } }, 'New session here')
    this.el.append(handle, h('div', { class: 'shell-drawer-head' }, h('span', {}, 'Shell'), this.folder, here,
      iconButton('Hide shell', ICONS.closeSmall, () => void this.toggle(), 'small')), this.body)
    this.stopExit = api.onExit((id) => {
      if (id !== this.id) return
      this.started = false
      getTerminal(this.id)?.writeLine('Shell exited. Hide and reopen to start it again.')
    })
  }

  async toggle(): Promise<void> {
    const hiding = !this.el.hidden
    if (!hiding) this.returnFocus = document.activeElement as HTMLElement | null
    this.el.hidden = hiding
    this.update()
    if (hiding) {
      if (this.returnFocus?.isConnected && !this.el.contains(this.returnFocus)) this.returnFocus.focus()
      else {
        const pane = terminalPane(this.id)
        if (pane) getTerminal(pane.activeTabId)?.focus()
      }
      return
    }
    const pane = terminalPane(this.id)
    const cwd = pane ? workFolderOfPane(store.state, pane) : null
    if (!pane || !cwd) return
    const terminal = ensureTerminal(this.id, pane.fontSize)
    terminal.mount(this.body)
    terminal.setVisible(true)
    terminal.focus()
    if (this.started || this.starting) return
    this.starting = true
    terminal.fitNow()
    try {
      const result = await api.spawn({ id: this.id, projectId: pane.projectId, agent: 'shell', cwd, resume: false, cols: terminal.cols, rows: terminal.rows })
      if (this.disposed) { void api.kill(this.id); return }
      this.started = result.ok
      if (!result.ok) terminal.writeLine(result.error)
    } finally { this.starting = false }
  }

  update(): void {
    this.el.style.height = `${store.state.settings.shellDrawerHeight}px`
    this.folder.textContent = terminalDirectory(this.id) ?? ''
    this.folder.title = this.folder.textContent
    const terminal = getTerminal(this.id)
    const pane = terminalPane(this.id)
    if (terminal && pane) { terminal.setFontSize(pane.fontSize); terminal.setVisible(!this.el.hidden) }
  }

  private remember(value: number): void {
    const height = Math.round(Math.min(600, Math.max(120, value)))
    store.set((state) => ({ ...state, settings: { ...state.settings, shellDrawerHeight: height } }))
    void saveSettings({ shellDrawerHeight: height })
    this.update()
  }

  private drag(event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startHeight = this.el.clientHeight
    const move = (next: PointerEvent): void => { this.el.style.height = `${Math.min(600, Math.max(120, startHeight + startY - next.clientY))}px` }
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      this.remember(this.el.clientHeight)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  dispose(): void {
    this.disposed = true
    this.stopExit()
    drawers.delete(this.paneId)
    void api.kill(this.id)
    disposeTerminal(this.id)
    this.el.remove()
  }
}
