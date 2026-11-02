import { backgroundSummary, elapsedLabel, type BackgroundStatus, type BackgroundTask } from '../../shared/chatBackground'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { markdownCard } from './chatCards'
import './chatBackground.css'

const TICK_MS = 1000

export const BACKGROUND_STATUS_TEXT: Record<BackgroundStatus, string> = {
  running: CHAT_TEXT.backgroundRunning,
  done: CHAT_TEXT.backgroundDone,
  failed: CHAT_TEXT.backgroundFailed,
  stopped: CHAT_TEXT.backgroundStopped
}

export function backgroundStatusIcon(status: BackgroundStatus): HTMLElement {
  const svg = status === 'running' ? ICONS.toolRunning : status === 'done' ? ICONS.check : status === 'failed' ? ICONS.close : ICONS.toolOther
  return icon(svg)
}

export interface BackgroundHost {
  /** Scrolls to the launch row in the thread and opens its report. False when that row is no longer in the thread. */
  reveal(task: BackgroundTask): boolean
}

/** The strip above the composer: a count of the session's background work, opening to a list of what it is and how it is going. */
export class BackgroundStrip {
  readonly el = h('div', { class: 'chat-bg', hidden: true })
  private tasks: readonly BackgroundTask[] = []
  private expanded = false
  private readonly inline = new Set<string>()
  private timer = 0

  constructor(private readonly host: BackgroundHost) {}

  update(tasks: readonly BackgroundTask[]): void {
    this.tasks = tasks
    this.el.hidden = tasks.length === 0
    this.draw()
    this.watch(tasks.some((task) => task.status === 'running'))
  }

  dispose(): void {
    this.watch(false)
    this.el.remove()
  }

  private draw(): void {
    if (this.tasks.length === 0) {
      this.el.replaceChildren()
      return
    }
    const running = this.tasks.some((task) => task.status === 'running')
    const head = h(
      'button',
      { class: `chat-bg-head${running ? ' running' : ''}`, type: 'button', 'aria-expanded': String(this.expanded), onClick: () => this.flip() },
      icon(running ? ICONS.toolRunning : this.expanded ? ICONS.chevronDown : ICONS.chevronRight),
      h('span', { class: 'chat-bg-label' }, CHAT_TEXT.backgroundLabel),
      h('span', { class: 'chat-bg-count' }, backgroundSummary(this.tasks))
    )
    const list = this.expanded ? h('div', { class: 'chat-bg-list', role: 'list' }, ...[...this.tasks].reverse().map((task) => this.row(task))) : null
    this.el.replaceChildren(...(list ? [head, list] : [head]))
  }

  private row(task: BackgroundTask): HTMLElement {
    const kindText = task.kind === 'agent' ? task.agentType || CHAT_TEXT.backgroundAgent : CHAT_TEXT.backgroundShell
    const button = h(
      'button',
      { class: `chat-bg-row ${task.status}`, type: 'button', 'data-bg': task.id, 'data-status': task.status, onClick: () => this.pick(task) },
      icon(task.kind === 'agent' ? ICONS.toolAgent : ICONS.toolShell),
      h('span', { class: 'chat-bg-title', dir: 'auto' }, task.title),
      h('span', { class: 'chat-bg-kind' }, kindText),
      h('span', { class: 'chat-bg-time', 'data-start': String(task.startedAt) }, this.elapsed(task)),
      h('span', { class: `chat-bg-status ${task.status}`, title: BACKGROUND_STATUS_TEXT[task.status] }, backgroundStatusIcon(task.status))
    )
    const detail = this.inline.has(task.id) ? h('div', { class: 'chat-bg-detail' }, markdownCard(task.resultPreview ?? task.summary ?? CHAT_TEXT.backgroundNoResult)) : null
    return h('div', { class: 'chat-bg-item', role: 'listitem' }, button, detail)
  }

  private pick(task: BackgroundTask): void {
    if (this.host.reveal(task)) return
    if (this.inline.has(task.id)) this.inline.delete(task.id)
    else this.inline.add(task.id)
    this.draw()
  }

  private flip(): void {
    this.expanded = !this.expanded
    this.draw()
  }

  private elapsed(task: BackgroundTask): string {
    if (task.startedAt === 0) return ''
    return elapsedLabel((task.finishedAt ?? Date.now()) - task.startedAt)
  }

  /** While anything runs, the clocks of the running rows move on their own. */
  private watch(on: boolean): void {
    if (on === (this.timer !== 0)) return
    if (on) this.timer = window.setInterval(() => this.tick(), TICK_MS)
    else {
      window.clearInterval(this.timer)
      this.timer = 0
    }
  }

  private tick(): void {
    const now = Date.now()
    this.el.querySelectorAll<HTMLElement>('.chat-bg-row.running .chat-bg-time').forEach((time) => {
      const start = Number(time.dataset.start)
      if (start > 0) time.textContent = elapsedLabel(now - start)
    })
  }
}
