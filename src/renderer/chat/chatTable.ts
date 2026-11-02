import type { TableAlign, TableBlock } from '../../shared/chatMarkdown'
import type { Inline } from '../../shared/chatMarkdownInline'
import { h } from '../dom'

type Render = (parts: readonly Inline[]) => Node[]

const alignAttr = (align: TableAlign): string | undefined => (align ? `chat-al-${align}` : undefined)

/** A table in a box that scrolls sideways, so a wide one never pushes the thread wider than the pane. */
export function renderTable(table: TableBlock, inline: Render): HTMLElement {
  const cell = (tag: 'th' | 'td', parts: readonly Inline[], column: number): HTMLElement =>
    h(tag, { dir: 'auto', class: alignAttr(table.align[column] ?? null), scope: tag === 'th' ? 'col' : undefined }, ...inline(parts))
  const head = h('thead', {}, h('tr', {}, ...table.head.map((parts, column) => cell('th', parts, column))))
  const body = h('tbody', {}, ...table.rows.map((row) => h('tr', {}, ...row.map((parts, column) => cell('td', parts, column)))))
  return h('div', { class: 'chat-table', tabindex: 0 }, h('table', {}, head, body))
}
