import { fileIconFor } from '../../shared/fileIcons'
import { h } from '../dom'
import './fileIcons.css'

const FOLDER = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" focusable="false"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.2c.3 0 .6.1.8.3l.9.9h6.1a1 1 0 0 1 1 1v7.3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z"/></svg>'
const FOLDER_OPEN = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" focusable="false"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.2c.3 0 .6.1.8.3l.9.9h5.1a1 1 0 0 1 1 1v1.3H4.2a1 1 0 0 0-.95.7L1.5 11.4zm3 3.5h10.3a.7.7 0 0 1 .67.9l-1.5 4.9a1 1 0 0 1-.96.7H2.5a1 1 0 0 1-.97-1.3l1.8-4.5a1 1 0 0 1 .93-.7z"/></svg>'

/** The small coloured glyph before a file name (tree rows and tabs). */
export function fileIcon(path: string): HTMLElement {
  const { kind, glyph } = fileIconFor(path)
  return h('span', { class: `fi fi-${kind}`, 'aria-hidden': 'true' }, glyph)
}

export function folderIcon(open: boolean): HTMLElement {
  const el = h('span', { class: 'fi fi-folder', 'aria-hidden': 'true' })
  el.innerHTML = open ? FOLDER_OPEN : FOLDER
  return el
}
