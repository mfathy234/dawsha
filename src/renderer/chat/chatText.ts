import { h } from '../dom'

const FENCE = /^\s*```/
const INLINE_CODE = /`([^`\n]+)`/g

function inline(text: string): Node[] {
  const out: Node[] = []
  let last = 0
  for (const match of text.matchAll(INLINE_CODE)) {
    if (match.index > last) out.push(document.createTextNode(text.slice(last, match.index)))
    out.push(h('code', { dir: 'ltr' }, match[1]))
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)))
  return out
}

/** Plain paragraphs, inline code and fenced blocks as DOM nodes. Nothing here is parsed as HTML. */
export function richText(text: string): HTMLElement[] {
  const blocks: HTMLElement[] = []
  let paragraph: string[] = []
  let code: string[] | null = null
  const flush = (): void => {
    if (paragraph.length === 0) return
    blocks.push(h('p', { class: 'chat-p', dir: 'auto' }, ...inline(paragraph.join('\n'))))
    paragraph = []
  }
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (code) {
        blocks.push(h('pre', { class: 'chat-code', dir: 'ltr' }, code.join('\n')))
        code = null
      } else {
        flush()
        code = []
      }
    } else if (code) {
      code.push(line)
    } else if (line.trim() === '') {
      flush()
    } else {
      paragraph.push(line)
    }
  }
  if (code) blocks.push(h('pre', { class: 'chat-code', dir: 'ltr' }, code.join('\n')))
  flush()
  return blocks
}
