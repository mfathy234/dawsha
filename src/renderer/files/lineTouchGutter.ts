import type { Extension } from '@codemirror/state'
import { GutterMarker, gutter } from '@codemirror/view'
import type { AgentFileTouch } from '../../shared/codeNavExtras'
import { agentMark } from '../components/agentMark'
import { touchText } from './lineTouch'

export interface LineTouchHooks {
  /** The mark was pressed: open the session behind it. */
  open(touch: AgentFileTouch): void
}

class TouchMarker extends GutterMarker {
  constructor(private readonly touch: AgentFileTouch) {
    super()
  }

  override eq(other: TouchMarker): boolean {
    return other.touch.sessionId === this.touch.sessionId && other.touch.at === this.touch.at && other.touch.precision === this.touch.precision
  }

  override toDOM(): HTMLElement {
    const text = touchText(this.touch)
    const mark = document.createElement('span')
    mark.className = `cm-touch-mark${text.guess ? ' guess' : ''}`
    mark.setAttribute('role', 'button')
    mark.title = text.title
    mark.setAttribute('aria-label', `${text.title} Open the session.`)
    const logo = agentMark(this.touch.agent)
    if (logo) mark.append(logo)
    else mark.textContent = this.touch.agent.slice(0, 1).toUpperCase()
    return mark
  }
}

/** Which agent session changed each line, from the session logs. The mark's text says how the match was made. */
export function lineTouchGutter(lines: ReadonlyMap<number, AgentFileTouch>, hooks: LineTouchHooks): Extension {
  return gutter({
    class: 'cm-touch-gutter',
    lineMarker: (view, line) => {
      const touch = lines.get(view.state.doc.lineAt(line.from).number)
      return touch ? new TouchMarker(touch) : null
    },
    lineMarkerChange: () => true,
    domEventHandlers: {
      click(view, line) {
        const touch = lines.get(view.state.doc.lineAt(line.from).number)
        if (!touch) return false
        hooks.open(touch)
        return true
      }
    }
  })
}
