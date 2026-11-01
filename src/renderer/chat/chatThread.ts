import { foldLines, textDirection, type ChatItem, type ChatMessage, type ChatNotice, type ChatPhase, type ChatTool } from '../../shared/chatLog'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { stateIcon } from '../components/stateIcon'
import type { FeedSnapshot } from './chatFeed'
import { richText } from './chatText'

export interface ThreadActions {
  showTerminal(): void
  continueIn(to: AgentKind): void
  dismissLimit(): void
}

export interface ThreadContext {
  agentName: string
  otherAgent: AgentKind
  otherName: string
  project: string
  branch: string
  phase: ChatPhase
  limitDismissed: boolean
  permission: HTMLElement | null
  actions: ThreadActions
}

const PRESENT: Record<string, string> = { Ran: 'Running', Edited: 'Editing', Created: 'Creating', Read: 'Reading', Searched: 'Searching', Deleted: 'Deleting', Used: 'Using' }

function workingText(items: readonly ChatItem[]): string {
  const last = items[items.length - 1]
  if (last?.kind !== 'tool' || last.done) return 'Working'
  return `${PRESENT[last.verb] ?? last.verb} ${last.target}`.trim()
}

/** Draws the conversation. Everything from a log goes in as text, never as markup. */
export class ChatThread {
  readonly el = h('div', { class: 'chat-thread' })
  private readonly open = new Set<string>()

  constructor(private readonly rerender: () => void) {}

  render(feed: FeedSnapshot, ctx: ThreadContext): void {
    const children: (Node | null)[] =
      feed.state === 'failed' ? [this.failed(feed.reason, ctx)] : feed.state === 'loading' ? [h('p', { class: 'chat-quiet' }, 'Reading the session log…')] : this.body(feed, ctx)
    this.el.replaceChildren(...children.filter((child): child is Node => child !== null))
  }

  private body(feed: FeedSnapshot, ctx: ThreadContext): (Node | null)[] {
    if (feed.items.length === 0 && ctx.phase !== 'approval' && ctx.phase !== 'menu') return [this.empty(ctx)]
    return [feed.earlier > 0 ? h('p', { class: 'chat-quiet' }, 'Earlier messages are not shown.') : null, ...this.items(feed.items, ctx), ...this.tail(feed.items, ctx)]
  }

  private empty(ctx: ThreadContext): HTMLElement {
    const where = [ctx.project ? `Working in ${ctx.project}` : '', ctx.branch ? `on ${ctx.branch}` : ''].filter((part) => part !== '').join(' ')
    return h('div', { class: 'chat-empty' }, h('b', {}, `Tell ${ctx.agentName} what to do`), where ? h('span', { dir: 'auto' }, `${where}.`) : null)
  }

  private failed(reason: string, ctx: ThreadContext): HTMLElement {
    return h(
      'div',
      { class: 'chat-notice', role: 'alert' },
      h('b', {}, "Chat can't read this session"),
      h('span', { class: 'chat-quiet' }, reason),
      h('span', { class: 'chat-quiet' }, `${ctx.agentName} is unharmed and keeps running in the terminal.`),
      h('div', { class: 'chat-acts' }, this.button('Show terminal', ctx.actions.showTerminal, true))
    )
  }

  private items(items: readonly ChatItem[], ctx: ThreadContext): Node[] {
    const out: Node[] = []
    let tools: HTMLElement[] = []
    let dir: 'ltr' | 'rtl' = 'ltr'
    const flush = (): void => {
      if (tools.length === 0) return
      out.push(h('div', { class: 'chat-tools', dir }, ...tools))
      tools = []
    }
    items.forEach((item, index) => {
      if (item.kind === 'tool') {
        tools.push(...this.tool(item))
        return
      }
      flush()
      if (item.kind === 'message') {
        dir = textDirection(item.text)
        out.push(this.message(item))
      } else {
        out.push(this.notice(item, index === items.length - 1, ctx))
      }
    })
    flush()
    return out
  }

