import type { MiniSession } from '../../shared/miniWindow'
import { h } from '../dom'
import { agentMark } from '../components/agentMark'
import { crewAvatar } from '../components/crewAvatar'

export interface MiniHost {
  open(session: MiniSession): void
  select(paneId: string): void
  review(session: MiniSession): void
  answer(session: MiniSession, allow: boolean): void
  send(session: MiniSession, text: string): void
}

export function tile(session: Pick<MiniSession, 'identity' | 'agent'>, size = 36): HTMLElement {
  const mark = session.identity ? crewAvatar(session.identity, 'idle', size) : agentMark(session.agent) ?? h('span', {}, '>_')
  return h('span', { class: 'mini-tile', style: `--tile-size:${size}px` }, mark)
}

export const tileKey = (session: Pick<MiniSession, 'identity' | 'agent'>): string => JSON.stringify([session.agent, session.identity])

export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text
}

export function setAttr(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value)
}

/** The plan bar. The fill is scaled, not resized, so a change in progress slides. */
export class ProgressBar {
  readonly el = h('div', { class: 'mini-progress', hidden: true })
  private readonly count = h('b')
  private readonly fill = h('i')
  private readonly track = h('div', { class: 'mini-track', role: 'progressbar', 'aria-label': 'Plan progress', 'aria-valuemin': '0' }, this.fill)

  constructor() {
    this.el.append(h('span', {}, this.count, ' Plan'), this.track)
  }

  update(plan: MiniSession['plan']): void {
    this.el.hidden = !plan
    if (!plan) return
    setText(this.count, `${plan.done}/${plan.total}`)
    setAttr(this.el, 'title', plan.current)
    setAttr(this.el, 'aria-label', `Plan, ${plan.done} of ${plan.total} done${plan.current ? `. Now: ${plan.current}` : ''}`)
    setAttr(this.track, 'aria-valuemax', String(plan.total))
    setAttr(this.track, 'aria-valuenow', String(plan.done))
    this.fill.style.setProperty('--p', String(Math.min(1, Math.max(0, plan.done / plan.total))))
  }
}

/** The approval box. It is rebuilt only when the request itself changes, so a focused button stays focused. */
export class PermissionBlock {
  readonly el = h('div', { class: 'mini-permission', hidden: true })
  private key = ''

  constructor(private readonly host: MiniHost) {}

  update(session: MiniSession): void {
    const permission = session.permission
    const key = permission ? JSON.stringify([permission.prompt, permission.command]) : ''
    if (key === this.key) return
    this.key = key
    this.el.hidden = !permission
    if (!permission) { this.el.replaceChildren(); return }
    this.el.replaceChildren(...[
      permission.command ? h('pre', { dir: 'auto' }, permission.command) : null,
      h('div', { class: 'mini-actions' },
        h('button', { type: 'button', class: 'mini-allow', onClick: () => this.host.answer(session, true) }, 'Allow'),
        h('button', { type: 'button', onClick: () => this.host.answer(session, false) }, 'Deny'),
        h('button', { type: 'button', class: 'mini-open-text', onClick: () => this.host.open(session) }, 'Open in Dawsha'))].filter((node): node is HTMLPreElement | HTMLDivElement => node !== null))
  }
}
