import '../styles.css'
import './mini.css'
import type { MiniApi, MiniSession, MiniSnapshot } from '../../shared/miniWindow'
import { h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { CardView } from './card'
import { DetailView } from './detail'
import { enter, flip, leave, slide } from './motion'
import { tile, type MiniHost } from './parts'

declare global { interface Window { miniApi: MiniApi } }
const api = window.miniApi
const root = document.getElementById('mini')!
const soundIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 4V5L8 9zM17 8a6 6 0 0 1 0 8"/></svg>'

type Mode = 'folded' | 'empty' | 'list' | 'detail'
let snapshot: MiniSnapshot | null = null
let selected: string | null = null
let signature = ''
let mode: Mode | null = null
let shownId: string | null = null
let headerKey = ''
let listScroll = 0
const cards = new Map<string, CardView>()
let detailView: DetailView | null = null
let header = h('header', { class: 'mini-header' })
const content = h('div', { class: 'mini-content' })
const ghosts = h('div', { class: 'mini-ghosts', 'aria-hidden': 'true' })
root.replaceChildren(header, content)

const select = (id: string | null): void => { selected = id; draw() }
const host: MiniHost = {
  open: s => api.action({ kind: 'open', paneId: s.paneId }),
  select: id => select(id),
  review: s => api.action({ kind: 'review', paneId: s.paneId }),
  answer: (s, allow) => { if (s.permission) api.action({ kind: 'answer', paneId: s.paneId, allow, prompt: s.permission.prompt }) },
  send: (s, text) => api.action({ kind: 'send', paneId: s.paneId, text })
}

function fitContent(): void {
  if (!snapshot) return
  const css = getComputedStyle(root)
  const spacing = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + (snapshot.folded ? 0 : parseFloat(css.rowGap))
  const head = root.querySelector('header')?.getBoundingClientRect().height ?? 30
  const children = Array.from(content.children).filter(child => child !== ghosts) as HTMLElement[]
  const gap = parseFloat(getComputedStyle(content).rowGap)
  const total = snapshot.folded ? 0 : children.reduce((height, child) => height + child.offsetHeight, 0) + Math.max(0, children.length - 1) * gap
  api.resize(snapshot.folded ? 58 : Math.min(640, head + total + spacing))
}

function drawHeader(session: MiniSession | undefined): void {
  if (!snapshot) return
  const count = snapshot.sessions.length
  const needs = snapshot.sessions.filter(s => s.state === 'needs').length
  const key = JSON.stringify([snapshot.folded, snapshot.sound, session?.paneId, count, needs,
    (snapshot.folded ? snapshot.sessions.slice(0, 3) : session ? snapshot.sessions : []).map(s => [s.paneId, s.title, s.agent, s.identity])])
  if (key === headerKey) return
  headerKey = key
  const active = header.contains(document.activeElement) ? document.activeElement as HTMLElement : null
  const label = active?.getAttribute('aria-label') ?? null
  const next = h('header', { class: 'mini-header' })
  if (snapshot.folded) {
    const countLabel = `${count} session${count === 1 ? '' : 's'}${needs ? `, ${needs} needs you` : ''}`
    next.append(h('div', { class: 'mini-stacked', 'aria-hidden': 'true' }, ...snapshot.sessions.slice(0, 3).map(s => tile(s, 24))), h('span', { class: 'mini-fold-label' }, countLabel))
  } else if (session) {
    next.append(iconButton('Back to all sessions', ICONS.prev, () => select(null)),
      h('nav', { class: 'mini-switch', 'aria-label': 'Other sessions' }, ...snapshot.sessions.filter(s => s.paneId !== session.paneId).map(s =>
        h('button', { type: 'button', 'aria-label': s.title, title: s.title, onClick: () => select(s.paneId) }, tile(s, 24)))),
      iconButton('Open in Dawsha', ICONS.maximize, () => host.open(session)))
  } else {
    next.append(h('h1', {}, 'Sessions'), h('span', { class: 'mini-count' }, String(count)))
    if (needs) next.append(h('span', { class: 'mini-needs' }, `${needs} needs you`))
  }
  next.append(
    iconButton(snapshot.sound ? 'Sound on' : 'Sound off', soundIcon, () => api.action({ kind: 'sound' })),
    iconButton(snapshot.folded ? 'Unfold' : 'Fold', snapshot.folded ? ICONS.chevronDown : ICONS.chevronUp, () => api.action({ kind: 'fold' })),
    iconButton('Close mini window', ICONS.close, () => api.action({ kind: 'close' })))
  header.replaceWith(next)
  header = next
  if (active) ((label ? Array.from(next.querySelectorAll<HTMLElement>('button')).find(b => b.getAttribute('aria-label') === label) : null) ?? next.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
}

function syncCards(sessions: readonly MiniSession[], animate: boolean): void {
  const before = new Map<string, number>()
  const offsets = new Map<string, number>()
  if (animate) for (const [id, view] of cards) if (view.el.parentElement === content) { before.set(id, view.el.getBoundingClientRect().top); offsets.set(id, view.el.offsetTop) }
  const ids = new Set(sessions.map(s => s.paneId))
  for (const [id, view] of cards) {
    if (ids.has(id)) continue
    cards.delete(id)
    if (animate && view.el.parentElement === content) {
      view.el.style.top = `${offsets.get(id) ?? 0}px`
      view.el.classList.add('mini-ghost')
      view.el.setAttribute('inert', '')
      ghosts.append(view.el)
      leave(view.el)
    } else view.el.remove()
  }
  const fresh: CardView[] = []
  const ordered = sessions.map(session => {
    const held = cards.get(session.paneId)
    if (held) { held.update(session, animate); return held }
    const view = new CardView(session, host)
    cards.set(session.paneId, view)
    fresh.push(view)
    return view
  })
  let cursor: Element | null = content.firstElementChild
  for (const view of ordered) {
    if (view.el === cursor) cursor = cursor.nextElementSibling
    else content.insertBefore(view.el, cursor)
  }
  if (!ghosts.parentElement) content.append(ghosts)
  if (!animate) return
  for (const view of fresh) enter(view.el)
  flip(new Map(ordered.map(view => [view.session.paneId, view.el])), before)
}

function rebuild(next: Mode, session: MiniSession | undefined, previous: Mode | null): void {
  if (previous === 'list') listScroll = content.scrollTop
  detailView?.dispose()
  detailView = null
  content.replaceChildren()
  ghosts.replaceChildren()
  const slideFrom = next === 'detail' ? 'end' : 'start'
  const fade = previous === 'list' || previous === 'detail'
  if (next === 'detail' && session) {
    detailView = new DetailView(session, host)
    content.append(detailView.el)
    content.scrollTop = 0
    if (fade) slide(detailView.el, slideFrom)
  } else if (next === 'list' && snapshot) {
    for (const [cardId, view] of cards) if (!snapshot.sessions.some(s => s.paneId === cardId)) { view.el.remove(); cards.delete(cardId) }
    syncCards(snapshot.sessions, false)
    content.scrollTop = listScroll
    if (fade) slide(content, slideFrom)
  } else if (next === 'empty') {
    content.append(h('div', { class: 'mini-empty' }, h('p', {}, 'No sessions open'), h('button', { type: 'button', onClick: () => api.action({ kind: 'new' }) }, 'New session')))
  }
}

function draw(): void {
  if (!snapshot) return
  const session = snapshot.sessions.find(s => s.paneId === selected)
  if (!session) selected = null
  const key = JSON.stringify([snapshot, selected])
  if (key === signature) return
  signature = key
  const hadFocus = root.contains(document.activeElement)
  root.classList.toggle('mini-folded', snapshot.folded)
  drawHeader(session)
  const next: Mode = snapshot.folded ? 'folded' : session ? 'detail' : snapshot.sessions.length ? 'list' : 'empty'
  const id = next === 'detail' ? session!.paneId : null
  if (next !== mode || id !== shownId) {
    const previous = mode
    mode = next
    shownId = id
    rebuild(next, session, previous)
  } else if (next === 'detail' && session) detailView?.update(session)
  else if (next === 'list') syncCards(snapshot.sessions, true)
  if (hadFocus && !root.contains(document.activeElement)) header.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  fitContent()
}

function update(next: MiniSnapshot): void {
  snapshot = next
  for (const [name, value] of Object.entries(next.theme)) document.documentElement.style.setProperty(name, value)
  document.documentElement.dataset.kind = next.kind
  draw()
}
let pushed = false
api.onSnapshot(value => { pushed = true; update(value) })
void api.get().then(value => { if (value && !pushed) update(value) })
root.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) { event.preventDefault(); select(null) } })
new ResizeObserver(fitContent).observe(root)
