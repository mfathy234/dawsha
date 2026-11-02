import { addAttachments, removeAttachment, type Attachment } from '../../shared/chatAttach'
import type { ChatImageResult } from '../../shared/chatImage'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { api } from '../api'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import type { ChatSessionRef } from './chatImageCache'
import { LruCache } from './lruCache'

const PREVIEW_TRIES = 4
const PREVIEW_RETRY_MS = 1000
const previews = new LruCache<ChatImageResult>(40)

/** The files waiting to go with the next message: small removable chips above the box. */
export class ChatAttachments {
  readonly el = h('div', { class: 'chat-chips', hidden: true, role: 'list', 'aria-label': CHAT_TEXT.attachments })
  private list: readonly Attachment[] = []
  private session: ChatSessionRef | null = null

  constructor(private readonly onChange: () => void) {}

  get items(): readonly Attachment[] {
    return this.list
  }

  setSession(session: ChatSessionRef | null): void {
    if (this.session?.sessionId === session?.sessionId && this.session?.agent === session?.agent) return
    this.session = session
    this.draw()
  }

  add(paths: readonly string[]): void {
    this.list = addAttachments(this.list, paths)
    this.draw()
    this.onChange()
  }

  clear(): void {
    this.list = []
    this.draw()
    this.onChange()
  }

  private remove(path: string): void {
    this.list = removeAttachment(this.list, path)
    this.draw()
    this.onChange()
  }

  private draw(): void {
    this.el.hidden = this.list.length === 0
    this.el.replaceChildren(...this.list.map((item) => this.chip(item)))
  }

  private chip(item: Attachment): HTMLElement {
    const thumb = h('span', { class: 'chat-chip-thumb', 'aria-hidden': 'true' }, icon(ICONS.toolRead))
    if (item.image && this.session) void this.preview(item, thumb, this.session)
    return h(
      'span',
      { class: 'chat-chip', role: 'listitem', title: item.path },
      thumb,
      h('span', { class: 'chat-chip-name', dir: 'auto' }, item.name),
      h('button', { class: 'chat-chip-x', type: 'button', 'aria-label': CHAT_TEXT.removeAttachment(item.name), onClick: () => this.remove(item.path) }, '×')
    )
  }

  /** The session's folder is known to main once its first read has run; a drop just after opening may get there first, so a refusal is tried again a few times. */
  private async preview(item: Attachment, thumb: HTMLElement, session: ChatSessionRef): Promise<void> {
    const key = `${session.sessionId}
${item.path}`
    for (let attempt = 0; attempt < PREVIEW_TRIES && thumb.isConnected; attempt += 1) {
      const result = previews.get(key) ?? (await api.chat.preview({ agent: session.agent, sessionId: session.sessionId, path: item.path }).catch((): ChatImageResult => ({ status: 'blocked' })))
      if (result.status === 'ok') {
        previews.set(key, result)
        thumb.replaceChildren(h('img', { src: result.dataUrl, alt: '', draggable: false }))
        return
      }
      await new Promise((done) => window.setTimeout(done, PREVIEW_RETRY_MS))
    }
  }
}