  private message(item: ChatMessage): HTMLElement {
    const folded = foldLines(item.text)
    const opened = this.open.has(`m:${item.id}`)
    const shown = opened || folded.hidden === 0 ? item.text : folded.head
    const body = h('div', { class: item.role === 'user' ? 'chat-you' : 'chat-say', dir: textDirection(item.text), 'data-role': item.role }, ...richText(shown))
    if (folded.hidden > 0) body.append(this.toggle(`m:${item.id}`, opened ? 'Show less' : `Show ${folded.hidden} more lines`, 'chat-more'))
    return body
  }

  private tool(item: ChatTool): HTMLElement[] {
    const expanded = this.open.has(`t:${item.id}`)
    const row = h(
      'button',
      { class: `chat-tool${item.failed ? ' failed' : ''}`, type: 'button', 'aria-expanded': String(expanded), title: item.target, 'data-tool': item.id, onClick: () => this.flip(`t:${item.id}`) },
      h('span', {}, item.verb),
      h('bdi', { dir: 'ltr' }, h('code', {}, item.target)),
      item.done ? this.toolNote(item) : null
    )
    if (!expanded) return [row]
    const text = item.output === '' ? 'No output.' : item.output
    return [row, h('pre', { class: 'chat-toolout', dir: 'ltr' }, item.outputTruncated ? `${text}\n(shortened)` : text)]
  }

  private toolNote(item: ChatTool): HTMLElement | null {
    const parts: Node[] = []
    if (item.added) parts.push(h('span', { class: 'add' }, `+${item.added}`))
    if (item.removed) parts.push(h('span', { class: 'del' }, `-${item.removed}`))
    if (item.note) parts.push(document.createTextNode(item.note))
    if (parts.length === 0) return null
    return h('bdi', { class: 'n', dir: 'ltr' }, ...parts.flatMap((part, index) => (index > 0 ? [document.createTextNode(' '), part] : [part])))
  }

  private notice(item: ChatNotice, last: boolean, ctx: ThreadContext): HTMLElement {
    if (item.notice === 'interrupted') return h('p', { class: 'chat-quiet' }, item.text)
    const actions =
      item.notice === 'limit' && last && ctx.phase === 'limit' && !ctx.limitDismissed
        ? h(
            'div',
            { class: 'chat-acts' },
            this.button(`Continue in ${ctx.otherName}`, () => ctx.actions.continueIn(ctx.otherAgent), true),
            this.button('Wait for the reset', ctx.actions.dismissLimit, false)
          )
        : null
    return h('div', { class: 'chat-notice' }, h('b', { dir: 'auto' }, item.text), actions)
  }

  private tail(items: readonly ChatItem[], ctx: ThreadContext): (Node | null)[] {
    if (ctx.phase === 'approval') return [ctx.permission]
    if (ctx.phase === 'menu') {
      return [
        h(
          'div',
          { class: 'chat-notice' },
          h('b', {}, `${ctx.agentName} opened a menu that chat can't show.`),
          h('span', { class: 'chat-quiet' }, 'Switch to the terminal to answer it. You can come back afterwards.'),
          h('div', { class: 'chat-acts' }, this.button('Show terminal', ctx.actions.showTerminal, true))
        )
      ]
    }
    if (ctx.phase === 'working') {
      return [h('div', { class: 'chat-working', role: 'status' }, stateIcon('working'), h('span', { dir: 'auto' }, `${workingText(items)}. Esc to interrupt.`))]
    }
    return []
  }

  private button(label: string, onClick: () => void, primary: boolean): HTMLElement {
    return h('button', { class: `chat-btn${primary ? ' primary' : ''}`, type: 'button', onClick }, label)
  }

  private toggle(key: string, label: string, cls: string): HTMLElement {
    return h('button', { class: cls, type: 'button', onClick: () => this.flip(key) }, label)
  }

  private flip(key: string): void {
    if (this.open.has(key)) this.open.delete(key)
    else this.open.add(key)
    this.rerender()
  }
}
