import { closePane, focusPane, movePane, toggleStarred } from '../actions'
import type { PaneView } from '../derive'
import { clear, h, icon, iconButton } from '../dom'
import { enableDrag } from '../drag'
import { ICONS } from '../icons'
import { sessionNote } from '../sessionNotes'
import { parsePlanLabel } from '../../shared/planProgress'
import { SESSION_STATE_LABELS, sessionState, type SessionState } from '../../shared/sessionState'
import { showsTabPlan, tabNameStrong, tabStatus } from '../../shared/tabStatus'
import { overflowLabel, overflowOrder, tabsOutOfView } from '../../shared/tabOverflow'
import { stateSince } from '../stateClock'
import { isUnread } from '../unread'
import { dropSlot, isNoMove, slotToIndex } from '../../shared/tabDrag'
import { isStarred } from '../../shared/starred'
import { monogram } from '../../shared/sidebarModel'
import type { AppState } from '../state'
import { openContextMenu, type ContextItem } from './contextMenu'
import { crewSignature, identityMark } from './crewAvatar'
import './sessionTabs.css'

const DRAG_REACH_Y = 40

/** The strip of session tabs above one session: in the focus view and the Side panel layout. Drag a tab to reorder. */
export class SessionTabs {
  readonly el = h('div', { class: 'pane-strip', role: 'tablist', 'aria-label': 'Sessions' })
  private readonly line = h('i', { class: 'strip-drop', 'aria-hidden': 'true', hidden: true })
  /** Opens the list of tabs that do not fit; it sits at the end of the strip. */
  private readonly more = h('button', { class: 'strip-more', type: 'button', 'aria-haspopup': 'menu', hidden: true, onClick: () => this.openMore() })
  private signature = ''
  private needing = new Set<string>()
  private hidden: { id: string; name: string; state: SessionState; detail: string }[] = []
  private entries: { id: string; name: string; state: SessionState; detail: string }[] = []

  constructor() {
    this.el.hidden = true
    this.el.addEventListener('scroll', () => this.syncOverflow(), { passive: true })
    new ResizeObserver(() => this.syncOverflow()).observe(this.el)
  }

