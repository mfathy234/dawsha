import '../styles.css'
import './mini.css'
import type { MiniApi, MiniSession, MiniSnapshot } from '../../shared/miniWindow'
import { SESSION_STATE_LABELS } from '../../shared/sessionState'
import { h, icon, iconButton } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from '../components/agentMark'
import { crewAvatar } from '../components/crewAvatar'

declare global { interface Window { miniApi: MiniApi } }
const api = window.miniApi
const root = document.getElementById('mini')!
let snapshot: MiniSnapshot | null = null
let selected: string | null = null
let signature = ''
const soundIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 4V5L8 9zM17 8a6 6 0 0 1 0 8"/></svg>'
const open = (s: MiniSession): void => api.action({ kind: 'open', paneId: s.paneId })
const select = (id: string | null): void => { selected = id; draw(true) }

function fitContent(): void {
  if (!snapshot) return
  const css = getComputedStyle(root)
  const spacing = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + (snapshot.folded ? 0 : parseFloat(css.rowGap))
  const head = root.querySelector('header')?.getBoundingClientRect().height ?? 30
  const list = root.querySelector<HTMLElement>('.mini-content')
  const children = list ? Array.from(list.children) as HTMLElement[] : []
  const gap = list ? parseFloat(getComputedStyle(list).rowGap) : 0
  const content = snapshot.folded ? 0 : children.reduce((height, child) => height + child.offsetHeight, 0) + Math.max(0, children.length - 1) * gap
  api.resize(snapshot.folded ? 58 : Math.min(640, head + content + spacing))
}

function tile(session: MiniSession, size = 36): HTMLElement {
  const mark = session.identity ? crewAvatar(session.identity, 'idle', size) : agentMark(session.agent) ?? h('span', {}, '>_')
  return h('span', { class: 'mini-tile', style: `--tile-size:${size}px` }, mark)
}

function progress(session: MiniSession): HTMLElement | null {
  const p = session.plan
  if (!p) return null
  const percent = Math.min(100, Math.max(0, p.done / p.total * 100))
  return h('div', { class: 'mini-progress', title: p.current, 'aria-label': `Plan, ${p.done} of ${p.total} done${p.current ? `. Now: ${p.current}` : ''}` },
    h('span', {}, h('b', {}, `${p.done}/${p.total}`), ' Plan'),
    h('div', { class: 'mini-track', role: 'progressbar', 'aria-label': 'Plan progress', 'aria-valuemin': '0', 'aria-valuemax': p.total, 'aria-valuenow': p.done }, h('i', { style: `width:${percent}%` })))
}

function permission(session: MiniSession): HTMLElement | null {
  if (!session.permission) return null
  const answer = (allow: boolean): void => api.action({ kind: 'answer', paneId: session.paneId, allow, prompt: session.permission!.prompt })
  return h('div', { class: 'mini-permission' },
    session.permission.command ? h('pre', { dir: 'auto' }, session.permission.command) : null,
    h('div', { class: 'mini-actions' },
      h('button', { type: 'button', class: 'mini-allow', onClick: () => answer(true) }, 'Allow'),
      h('button', { type: 'button', onClick: () => answer(false) }, 'Deny'),
      h('button', { type: 'button', class: 'mini-open-text', onClick: () => open(session) }, 'Open in Dawsha')))
}

function card(session: MiniSession): HTMLElement {
  const summary = h('button', { type: 'button', class: 'mini-select', onClick: () => select(session.paneId), 'aria-label': `${session.title}, ${SESSION_STATE_LABELS[session.state]}` },
    tile(session), h('span', { class: 'mini-info' }, h('strong', { dir: 'auto', title: session.title }, session.title),
      h('span', { class: 'mini-line', dir: 'auto' }, session.line), progress(session)))
  const row = h('div', { class: 'mini-card-row' }, summary,
    !session.permission ? iconButton('Open in Dawsha', ICONS.maximize, () => open(session), 'mini-open') : null)
  return h('article', { class: 'mini-card', 'data-pane-id': session.paneId, 'data-state': session.state }, row, permission(session))
}

