import { openChanges, permissionTail } from '../actions'
import { answerFromCard, markReviewed, openPeek } from '../boardActions'
import type { PaneView } from '../derive'
import { h } from '../dom'
import { replayPane } from '../replayActions'
import { timeInState } from '../stateClock'
import { openTimeline } from '../timelineActions'
import { getTerminal } from '../terminals'
import { permissionPromptText } from '../../shared/permissionPrompt'
import { SESSION_STATE_LABELS, type SessionState } from '../../shared/sessionState'
import { lastLines } from '../../shared/topbarSummary'
import type { BoardColumn } from '../../shared/board'
import { agentMark } from './agentMark'
import { tagChip } from './sessionTagUi'

const PREVIEW_LINES = 2
const WAITING_TEXT = 'Waiting for your permission'

export interface BoardEntry {
  view: PaneView
  state: SessionState
}

export interface DragSource {
  paneId: string
  column: BoardColumn
}

export const drag: { source: DragSource | null } = { source: null }

const stop = (run: () => void) => (event: Event) => {
  event.stopPropagation()
  run()
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function resultTag(view: PaneView): { text: string; ok: boolean } | null {
  const test = view.snapshot?.checks.find((check) => check.kind === 'test')
  if (!test) return null
  return { text: test.ok ? 'Tests passed' : 'Tests failed', ok: test.ok }
}

function changesText(view: PaneView): string {
  const changes = view.info.changes
  if (!changes || changes.files === 0) return ''
  return `+${changes.added} −${changes.removed} · ${changes.files} file${changes.files === 1 ? '' : 's'}`
}

/** One session card. Built once per pane and updated in place; only a change of column rebuilds its body. */
export class BoardCard {
  readonly el: HTMLElement
  private column: BoardColumn | null = null
  private readonly mark = h('span', { class: 'board-card-mark' })
  private readonly title = h('b', { class: 'board-card-title', dir: 'auto' })
  private readonly time = h('span', { class: 'board-card-time' })
  private readonly tag = h('span', { class: 'board-card-tag', hidden: true })
  private tagShown = ''
  private readonly meta = h('div', { class: 'board-card-meta' })
  private readonly body = h('div', { class: 'board-card-body' })
  private readonly actions = h('div', { class: 'board-card-actions' })
  private agent = ''
  private prompt: HTMLElement | null = null
  private preview: HTMLElement | null = null
  private changes: HTMLElement | null = null
  private result: HTMLElement | null = null
  private view: PaneView

  constructor(entry: BoardEntry) {
    this.view = entry.view
    const paneId = entry.view.pane.id
    this.el = h(
      'article',
      { class: 'board-card', tabindex: '0', 'data-pane-id': paneId },
      h('div', { class: 'board-card-head' }, this.mark, this.title, this.tag, this.time),
      this.meta,
      this.body,
      this.actions
    )
    this.el.addEventListener('click', () => openPeek(paneId))
    this.el.addEventListener('dragstart', (event) => {
      if (this.column !== 'done') return event.preventDefault()
      drag.source = { paneId, column: 'done' }
      event.dataTransfer?.setData('text/plain', paneId)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      this.el.classList.add('dragging')
    })
    this.el.addEventListener('dragend', () => {
      drag.source = null
      this.el.classList.remove('dragging')
    })
  }

  update(entry: BoardEntry, column: BoardColumn): void {
    const { view, state } = entry
    this.view = view
    if (column !== this.column) this.rebuild(column)
    if (this.agent !== view.agent) {
      this.agent = view.agent
      this.mark.replaceChildren(...[agentMark(view.agent)].filter((node): node is HTMLElement => node !== null))
    }
    const project = view.project?.name ?? 'project'
    setText(this.title, view.title)
    this.showTag(view.tag)
    this.title.title = view.title
    setText(this.meta, view.branch ? `${project} · ${view.branch}` : project)
    setText(this.time, column === 'reviewed' ? SESSION_STATE_LABELS[state].toLowerCase() : timeInState(view.pane.id, state, view.now))
    this.el.setAttribute('aria-label', `${view.title}, ${project}, ${SESSION_STATE_LABELS[state]}`)
    this.el.setAttribute('data-state', state)
    this.el.classList.toggle('attention', column === 'needs')
    this.refresh(column)
  }

  private showTag(tag: PaneView['tag']): void {
    if ((tag ?? '') === this.tagShown) return
    this.tagShown = tag ?? ''
    this.tag.hidden = tag === null
    this.tag.replaceChildren(...(tag ? [tagChip(tag, true)] : []))
  }

  refreshPreview(): void {
    if (!this.preview) return
    const lines = lastLines(getTerminal(this.view.primaryTabId)?.tailText(PREVIEW_LINES * 6) ?? '', PREVIEW_LINES)
    const text = lines.join('\n')
    if (this.preview.textContent !== text) this.preview.textContent = text
  }

  private refresh(column: BoardColumn): void {
    if (column === 'needs' && this.prompt) {
      setText(this.prompt, permissionPromptText(permissionTail(this.view.pane.id)) || WAITING_TEXT)
    } else if (column === 'working') {
      this.refreshPreview()
    } else if (column === 'done') {
      this.refreshDone()
    }
  }

  private refreshDone(): void {
    const changes = changesText(this.view)
    if (this.changes) {
      setText(this.changes, changes)
      this.changes.hidden = changes === ''
    }
    const result = resultTag(this.view)
    if (this.result) {
      setText(this.result, result?.text ?? '')
      this.result.hidden = result === null
      this.result.classList.toggle('failed', result !== null && !result.ok)
    }
  }

  private rebuild(column: BoardColumn): void {
    this.column = column
    this.prompt = this.preview = this.changes = this.result = null
    const paneId = this.view.pane.id
    const name = `${this.view.title} in ${this.view.project?.name ?? 'project'}`
    this.el.className = `board-card board-card-${column}`
    this.el.draggable = column === 'done'
    this.body.replaceChildren()
    this.actions.replaceChildren()
    if (column === 'needs') {
      this.prompt = h('pre', { class: 'board-card-prompt' })
      this.body.append(this.prompt)
      this.actions.append(
        h('button', { class: 'btn small primary', type: 'button', 'aria-label': `Allow for ${name}`, onClick: stop(() => answerFromCard(paneId, true)) }, 'Allow'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Deny for ${name}`, onClick: stop(() => answerFromCard(paneId, false)) }, 'Deny'),
        h('span', { class: 'board-spacer' }),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Open ${name}`, onClick: stop(() => openPeek(paneId)) }, 'Open')
      )
    } else if (column === 'working') {
      this.preview = h('pre', { class: 'board-card-preview', 'aria-hidden': 'true' })
      this.body.append(this.preview)
    } else if (column === 'done') {
      this.changes = h('span', { class: 'board-tag mono' })
      this.result = h('span', { class: 'board-tag result' })
      this.body.append(h('div', { class: 'board-tags' }, this.changes, this.result))
      this.actions.append(
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Changes in ${name}`, onClick: stop(() => void openChanges(paneId)) }, 'Changes'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Timeline of ${name}`, onClick: stop(() => openTimeline(paneId)) }, 'Timeline'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Replay ${name}`, onClick: stop(() => void replayPane(paneId)) }, 'Replay'),
        h('span', { class: 'board-spacer' }),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Mark ${name} reviewed`, onClick: stop(() => markReviewed(paneId)) }, 'Mark reviewed')
      )
    }
    this.body.hidden = column === 'reviewed'
    this.actions.hidden = column === 'reviewed' || column === 'working'
    this.meta.hidden = column === 'reviewed'
  }
}
