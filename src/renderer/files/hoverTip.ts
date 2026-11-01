import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { identifierAt } from './symbolAt'

export interface HoverTip {
  display: string
  documentation: string
  /** Found by a text search, not a language service. */
  byName: boolean
}

export type HoverProvider = (pos: number) => Promise<HoverTip | null>

const HOVER_DELAY_MS = 450
const BY_NAME_NOTE = 'Best match by name'

function tipDom(tip: HoverTip): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-hover-tip'
  const code = document.createElement('div')
  code.className = 'cm-hover-code'
  code.textContent = tip.display
  root.append(code)
  if (tip.documentation.trim() !== '') {
    const doc = document.createElement('div')
    doc.className = 'cm-hover-doc'
    doc.textContent = tip.documentation.trim()
    root.append(doc)
  }
  if (tip.byName) {
    const note = document.createElement('div')
    note.className = 'cm-hover-note'
    note.textContent = BY_NAME_NOTE
    root.append(note)
  }
  return root
}

/** Rest the pointer on a name to see its type or declaration. Only names are asked about, never comments or strings. */
export function hoverInfo(provider: () => HoverProvider | null): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const ask = provider()
    const found = ask ? identifierAt(view.state, pos) : null
    if (!ask || !found) return null
    const tip = await ask(found.from).catch(() => null)
    if (!tip || tip.display.trim() === '') return null
    return { pos: found.from, end: found.to, above: true, create: () => ({ dom: tipDom(tip) }) }
  }, { hideOnChange: true, hoverTime: HOVER_DELAY_MS })
}
