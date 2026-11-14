import { CLEAR_SLASH, COMPACT_SLASH, clearConfirm, contextReading } from '../../shared/chatContext'
import { contextSegments, contextUsedLine, contextWindowLine } from '../../shared/contextRing'
import { outputsSignature, sessionOutputs, type SessionOutput } from '../../shared/sessionOutputs'
import { api } from '../api'
import { primaryTab, sendChatMessage } from '../chat/chatActions'
import type { PaneView } from '../derive'
import { h, icon } from '../dom'
import { fileIcon } from '../files/fileIcon'
import { openInFiles } from '../files/filesActions'
import { ICONS } from '../icons'
import { folderOfPane, store } from '../state'
import { timelineRequest } from '../timelineActions'
import { openContextMenu } from './contextMenu'
import { confirmDialog } from './dialogs'
import { toast } from './toast'
import './sessionPanel.css'

const REFRESH_MS = 3000
const EMPTY_OUTPUTS = 'Files this session writes show up here.'
const NO_CONTEXT = 'Send a message to see context usage.'

/** The Session tab of the side panel: how full the context is, and the files this session wrote. */
export class SessionPanel {
  readonly el = h('div', { class: 'session-panel' })
  private readonly contextBody = h('div', { class: 'session-context' })
  private readonly outputsBody = h('div', { class: 'session-outputs' })
  private view: PaneView | null = null
  private outputs: SessionOutput[] = []
  private outputsKey = ''
  private contextKey = ''
  private version: string | undefined
  private paneId = ''
  private requestKey = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private token = 0
  private loaded = false

  constructor() {
    this.el.append(
      h('section', { class: 'session-section', 'aria-label': 'Context' }, h('h3', { class: 'session-heading' }, 'Context'), this.contextBody),
      h('section', { class: 'session-section', 'aria-label': 'Outputs' }, h('h3', { class: 'session-heading' }, 'Outputs'), this.outputsBody)
    )
  }

  /** Called on every state change while the tab is on screen; starts the log polling the first time. */
  show(view: PaneView): void {
    this.view = view
    const requestKey = JSON.stringify(timelineRequest(view.pane.id))
    if (view.pane.id !== this.paneId || requestKey !== this.requestKey) {
      this.paneId = view.pane.id
      this.requestKey = requestKey
      this.version = undefined
      this.outputs = []
      this.outputsKey = ''
      this.loaded = false
      this.drawOutputs()
      void this.refresh()
    }
    if (!this.timer) this.timer = setInterval(() => void this.refresh(), REFRESH_MS)
    this.drawContext(view)
  }

  hide(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.token += 1
    this.paneId = ''
    this.requestKey = ''
    this.view = null
    this.contextKey = ''
  }

  private folder(): string | null {
    const view = this.view
    return view ? folderOfPane(store.state, view.pane) : null
  }

  private async refresh(): Promise<void> {
    const paneId = this.paneId
    const request = paneId ? timelineRequest(paneId) : null
    const folder = this.folder()
    if (!request || !folder) {
      this.loaded = true
      this.outputs = []
      this.drawOutputs()
      return
    }
    const token = ++this.token
    const result = await api.sessionTimeline({ ...request, version: this.version }).catch(() => null)
    if (token !== this.token || paneId !== this.paneId) return
    this.loaded = true
    if (result?.status === 'ok') {
      this.version = result.version
      this.outputs = sessionOutputs(result.events, folder)
    } else if (result?.status === 'no-session') this.outputs = []
    this.drawOutputs()
  }

  private drawContext(view: PaneView): void {
    const reading = contextReading({ agent: view.agent, percent: view.info.contextPercent, tokens: view.info.contextTokens, window: view.info.contextWindow })
    const key = JSON.stringify([reading, view.title])
    if (key === this.contextKey) return
    this.contextKey = key
    const actions = h(
      'div',
      { class: 'session-actions' },
      h('button', { class: 'btn small', type: 'button', onClick: () => this.command(COMPACT_SLASH) }, 'Compact'),
      h('button', { class: 'btn small', type: 'button', onClick: () => void this.clear() }, 'Clear')
    )
    if (!reading) {
      this.contextBody.replaceChildren(h('p', { class: 'session-quiet' }, NO_CONTEXT), actions)
      return
    }
    const segments = contextSegments(reading)
    const windowLine = contextWindowLine(reading)
    this.contextBody.replaceChildren(
      h('div', { class: 'ctx-pop-bar session-bar', role: 'img', 'aria-label': contextUsedLine(reading) }, ...segments.map((s) => h('i', { class: `ctx-seg ctx-seg-${s.key}`, style: `width:${s.percent}%` }))),
      h('p', { class: 'session-line' }, contextUsedLine(reading)),
      ...(windowLine ? [h('p', { class: 'session-quiet' }, windowLine)] : []),
      actions
    )
  }

  private command(text: string): void {
    const view = this.view
    const tab = view ? primaryTab(view) : null
    if (tab && tab.status !== 'exited') sendChatMessage(tab.id, tab.agent, text)
  }

  private async clear(): Promise<void> {
    const name = this.view?.title || 'this session'
    if (await confirmDialog({ ...clearConfirm(name), danger: true })) this.command(CLEAR_SLASH)
  }

  private drawOutputs(): void {
    const key = outputsSignature(this.outputs) + (this.loaded ? '!' : '')
    if (key === this.outputsKey && this.outputsBody.childElementCount > 0) return
    this.outputsKey = key
    if (this.outputs.length === 0) {
      this.outputsBody.replaceChildren(h('p', { class: 'session-quiet' }, this.loaded ? EMPTY_OUTPUTS : 'Reading the session log.'))
      return
    }
    this.outputsBody.replaceChildren(h('ul', { class: 'session-list' }, ...this.outputs.map((output) => this.row(output))))
  }

  private row(output: SessionOutput): HTMLElement {
    const open = (): void => this.open(output)
    const main = h(
      'button',
      { class: 'session-output', type: 'button', 'data-output': output.path, title: output.path, disabled: !output.inProject, onClick: open },
      fileIcon(output.path),
      h('span', { class: 'session-output-text' }, h('span', { class: 'session-output-name', dir: 'auto' }, output.name), output.folder ? h('span', { class: 'session-output-folder', dir: 'auto' }, output.folder) : null),
      h('span', { class: 'session-output-kind' }, output.kind)
    )
    const more = h('button', { class: 'icon-btn small session-output-more', type: 'button', 'aria-label': `Actions for ${output.name}`, title: 'More', disabled: !output.inProject }, icon(ICONS.more))
    const menu = (x: number, y: number, anchor?: DOMRect): void => {
      openContextMenu({
        x,
        y,
        label: output.name,
        anchor,
        returnFocus: more,
        entries: [
          { label: 'Open in Files', run: open },
          { label: 'Reveal in File Explorer', run: () => this.reveal(output) }
        ]
      })
    }
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect()
      menu(rect.left, rect.bottom, rect)
    })
    const li = h('li', { class: 'session-row' }, main, more)
    if (output.inProject) li.addEventListener('contextmenu', (event) => { event.preventDefault(); menu(event.clientX, event.clientY) })
    return li
  }

  private open(output: SessionOutput): void {
    const view = this.view
    const folder = this.folder()
    if (view && folder) openInFiles({ projectId: view.pane.projectId, folder }, output.path)
  }

  private reveal(output: SessionOutput): void {
    const folder = this.folder()
    if (!folder) return
    void api.revealProjectPath(folder, output.path).then((result) => {
      if (!result.ok) toast('Could not show that file. It may have been moved or deleted.')
    })
  }
}
