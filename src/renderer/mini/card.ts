import { SESSION_STATE_LABELS } from '../../shared/sessionState'
import type { MiniSession } from '../../shared/miniWindow'
import { h, iconButton } from '../dom'
import { ICONS } from '../icons'
import { glow, spinner } from './motion'
import { PermissionBlock, ProgressBar, setAttr, setText, tile, tileKey, type MiniHost } from './parts'

/** One session in the list. It lives as long as the session does, so its bar and spinner keep animating between updates. */
export class CardView {
  readonly el = h('article', { class: 'mini-card' })
  private readonly tileSlot = h('span', { class: 'mini-tile-slot' })
  private readonly title = h('strong', { dir: 'auto' })
  private readonly spin = spinner()
  private readonly lineText = h('span', { dir: 'auto' })
  private readonly progress = new ProgressBar()
  private readonly select: HTMLButtonElement
  private readonly open: HTMLButtonElement
  private readonly review: HTMLButtonElement
  private readonly ring = h('span', { class: 'mini-ring', 'aria-hidden': 'true' })
  private readonly permission: PermissionBlock
  private tiles = ''
  private state: MiniSession['state'] | null = null
  session!: MiniSession

  constructor(session: MiniSession, private readonly host: MiniHost) {
    this.permission = new PermissionBlock(host)
    this.select = h('button', { type: 'button', class: 'mini-select', onClick: () => host.select(this.session.paneId) },
      this.tileSlot, h('span', { class: 'mini-info' }, this.title, h('span', { class: 'mini-line' }, this.spin, this.lineText), this.progress.el))
    this.open = iconButton('Open in Dawsha', ICONS.maximize, () => host.open(this.session), 'mini-open')
    this.review = h('button', { type: 'button', class: 'mini-review', onClick: () => host.review(this.session) }, 'Review')
    this.el.append(this.ring, h('div', { class: 'mini-card-row' }, this.select, this.open), h('div', { class: 'mini-card-foot' }, this.review), this.permission.el)
    this.el.dataset.paneId = session.paneId
    this.update(session, false)
  }

  update(session: MiniSession, animate: boolean): void {
    this.session = session
    const key = tileKey(session)
    if (key !== this.tiles) { this.tiles = key; this.tileSlot.replaceChildren(tile(session)) }
    if (animate && session.state === 'needs' && this.state !== 'needs') glow(this.ring)
    this.state = session.state
    this.el.dataset.state = session.state
    setText(this.title, session.title)
    setAttr(this.title, 'title', session.title)
    setText(this.lineText, session.line)
    setAttr(this.select, 'aria-label', `${session.title}, ${SESSION_STATE_LABELS[session.state]}`)
    this.spin.hidden = session.state !== 'working'
    this.progress.update(session.plan)
    this.open.hidden = !!session.permission
    this.review.hidden = !session.fresh
    this.review.parentElement!.hidden = !session.fresh
    this.permission.update(session)
  }
}
