import { closePane, focusPane, movePane } from '../actions'
import type { PaneView } from '../derive'
import { clear, h, iconButton } from '../dom'
import { enableDrag } from '../drag'
import { ICONS } from '../icons'
import { sessionNote } from '../sessionNotes'
import { parsePlanLabel } from '../../shared/planProgress'
import { SESSION_STATE_LABELS, sessionState } from '../../shared/sessionState'
import { dropSlot, isNoMove, slotToIndex } from '../../shared/tabDrag'
import type { AppState } from '../state'
import { crewSignature, identityMark } from './crewAvatar'
import './sessionTabs.css'

const DRAG_REACH_Y = 40

/** The strip of session tabs above one session: in the focus view and the Side panel layout. Drag a tab to reorder. */
export class SessionTabs {
  readonly el = h('div', { class: 'pane-strip', role: 'tablist', 'aria-label': 'Sessions' })
  private readonly line = h('i', { class: 'strip-drop', 'aria-hidden': 'true', hidden: true })
  private signature = ''

  constructor() {
    this.el.hidden = true
  }

  update(views: PaneView[], state: AppState, shown: boolean, selectedId: string | null): void {
    this.el.hidden = !shown
    if (!shown) return
    const signature = JSON.stringify([views.map((v) => [v.pane.id, v.title, v.fullTitle, v.status, v.agent, v.attention, crewSignature(v), sessionNote(v.pane.id).plan]), selectedId])
    if (signature === this.signature || document.body.classList.contains('dragging-ui')) return
    this.signature = signature
    clear(this.el)
    for (const view of views) this.el.append(this.tab(view, view.pane.id === selectedId, views))
    this.el.append(this.line)
    this.el.querySelector('.strip-tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private tab(view: PaneView, selected: boolean, views: PaneView[]): HTMLElement {
    const name = view.title
    const stateName = sessionState({ status: view.status, attention: view.attention })
    const stateLabel = SESSION_STATE_LABELS[stateName]
    const plan = parsePlanLabel(sessionNote(view.pane.id).plan)
    const label = h(
      'button',
      {
        class: 'strip-label',
        type: 'button',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        title: `${name}, ${stateLabel}${plan ? `, plan ${plan.done} of ${plan.total}` : ''}${view.fullTitle && view.fullTitle !== name ? `\n${view.fullTitle}` : ''}`,
        onClick: () => focusPane(view.pane.id)
      },
      h('span', { class: 'strip-index' }, `${view.index + 1}`),
      identityMark(view, 18),
      h('bdi', { class: 'strip-name', dir: 'auto' }, name),
      h('span', { class: `strip-status state-${stateName}` }, stateLabel),
      selected && plan ? h('span', { class: 'strip-plan', 'aria-hidden': 'true' }, `${plan.done}/${plan.total}`) : null
    )
    const close = iconButton(`Close ${name}`, ICONS.closeSmall, () => void closePane(view.pane.id), 'strip-close')
    const tab = h(
      'div',
      { class: `strip-tab${selected ? ' selected' : ''}`, 'data-pane-id': view.pane.id },
      label,
      close,
      selected && plan ? h('span', { class: 'strip-bar', 'aria-hidden': 'true' }, h('i', { style: `width: ${plan.percent}%` })) : null
    )
    this.enableReorder(tab, view.pane.id, views)
    return tab
  }

  private tabs(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('.strip-tab'))
  }

  private enableReorder(tab: HTMLElement, paneId: string, views: PaneView[]): void {
    enableDrag<HTMLElement>(tab, {
      ignore: '.strip-close',
      targetAt: (x, y) => {
        const bounds = this.el.getBoundingClientRect()
        if (y < bounds.top - DRAG_REACH_Y || y > bounds.bottom + DRAG_REACH_Y) return null
        const tabs = this.tabs()
        const from = views.findIndex((view) => view.pane.id === paneId)
        const slot = dropSlot(tabs.map((el) => el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2), x)
        if (isNoMove(from, slot)) return null
        return tabs[slot] ?? this.el
      },
      mark: (target) => this.mark(target),
      drop: (target) => {
        const tabs = this.tabs()
        const from = views.findIndex((view) => view.pane.id === paneId)
        const slot = target === this.el ? tabs.length : tabs.indexOf(target)
        if (slot < 0 || isNoMove(from, slot)) return
        movePane(paneId, slotToIndex(from, slot), false)
      }
    })
  }

  private mark(target: HTMLElement | null): void {
    if (!target) {
      this.line.hidden = true
      return
    }
    const track = this.el.getBoundingClientRect()
    const edge = target === this.el ? this.tabs().at(-1)?.getBoundingClientRect().right : target.getBoundingClientRect().left
    const gap = target === this.el ? 1 : -1
    this.line.style.left = `${(edge ?? track.left) - track.left + this.el.scrollLeft + gap}px`
    this.line.hidden = false
  }
}
