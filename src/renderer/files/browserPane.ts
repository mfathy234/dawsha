import { api } from '../api'
import { CLOSED_BROWSER, errorsMessage, parseBrowserAddress, screenshotMessage, type BrowserBounds, type BrowserState } from '../../shared/browserPane'
import { toast } from '../components/toast'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import type { PanelExtra } from './bottomPanel'
import './filesTools.css'
import { elementMessage, type BrowserPick } from '../../shared/browserPick'

export interface BrowserHooks {
  /** Put text in an agent's prompt without sending it; the anchor places the session menu. */
  send(text: string, anchor: HTMLElement): void
  sessions(): Array<{ paneId: string; title: string }>
  sendElement(paneId: string, text: string, imagePath: string): boolean
}

const svg = (body: string): string => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const DEVTOOLS = svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>')
const CAMERA = svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>')
const INSET = 12

const sameBox = (a: BrowserBounds, b: BrowserBounds): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** The Browser tab: a page from a local dev server or any http(s) site, drawn by a native view that sits over this tab's stage. */
export class BrowserTab implements PanelExtra {
  readonly id = 'browser'
  readonly label = 'Browser'
  readonly el = h('div', { class: 'files-browser', id: 'files-browser', role: 'tabpanel', hidden: true })
  private state: BrowserState = CLOSED_BROWSER
  private active = false
  private frame = 0
  private lastBox: BrowserBounds | null = null
  private lastVisible = false
  private picking = false
  private pickRequest = 0
  private captured: Extract<BrowserPick, { ok: true }> | null = null
  private readonly picked = h('span', { class: 'files-browser-picked', id: 'files-browser-picked', dir: 'auto' })
  private readonly preview = h('img', { class: 'files-browser-pick-preview', id: 'files-browser-pick-preview', alt: 'Picked element', draggable: false })
  private readonly note = h('textarea', { class: 'files-tool-input', id: 'files-browser-pick-note', rows: 2, dir: 'auto', 'aria-label': 'Note about this element', placeholder: 'What should change?', maxlength: 8000 })
  private readonly session = h('select', { class: 'files-tool-select', id: 'files-browser-pick-session', 'aria-label': 'Send to session' })
  private readonly sendPick = h('button', { class: 'btn primary small', type: 'button', id: 'files-browser-pick-send', onClick: () => this.submitPick() }, 'Send to session')
  private readonly composer = h('div', { class: 'files-browser-pick-composer', id: 'files-browser-pick-composer', hidden: true, role: 'group', 'aria-label': 'Send picked element' },
    this.preview,
    h('div', { class: 'files-browser-pick-body' }, this.picked, this.note,
      h('div', { class: 'files-browser-pick-actions' }, this.session, this.sendPick, h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.dismissPick() }, 'Cancel'))))
  private readonly stage = h('div', { class: 'files-browser-stage', id: 'files-browser-stage' },
    h('p', { class: 'files-browser-hint', id: 'files-browser-hint' }, 'Type an address above, for example localhost:5173, to preview your running app here.'))
  private readonly address = h('input', { class: 'files-tool-input files-browser-address', id: 'files-browser-address', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address', placeholder: 'localhost:5173' })
  private readonly problem = h('p', { class: 'files-tool-problem files-browser-problem', id: 'files-browser-problem', role: 'status' })
  private readonly back = this.tool('files-browser-back', 'Back', ICONS.prev, () => void this.run({ type: 'back' }))
  private readonly forward = this.tool('files-browser-forward', 'Forward', ICONS.next, () => void this.run({ type: 'forward' }))
  private readonly reload = this.tool('files-browser-reload', 'Reload', ICONS.refresh, () => void this.run({ type: 'reload' }))
  private readonly devtools = this.tool('files-browser-devtools', 'Open developer tools', DEVTOOLS, () => void this.run({ type: 'devtools' }))
  private readonly shot = this.tool('files-browser-shot', 'Send a screenshot to an agent', CAMERA, (event) => void this.sendShot(event.currentTarget as HTMLElement))
  private readonly pick = h('button', { class: 'btn ghost small', type: 'button', id: 'files-browser-pick', 'aria-pressed': 'false', onClick: () => this.picking ? this.cancelPick() : void this.startPick() }, 'Pick element')
  private readonly errors = h('button', { class: 'btn ghost small', type: 'button', id: 'files-browser-errors', onClick: (event: Event) => void this.sendErrors(event.currentTarget as HTMLElement) }, 'Send errors')
  private readonly close = this.tool('files-browser-close', 'Close the browser', ICONS.close, () => void this.shut())

  constructor(private readonly hooks: BrowserHooks) {
    this.address.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.go()
    })
    this.el.append(
      h('div', { class: 'files-browser-bar' }, this.back, this.forward, this.reload, this.address, this.pick, this.devtools, this.shot, this.errors, this.close),
      this.problem, this.composer, this.stage)
    this.note.addEventListener('input', () => { this.sendPick.disabled = this.note.value.trim() === '' || this.session.options.length === 0 })
    this.composer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); this.dismissPick() } })
    this.el.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.picking) { event.stopPropagation(); this.cancelPick() } })
    api.tools.onBrowserState((state) => this.apply(state))
    this.apply(CLOSED_BROWSER)
  }

  private tool(id: string, label: string, svgText: string, onClick: (event: Event) => void): HTMLButtonElement {
    return h('button', { class: 'icon-btn', type: 'button', id, 'aria-label': label, title: label, onClick }, icon(svgText))
  }

  activate(active: boolean): void {
    this.active = active
    if (!active) {
      this.cancelPick()
      this.stop()
      this.report(false)
      return
    }
    this.watch()
    window.setTimeout(() => this.address.focus(), 0)
  }

  private watch(): void {
    if (this.frame !== 0) return
    const tick = (): void => {
      this.frame = 0
      if (!this.active) return
      this.report(true)
      this.frame = window.requestAnimationFrame(tick)
    }
    this.frame = window.requestAnimationFrame(tick)
  }

  private stop(): void {
    window.cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private box(): BrowserBounds {
    const rect = this.stage.getBoundingClientRect()
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }

  /** True when something in the page sits over the stage; a native view would draw above it, so the view steps aside. */
  private covered(box: BrowserBounds): boolean {
    if (box.width < 2 * INSET || box.height < 2 * INSET) return false
    const points: Array<[number, number]> = [
      [box.x + box.width / 2, box.y + box.height / 2],
      [box.x + INSET, box.y + INSET], [box.x + box.width - INSET, box.y + INSET],
      [box.x + INSET, box.y + box.height - INSET], [box.x + box.width - INSET, box.y + box.height - INSET]
    ]
    return points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && !this.stage.contains(hit)
    })
  }

  private report(visible: boolean): void {
    if (!this.state.open) return
    const box = this.box()
    const hidden = !visible || !this.state.url || this.el.hidden || box.width === 0 || this.covered(box)
    this.stage.dataset.covered = String(visible && this.state.url !== '' && hidden)
    if (this.lastBox && sameBox(this.lastBox, box) && this.lastVisible === !hidden) return
    this.lastBox = box
    this.lastVisible = !hidden
    void api.tools.browser({ type: 'bounds', bounds: box, visible: !hidden })
  }

  private apply(state: BrowserState): void {
    if (state.url !== this.state.url || state.loading || !state.open) {
      this.cancelPick()
      this.dismissPick()
    }
    this.state = state
    if (document.activeElement !== this.address) this.address.value = state.url
    this.back.disabled = !state.canGoBack
    this.forward.disabled = !state.canGoForward
    for (const control of [this.reload, this.devtools, this.shot, this.close]) control.disabled = !state.open
    this.pick.disabled = !state.open || !state.url || state.loading
    this.errors.disabled = !state.open || state.errorCount === 0
    this.errors.textContent = state.errorCount > 0 ? `Send ${state.errorCount} error${state.errorCount === 1 ? '' : 's'}` : 'Send errors'
    this.reload.classList.toggle('busy', state.loading)
    this.problem.textContent = state.failure ?? ''
    this.stage.classList.toggle('empty', !state.url)
    this.stage.dataset.title = state.title
    this.lastBox = null
    if (this.active) this.report(true)
  }

  private async go(): Promise<void> {
    const parsed = parseBrowserAddress(this.address.value)
    this.problem.textContent = parsed.ok ? '' : parsed.error
    if (!parsed.ok) return
    const opened = this.state.open ? await api.tools.browser({ type: 'navigate', url: parsed.url }) : await api.tools.browser({ type: 'open', url: parsed.url })
    if (!opened.ok) {
      this.problem.textContent = opened.error
      return
    }
    this.address.value = parsed.url
    this.apply(opened.state)
  }

  private async run(command: { type: 'back' | 'forward' | 'reload' | 'devtools' }): Promise<void> {
    const result = await api.tools.browser(command)
    if (!result.ok) this.problem.textContent = result.error
  }

  private async shut(): Promise<void> {
    const result = await api.tools.browser({ type: 'close' })
    this.lastBox = null
    this.apply(result.ok ? result.state : CLOSED_BROWSER)
    this.address.value = ''
  }

  private async sendShot(anchor: HTMLElement): Promise<void> {
    const result = await api.tools.browserShot()
    if (!result.ok) {
      toast(result.error, 'info')
      return
    }
    this.hooks.send(screenshotMessage(result.path, result.url), anchor)
  }

  private async sendErrors(anchor: HTMLElement): Promise<void> {
    const result = await api.tools.browserErrors()
    if (!result.ok) {
      toast(result.error, 'info')
      return
    }
    this.hooks.send(errorsMessage(result.url, result.lines), anchor)
  }

  private setPicking(picking: boolean): void {
    this.picking = picking
    this.pick.setAttribute('aria-pressed', String(picking))
    this.pick.textContent = picking ? 'Cancel pick' : 'Pick element'
    this.pick.setAttribute('aria-label', picking ? 'Cancel pick' : 'Pick element')
    this.problem.textContent = picking ? 'Click an element, or use Tab and Enter. Esc cancels.' : ''
  }

  private cancelPick(): void {
    if (!this.picking) return
    this.pickRequest += 1
    this.setPicking(false)
    void api.tools.browser({ type: 'cancel-pick' })
  }

  private dismissPick(): void {
    this.captured = null
    this.composer.hidden = true
    this.preview.removeAttribute('src')
    this.note.value = ''
  }

  private async startPick(): Promise<void> {
    this.dismissPick()
    const request = ++this.pickRequest
    this.setPicking(true)
    const result = await api.tools.browserPick().catch((): BrowserPick => ({ ok: false, error: 'Could not pick that element. Try again.' }))
    if (request !== this.pickRequest) return
    this.setPicking(false)
    if (!result.ok) {
      if (!result.cancelled) this.problem.textContent = result.error
      this.pick.focus()
      return
    }
    if (result.url !== this.state.url || !this.active) return
    this.captured = result
    this.picked.textContent = `${result.element.selector}${result.element.name ? ` (${result.element.name})` : ''}`
    this.picked.title = elementMessage(result.url, result.element, '')
    this.preview.src = result.preview
    this.session.replaceChildren(...this.hooks.sessions().map((session) => h('option', { value: session.paneId, dir: 'auto' }, session.title)))
    this.sendPick.disabled = true
    this.note.placeholder = this.session.options.length ? 'What should change?' : 'Open a session to send this element.'
    this.composer.hidden = false
    this.note.focus()
  }

  private submitPick(): void {
    const captured = this.captured
    if (!captured || !this.note.value.trim() || !this.session.value) return
    if (this.hooks.sendElement(this.session.value, elementMessage(captured.url, captured.element, this.note.value), captured.path)) {
      this.dismissPick()
      toast('Sent the element and screenshot to the session.', 'info')
    }
  }
}
