import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { getIndentUnit } from '@codemirror/language'

function guideWidth(view: EditorView): number {
  return Math.max(1, getIndentUnit(view.state) || view.state.tabSize)
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const width = guideWidth(view)
  const mark = Decoration.mark({ class: 'cm-indent-guides', attributes: { style: `background-size: ${width}ch 100%` } })
  let last = -1
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      if (line.number > last) {
        const lead = /^[ \t]*/.exec(line.text)?.[0].length ?? 0
        if (lead > 0) builder.add(line.from, line.from + lead, mark)
        last = line.number
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** Faint vertical rules at every indent step in a line's leading whitespace, like VS Code's indent guides. */
export function indentGuides(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.reconfigured)) this.decorations = build(update.view)
    }
  }, { decorations: (plugin) => plugin.decorations })
}