  update(views: PaneView[], state: AppState, shown: boolean, selectedId: string | null): void {
    this.el.hidden = !shown
    if (!shown) return
    const facts = views.map((view) => this.facts(view, state, view.pane.id === selectedId))
    const signature = JSON.stringify([views.map((v, i) => [v.pane.id, v.title, v.project?.name ?? '', v.fullTitle, v.status, v.agent, v.attention, isStarred(v.pane), crewSignature(v), sessionNote(v.pane.id).plan, facts[i].text, facts[i].strong]), selectedId])
    if (signature === this.signature || document.body.classList.contains('dragging-ui')) return
    this.signature = signature
    clear(this.el)
    this.entries = views.map((view, i) => ({ id: view.pane.id, name: view.title, state: facts[i].state, detail: facts[i].text || SESSION_STATE_LABELS[facts[i].state] }))
    views.forEach((view, i) => this.el.append(this.tab(view, view.pane.id === selectedId, views, facts[i])))
    this.el.append(this.line, this.more)
    this.el.querySelector('.strip-tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.revealNeeding()
    this.syncOverflow()
  }

  private facts(view: PaneView, app: AppState, selected: boolean): { state: SessionState; text: string; quiet: boolean; strong: boolean } {
    const state = sessionState({ status: view.status, attention: view.attention })
    const status = tabStatus(state, state === 'idle' ? stateSince(view.pane.id, state, app.now) : app.now, app.now, selected)
    return { state, text: status.text, quiet: status.quiet, strong: tabNameStrong(state, isUnread(view.pane.id)) }
  }

  /** A tab that starts needing you while it is scrolled out of sight comes into view. */
  private revealNeeding(): void {
    const now = new Set(this.entries.filter((entry) => entry.state === 'needs').map((entry) => entry.id))
    const fresh = [...now].filter((id) => !this.needing.has(id))
    this.needing = now
    const target = fresh.map((id) => this.tabById(id)).find((tab) => tab && this.isOutOfView(tab))
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private tabById(id: string): HTMLElement | undefined {
    return this.tabs().find((tab) => tab.dataset.paneId === id)
  }

  private viewSpan(): { start: number; end: number } {
    const bounds = this.el.getBoundingClientRect()
    return { start: bounds.left, end: bounds.right - (this.more.hidden ? 0 : this.more.offsetWidth) }
  }

  private isOutOfView(tab: HTMLElement): boolean {
    const span = this.viewSpan()
    const rect = tab.getBoundingClientRect()
    return tabsOutOfView([{ id: '', start: rect.left, end: rect.right }], span.start, span.end).length > 0
  }

  /** Shows "+N" at the end of the strip when tabs do not fit, in the needs colour while one of them needs you. */
  private syncOverflow(): void {
    if (this.el.hidden) return
    const wasHidden = this.more.hidden
    this.more.hidden = false
    const span = this.viewSpan()
    const spans = this.tabs().map((tab) => {
      const rect = tab.getBoundingClientRect()
      return { id: tab.dataset.paneId ?? '', start: rect.left, end: rect.right }
    })
    const out = new Set(tabsOutOfView(spans, span.start, span.end))
    this.hidden = this.entries.filter((entry) => out.has(entry.id))
    this.more.hidden = this.hidden.length === 0
    this.more.textContent = overflowLabel(this.hidden.length)
    const needs = this.hidden.some((entry) => entry.state === 'needs')
    this.more.classList.toggle('needs', needs)
    this.more.title = needs ? `${this.hidden.length} more sessions, one needs you` : `${this.hidden.length} more sessions`
    this.more.setAttribute('aria-label', this.more.title)
    if (wasHidden !== this.more.hidden && !this.more.hidden) this.syncOverflow()
  }

  private openMore(): void {
    const entries: ContextItem[] = overflowOrder(this.hidden).map((entry) => ({ label: entry.name, detail: entry.detail, run: () => focusPane(entry.id) }))
    openContextMenu({ x: 0, y: 0, label: 'More sessions', entries, anchor: this.more.getBoundingClientRect(), returnFocus: this.more })
  }

  private tab(view: PaneView, selected: boolean, views: PaneView[], fact: { state: SessionState; text: string; quiet: boolean; strong: boolean }): HTMLElement {
    const name = view.title
    const stateName = fact.state
    const stateLabel = SESSION_STATE_LABELS[stateName]
    const plan = parsePlanLabel(sessionNote(view.pane.id).plan)
    const starred = isStarred(view.pane)
    const project = view.project?.name ?? ''
    const label = h(
      'button',
      {
        class: 'strip-label',
        type: 'button',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        title: `${name}${project ? ` (${project})` : ''}, ${stateLabel}${plan ? `, plan ${plan.done} of ${plan.total}` : ''}${view.fullTitle && view.fullTitle !== name ? `\n${view.fullTitle}` : ''}`,
        onClick: () => focusPane(view.pane.id)
      },
      h('span', { class: 'strip-index' }, `${view.index + 1}`),
      identityMark(view, 18),
      h('bdi', { class: `strip-name${fact.strong ? ' strong' : ''}`, dir: 'auto' }, name),
      project ? h('span', { class: 'strip-project', 'aria-hidden': 'true' }, monogram(project)) : null,
      starred ? h('span', { class: 'strip-pin', role: 'img', 'aria-label': 'Pinned' }, icon(ICONS.pin)) : null,
      fact.text ? h('span', { class: `strip-status state-${stateName}${fact.quiet ? ' quiet' : ''}` }, fact.text) : null,
      plan && showsTabPlan(stateName, selected, true) ? h('span', { class: 'strip-plan', 'aria-hidden': 'true' }, `${plan.done}/${plan.total}`) : null
    )
    const close = iconButton(`Close ${name}`, ICONS.closeSmall, () => void closePane(view.pane.id), 'strip-close')
    const tab = h(
      'div',
      { class: `strip-tab${selected ? ' selected' : ''}`, 'data-pane-id': view.pane.id },
      label,
      close,
      selected && plan ? h('span', { class: 'strip-bar', 'aria-hidden': 'true' }, h('i', { style: `width: ${plan.percent}%` })) : null
    )
    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      openContextMenu({
        x: event.clientX,
        y: event.clientY,
        label: `Actions for ${name}`,
        entries: [{ label: starred ? 'Unpin' : 'Pin to top', run: () => toggleStarred(view.pane.id) }, { label: 'Close', run: () => void closePane(view.pane.id) }],
        returnFocus: () => this.el.querySelector<HTMLElement>(`[data-pane-id="${view.pane.id}"] .strip-label`)?.focus()
      })
    })
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