function detail(session: MiniSession): HTMLElement {
  const plan = session.plan
  return h('section', { class: 'mini-detail', 'data-state': session.state, 'data-pane-id': session.paneId },
    h('div', { class: 'mini-detail-title' }, tile(session, 48), h('div', { class: 'mini-info' },
      h('h1', { dir: 'auto' }, session.title), h('span', { class: 'mini-project', dir: 'auto' }, session.project),
      h('span', { class: 'mini-line', dir: 'auto' }, session.line), progress(session))),
    permission(session),
    plan && plan.items.length > 0 ? h('ol', { class: 'mini-plan', 'aria-label': 'Plan' }, ...plan.items.map(item =>
      h('li', { 'data-status': item.status }, h('span', { class: 'mini-step', role: 'img', 'aria-label': item.status === 'completed' ? 'Done' : item.status === 'in_progress' ? 'In progress' : 'Not started' }, item.status === 'completed' ? icon(ICONS.check) : ''), h('span', { dir: 'auto' }, item.text)))) : null,
    h('div', { class: 'mini-terminal' }, h('span', { class: 'mini-terminal-label' }, icon(ICONS.terminal), 'Terminal'),
      h('pre', { dir: 'auto' }, session.tail.join('\n') || 'No output yet')))
}

function draw(force = false): void {
  if (!snapshot) return
  const session = snapshot.sessions.find(s => s.paneId === selected)
  if (!session) selected = null
  const key = JSON.stringify([snapshot, selected])
  if (!force && key === signature) return
  signature = key
  // Keep keyboard focus and scroll position stable while live content changes.
  const active = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null
  const focusIndex = active ? Array.from(root.querySelectorAll('button')).indexOf(active as HTMLButtonElement) : -1
  const focusPane = active?.closest('[data-pane-id]')?.getAttribute('data-pane-id')
  const focusLabel = active?.getAttribute('aria-label') ?? active?.textContent
  const scroll = root.querySelector('.mini-content')?.scrollTop ?? 0
  root.classList.toggle('mini-folded', snapshot.folded)
  const count = snapshot.sessions.length
  const needs = snapshot.sessions.filter(s => s.state === 'needs').length
  const countLabel = `${count} session${count === 1 ? '' : 's'}${needs ? `, ${needs} needs you` : ''}`
  const head = h('header', { class: 'mini-header' })
  if (snapshot.folded) {
    head.append(h('div', { class: 'mini-stacked', 'aria-hidden': 'true' }, ...snapshot.sessions.slice(0, 3).map(s => tile(s, 24))), h('span', { class: 'mini-fold-label' }, countLabel))
  } else if (session) {
    head.append(iconButton('Back to all sessions', ICONS.prev, () => select(null)),
      h('nav', { class: 'mini-switch', 'aria-label': 'Other sessions' }, ...snapshot.sessions.filter(s => s.paneId !== selected).map(s =>
        h('button', { type: 'button', 'aria-label': s.title, title: s.title, onClick: () => select(s.paneId) }, tile(s, 24)))),
      iconButton('Open in Dawsha', ICONS.maximize, () => open(session)))
  } else {
    head.append(h('h1', {}, 'Sessions'), h('span', { class: 'mini-count' }, String(count)))
    if (needs) head.append(h('span', { class: 'mini-needs' }, `${needs} needs you`))
  }
  head.append(
    iconButton(snapshot.sound ? 'Sound on' : 'Sound off', soundIcon, () => api.action({ kind: 'sound' })),
    iconButton(snapshot.folded ? 'Unfold' : 'Fold', snapshot.folded ? ICONS.chevronDown : ICONS.chevronUp, () => api.action({ kind: 'fold' })),
    iconButton('Close mini window', ICONS.close, () => api.action({ kind: 'close' })))
  const content = h('div', { class: 'mini-content' })
  if (!snapshot.folded) {
    if (session) content.append(detail(session))
    else if (count) content.append(...snapshot.sessions.map(card))
    else content.append(h('div', { class: 'mini-empty' }, h('p', {}, 'No sessions open'), h('button', { type: 'button', onClick: () => api.action({ kind: 'new' }) }, 'New session')))
  }
  root.replaceChildren(head, content)
  content.scrollTop = scroll
  if (focusIndex >= 0) {
    const candidates = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    const same = candidates.find(b => (b.getAttribute('aria-label') ?? b.textContent) === focusLabel && (!focusPane || b.closest('[data-pane-id]')?.getAttribute('data-pane-id') === focusPane))
    ;(same ?? root.querySelector<HTMLButtonElement>('.mini-header button'))?.focus({ preventScroll: true })
  }
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
