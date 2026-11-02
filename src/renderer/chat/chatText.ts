import { parseMarkdown, type Block, type ListBlock } from '../../shared/chatMarkdown'
import { isWebLink, type Inline } from '../../shared/chatMarkdownInline'
import { api } from '../api'
import { h } from '../dom'
import { copyButton } from './chatCopy'
import { renderTable } from './chatTable'

const text = (value: string): Node => document.createTextNode(value)

function link(label: string, url: string): Node {
  if (!isWebLink(url)) return text(label)
  // A button, not an anchor with an href: a click can never navigate this window, it goes to the system browser.
  return h('button', { class: 'chat-link', type: 'button', title: url, onClick: () => void api.openExternal(url).catch(() => undefined) }, label)
}

/** Inline nodes for parsed inline text. Everything is a text node or a created element, never markup. */
export function renderInline(parts: readonly Inline[]): Node[] {
  return parts.map((part): Node => {
    if (part.type === 'text') return text(part.text)
    if (part.type === 'code') return h('code', { dir: 'ltr' }, part.text)
    if (part.type === 'bold') return h('strong', {}, ...renderInline(part.children))
    if (part.type === 'italic') return h('em', {}, ...renderInline(part.children))
    return link(part.text, part.url)
  })
}

function renderList(list: ListBlock): HTMLElement {
  const items = list.items.map((item) => h('li', { dir: 'auto' }, ...renderInline(item.inline), ...item.children.map(renderList)))
  return list.ordered ? h('ol', { class: 'chat-list', start: list.start }, ...items) : h('ul', { class: 'chat-list' }, ...items)
}

function renderBlock(block: Block): HTMLElement {
  switch (block.type) {
    case 'paragraph':
      return h('p', { class: 'chat-p', dir: 'auto' }, ...renderInline(block.inline))
    case 'heading':
      return h('p', { class: `chat-h chat-h${Math.min(block.level, 3)}`, dir: 'auto', role: 'heading', 'aria-level': Math.min(block.level + 1, 6) }, ...renderInline(block.inline))
    case 'code':
      return h('div', { class: 'chat-codewrap' }, h('pre', { class: 'chat-code', dir: 'ltr' }, block.text), copyButton(() => block.text))
    case 'quote':
      return h('blockquote', { class: 'chat-quote', dir: 'auto' }, ...block.blocks.map(renderBlock))
    case 'rule':
      return h('hr', { class: 'chat-rule' })
    case 'list':
      return renderList(block)
    case 'table':
      return renderTable(block, renderInline)
  }
}

/** A message as DOM blocks: paragraphs, headings, lists, tables, quotes and code. Nothing here is parsed as HTML. */
export function richText(source: string): HTMLElement[] {
  return parseMarkdown(source).map(renderBlock)
}
