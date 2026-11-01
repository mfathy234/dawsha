import type { EditorState, Extension } from '@codemirror/state'
import { getChunks, getOriginalDoc } from '@codemirror/merge'
import { GutterMarker, gutter, type EditorView } from '@codemirror/view'
import { icon } from '../dom'
import { ICONS } from '../icons'
import { buildHunks, changesOf, lineSpan, textLines, type Hunk } from './changeHunks'

export interface ChangeGutterHooks {
  /** A change's button was pressed: show Stage and Revert for it, next to the button. */
  open(hunk: Hunk, anchor: DOMRect): void
}

interface Found {
  hunks: Hunk[]
  byLine: Map<number, Hunk>
}

const NONE: Found = { hunks: [], byLine: new Map() }
const cache = new WeakMap<object, Found>()

/** The changes the Changes view shows, grouped the way git groups them, with the line each one's button sits on. */
export function changesOfState(state: EditorState): Found {
  const info = getChunks(state)
  if (!info) return NONE
  const known = cache.get(info.chunks)
  if (known) return known
  const base = getOriginalDoc(state)
  const eol = state.lineBreak
  const before = textLines(base.sliceString(0, base.length, eol), eol)
  const after = textLines(state.sliceDoc(), eol)
  const comparable = before.lines.length === 0 ? after.finalNewline : before.finalNewline === after.finalNewline
  const hunks = comparable ? buildHunks(before.lines, after.lines, changesOf(info.chunks, base, state.doc), eol) : []
  const byLine = new Map<number, Hunk>()
  for (const hunk of hunks) for (const change of hunk.changes) byLine.set(Math.min(change.curStart + 1, state.doc.lines), hunk)
  const found = { hunks, byLine }
  cache.set(info.chunks, found)
  return found
}

class ChangeMarker extends GutterMarker {
  constructor(private readonly hunk: Hunk) {
    super()
  }

  override eq(other: ChangeMarker): boolean {
    return other.hunk.text === this.hunk.text
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('span')
    button.className = 'cm-hunk-btn'
    button.setAttribute('role', 'button')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-label', `Actions for the change at ${lineSpan(this.hunk)}`)
    button.title = `Stage or revert this change (${lineSpan(this.hunk)})`
    button.append(icon(ICONS.more))
    return button
  }
}

/** A button on the first line of every change: it opens Stage and Revert for that change alone. */
export function changeGutter(hooks: ChangeGutterHooks): Extension {
  const hunkAt = (view: EditorView, from: number): Hunk | undefined => changesOfState(view.state).byLine.get(view.state.doc.lineAt(from).number)
  return gutter({
    class: 'cm-hunk-gutter',
    lineMarker: (view, line) => {
      const hunk = hunkAt(view, line.from)
      return hunk ? new ChangeMarker(hunk) : null
    },
    lineMarkerChange: () => true,
    domEventHandlers: {
      click(view, line, event) {
        const hunk = hunkAt(view, line.from)
        if (!hunk) return false
        const target = (event.target as HTMLElement).closest('.cm-hunk-btn') ?? (event.target as HTMLElement)
        hooks.open(hunk, target.getBoundingClientRect())
        return true
      }
    }
  })
}
