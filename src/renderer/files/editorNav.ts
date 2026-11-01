import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { identifierAt } from './symbolAt'

/** What a block builds; `dispose` runs when it is removed from the editor. */
export type InlineElement = HTMLElement & { dispose?: () => void }

/** A block of UI under one line of code: the peek or a short message. `build` gets the width the card may use. */
export interface InlineSpec {
  id: number
  line: number
  build(width: number): InlineElement
}

class InlineWidget extends WidgetType {
  constructor(private readonly spec: InlineSpec) {
    super()
  }

  override eq(other: InlineWidget): boolean {
    return other.spec.id === this.spec.id
  }

  override toDOM(view: EditorView): HTMLElement {
    const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters')?.offsetWidth ?? 0
    return this.spec.build(Math.max(320, view.scrollDOM.clientWidth - gutters - 32))
  }

  override destroy(dom: HTMLElement): void {
    ;(dom as InlineElement).dispose?.()
  }

  override get estimatedHeight(): number {
    return 120
  }

  override ignoreEvent(): boolean {
    return true
  }
}

export const setInline = StateEffect.define<InlineSpec | null>()

function inlineDecorations(state: EditorState, spec: InlineSpec | null): DecorationSet {
  if (!spec || spec.line < 1 || spec.line > state.doc.lines) return Decoration.none
  return Decoration.set([Decoration.widget({ widget: new InlineWidget(spec), block: true, side: 1 }).range(state.doc.line(spec.line).to)])
}

const inlineField = StateField.define<{ spec: InlineSpec | null; decorations: DecorationSet }>({
  create: () => ({ spec: null, decorations: Decoration.none }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInline)) return { spec: effect.value, decorations: inlineDecorations(transaction.state, effect.value) }
    }
    // Editing the file closes what was shown under it: the line it pointed at may have moved.
    return transaction.docChanged ? { spec: null, decorations: Decoration.none } : value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
})

export const flashLine = StateEffect.define<number | null>()

const flashMark = Decoration.line({ class: 'cm-nav-flash' })

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(flashLine)) continue
      if (effect.value === null || effect.value < 1 || effect.value > transaction.state.doc.lines) return Decoration.none
      return Decoration.set([flashMark.range(transaction.state.doc.line(effect.value).from)])
    }
    return transaction.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field)
})

const linkMark = Decoration.mark({ class: 'cm-nav-link' })
const setLink = StateEffect.define<{ from: number; to: number } | null>()

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLink)) return effect.value ? Decoration.set([linkMark.range(effect.value.from, effect.value.to)]) : Decoration.none
    }
    return transaction.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field)
})

const primary = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey

/** While Ctrl (Cmd) is held, the name under the mouse is underlined as a link; Ctrl+click goes to its definition. */
function linkHover(onGoto: (pos: number) => void): Extension {
  return ViewPlugin.fromClass(class {
    private x = -1
    private y = -1
    private shown = false
    private readonly release = (): void => this.hide()

    constructor(private readonly view: EditorView) {
      window.addEventListener('blur', this.release)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.shown = false
    }

    move(event: MouseEvent): void {
      this.x = event.clientX
      this.y = event.clientY
      this.refresh(primary(event))
    }

    refresh(held: boolean): void {
      if (!held || this.x < 0) return this.hide()
      const pos = this.view.posAtCoords({ x: this.x, y: this.y })
      const found = pos === null ? null : identifierAt(this.view.state, pos)
      if (!found) return this.hide()
      this.shown = true
      this.view.dispatch({ effects: setLink.of({ from: found.from, to: found.to }) })
    }

    hide(): void {
      if (!this.shown) return
      this.shown = false
      this.view.dispatch({ effects: setLink.of(null) })
    }

    destroy(): void {
      window.removeEventListener('blur', this.release)
    }
  }, {
    eventHandlers: {
      mousemove(event) {
        this.move(event)
      },
      mouseleave() {
        this.hide()
      },
      keydown(event) {
        if (event.key === 'Control' || event.key === 'Meta') this.refresh(true)
      },
      keyup(event) {
        if (event.key === 'Control' || event.key === 'Meta') this.hide()
      },
      mousedown(event, view) {
        if (event.button !== 0 || !primary(event)) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null || !identifierAt(view.state, pos)) return false
        event.preventDefault()
        this.hide()
        onGoto(pos)
        return true
      }
    }
  })
}

export function navExtensions(onGoto: (pos: number) => void): Extension {
  return [inlineField, flashField, linkField, linkHover(onGoto), EditorView.clickAddsSelectionRange.of((event) => event.altKey)]
}
